export function messageIds(value: unknown): string[];
export function threadHeaders(parsed: { messageId?: string; inReplyTo?: string; references?: string } | null):
  { messageId: string | null; inReplyTo: string | null; references: string[] };
export function replyHeaders(parent: { internet_message_id: unknown; reference_ids?: unknown[] }):
  { inReplyTo: string | null; references: string[] };
