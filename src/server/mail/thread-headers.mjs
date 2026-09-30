// Only accept complete Message-ID tokens. Never forward arbitrary MIME header text.
export function messageIds(value) {
  if (typeof value !== 'string' || /[\r\n\u0000]/.test(value)) return [];
  return [...new Set(value.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? [])]
    .filter(id => id.length <= 998).slice(-50);
}

export function threadHeaders(parsed) {
  return {
    messageId: messageIds(parsed?.messageId)[0] ?? null,
    inReplyTo: messageIds(parsed?.inReplyTo).at(-1) ?? null,
    references: messageIds(parsed?.references),
  };
}

export function replyHeaders(parent) {
  const inReplyTo = messageIds(parent.internet_message_id)[0] ?? null;
  const references = messageIds([...(parent.reference_ids ?? []), inReplyTo ?? ''].join(' '));
  return { inReplyTo, references };
}
