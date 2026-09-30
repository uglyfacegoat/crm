import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Disposable, loopback-only protocol peers. Production TLS/auth settings are unchanged.
export async function startMailFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'crm-mail-peer-'));
  const config = join(directory, 'certificate.cnf');
  const certPath = join(directory, 'certificate.pem');
  const keyPath = join(directory, 'key.pem');
  await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-config', config, '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
  const key = await readFile(keyPath); const cert = await readFile(certPath);
  const secureContext = tls.createSecureContext({ key, cert });
  const sockets = new Set();
  const delivered = []; const inbox = []; const commands = [];
  const auth = { user: 'fixture', password: 'fixture-only-password' };
  let rejectDelivery = false;
  function track(socket) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); }

  const smtp = net.createServer(socket => {
    track(socket);
    socket.write('220 localhost fixture SMTP\r\n');
    function session(connection, encrypted) {
      let buffer = ''; let receiving = false;
      function onData(chunk) {
        buffer += chunk.toString();
        while (true) {
          if (receiving) {
            const end = buffer.indexOf('\r\n.\r\n');
            if (end < 0) return;
            const message = buffer.slice(0, end).replace(/\r\n\.\./g, '\r\n.');
            buffer = buffer.slice(end + 5); receiving = false;
            if (rejectDelivery) connection.write('451 Temporary fixture delivery failure\r\n');
            else { delivered.push(Buffer.from(message)); connection.write('250 queued\r\n'); }
            continue;
          }
          const end = buffer.indexOf('\r\n'); if (end < 0) return;
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const [verb, ...args] = line.split(' ');
          switch (verb.toUpperCase()) {
            case 'EHLO': connection.write(`250-localhost\r\n${encrypted ? '' : '250-STARTTLS\r\n'}250 AUTH PLAIN\r\n`); break;
            case 'STARTTLS': {
              connection.write('220 Ready for TLS\r\n');
              connection.removeListener('data', onData);
              const secure = new tls.TLSSocket(connection, { isServer: true, secureContext });
              track(secure); session(secure, true); return;
            }
            case 'AUTH': {
              const credentials = Buffer.from(args.at(-1) || '', 'base64').toString().split('\0');
              connection.write(encrypted && credentials.at(-2) === auth.user && credentials.at(-1) === auth.password
                ? '235 Authenticated\r\n' : '535 Authentication failed\r\n'); break;
            }
            case 'MAIL': case 'RCPT': case 'RSET': case 'NOOP': connection.write('250 OK\r\n'); break;
            case 'DATA': receiving = true; connection.write('354 End with a dot\r\n'); break;
            case 'QUIT': connection.end('221 Bye\r\n'); break;
            default: connection.write('500 Unknown fixture command\r\n');
          }
        }
      }
      connection.on('data', onData);
    }
    session(socket, false);
  });

  const imap = tls.createServer({ key, cert }, socket => {
    track(socket); socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] Fixture ready\r\n');
    let buffer = ''; let authTag = null;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (authTag) { socket.write(`${authTag} OK Authenticated\r\n`); authTag = null; continue; }
        const [tag, verb, ...parts] = line.split(' '); const rest = parts.join(' ');
        commands.push(`${verb} ${['LOGIN', 'AUTHENTICATE'].includes(verb.toUpperCase()) ? '[fixture auth]' : rest}`);
        const ok = () => socket.write(`${tag} OK Completed\r\n`);
        switch (verb.toUpperCase()) {
          case 'CAPABILITY': socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n'); ok(); break;
          case 'AUTHENTICATE':
            if (parts.length > 1) ok(); else { authTag = tag; socket.write('+\r\n'); } break;
          case 'LOGIN': ok(); break;
          case 'LIST': case 'LSUB': socket.write(`* ${verb} (\\HasNoChildren) "/" "INBOX"\r\n`); ok(); break;
          case 'SELECT': case 'EXAMINE':
            socket.write(`* FLAGS (\\Seen)\r\n* ${inbox.length} EXISTS\r\n* OK [UIDVALIDITY 1]\r\n* OK [UIDNEXT ${inbox.length + 1}]\r\n${tag} OK [READ-WRITE] Selected\r\n`); break;
          case 'STATUS': socket.write(`* STATUS "INBOX" (MESSAGES ${inbox.length} UIDNEXT ${inbox.length + 1} UIDVALIDITY 1 UNSEEN 0)\r\n`); ok(); break;
          case 'UID': {
            if (parts[0].toUpperCase() === 'SEARCH') {
              socket.write(`* SEARCH ${inbox.map((_, i) => i + 1).join(' ')}\r\n`); ok(); break;
            }
            if (parts[0].toUpperCase() === 'FETCH') {
              const uid = Number(parts[1]); const message = inbox[uid - 1];
              if (message) {
                const literal = /BODY/i.test(rest);
                socket.write(`* ${uid} FETCH (UID ${uid} RFC822.SIZE ${message.length} INTERNALDATE "30-Sep-2026 14:00:00 +0000"${literal ? ` BODY[] {${message.length}}\r\n` : ')\r\n'}`);
                if (literal) { socket.write(message); socket.write(')\r\n'); }
              }
              ok(); break;
            }
            socket.write(`${tag} BAD Unsupported UID command\r\n`); break;
          }
          case 'CLOSE': case 'NOOP': ok(); break;
          case 'LOGOUT': socket.end(`* BYE Closing\r\n${tag} OK Logout\r\n`); break;
          default: socket.write(`${tag} BAD Unsupported fixture command\r\n`);
        }
      }
    });
  });
  smtp.listen(0, '127.0.0.1'); imap.listen(0, '127.0.0.1');
  await Promise.all([once(smtp, 'listening'), once(imap, 'listening')]);
  return { smtpPort: smtp.address().port, imapPort: imap.address().port, certPath, auth, delivered, inbox, commands,
    rejectDelivery(value) { rejectDelivery = value; },
    async close() { for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise(done => smtp.close(done)), new Promise(done => imap.close(done))]);
      await rm(directory, { recursive: true, force: true }); },
  };
}
