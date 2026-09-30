import assert from 'node:assert/strict';
import { test } from 'node:test';
import PostalMime from 'postal-mime';
import { messageIds, replyHeaders, threadHeaders } from './thread-headers.mjs';

test('MIME references survive folded headers and replies keep the parent last', async () => {
  const parsed = await PostalMime.parse('Message-ID: <child@example.test>\r\nIn-Reply-To: <parent@example.test>\r\nReferences: <root@example.test>\r\n <parent@example.test>\r\n\r\nBody');
  assert.deepEqual(threadHeaders(parsed), { messageId: '<child@example.test>', inReplyTo: '<parent@example.test>', references: ['<root@example.test>', '<parent@example.test>'] });
  assert.deepEqual(replyHeaders({ internet_message_id: '<child@example.test>', reference_ids: ['<root@example.test>', '<parent@example.test>'] }),
    { inReplyTo: '<child@example.test>', references: ['<root@example.test>', '<parent@example.test>', '<child@example.test>'] });
});

test('header injection and malformed IDs cannot be forwarded', () => {
  for (const value of ['<id@example.test>\r\nBcc: victim@example.test', '<id@example.test>\u0000', '<bad>', 'raw@example.test']) assert.deepEqual(messageIds(value), []);
  assert.deepEqual(messageIds('<valid@example.test> <valid@example.test> <a b@example.test>'), ['<valid@example.test>']);
  assert.equal(messageIds(Array.from({ length: 70 }, (_, i) => `<${i}@example.test>`).join(' ')).length, 50);
});
