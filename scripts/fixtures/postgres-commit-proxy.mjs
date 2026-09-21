import { once } from "node:events";
import { createConnection, createServer } from "node:net";

// Isolated plaintext PostgreSQL tests only: discard the first successful COMMIT
// acknowledgement, not the COMMIT request, so the client cannot infer rollback.
export async function startCommitLossProxy(databaseUrl) {
  const upstreamUrl = new URL(databaseUrl);
  const sockets = new Set();
  const errors = [];
  let droppedCommits = 0;
  const server = createServer((client) => {
    const upstream = createConnection({ host: upstreamUrl.hostname, port: Number(upstreamUrl.port || 5432) });
    sockets.add(client);
    sockets.add(upstream);
    let pending = Buffer.alloc(0);
    for (const socket of [client, upstream]) {
      socket.on("error", (error) => {
        errors.push(error);
        client.destroy();
        upstream.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream);
    upstream.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 5) {
        const length = pending.readUInt32BE(1);
        if (length < 4 || length > 16 * 1024 * 1024) {
          errors.push(new Error("Invalid PostgreSQL backend frame; the test proxy requires plaintext connections."));
          client.destroy();
          upstream.destroy();
          return;
        }
        if (pending.length < length + 1) return;
        const packet = pending.subarray(0, length + 1);
        pending = pending.subarray(length + 1);
        if (droppedCommits === 0 && packet[0] === 67 && packet.subarray(5).equals(Buffer.from("COMMIT\0"))) {
          droppedCommits += 1;
          client.destroy();
          upstream.destroy();
          return;
        }
        client.write(packet);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const proxyUrl = new URL(databaseUrl);
  proxyUrl.hostname = "127.0.0.1";
  proxyUrl.port = String(server.address().port);
  proxyUrl.searchParams.delete("sslmode");
  return {
    databaseUrl: proxyUrl.toString(),
    get droppedCommits() { return droppedCommits; },
    errors,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
