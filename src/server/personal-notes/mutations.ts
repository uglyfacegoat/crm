import "server-only";
import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import type { AuthenticatedMember } from "@/server/auth/types";

const resultSchema = z.object({ noteId: z.string().uuid(), templateId: z.string().uuid().nullable() });
type Result = z.infer<typeof resultSchema>;
export type NoteMutation = { status: "applied" | "replayed" | "conflict"; result: Result };

export async function runPersonalNoteMutation(transaction: TransactionSql, member: AuthenticatedMember,
  requestKey: string | undefined, operation: "note.save" | "note.transfer", payload: unknown,
  work: () => Promise<Result>): Promise<NoteMutation> {
  if (!requestKey) return { status: "applied", result: await work() };
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const claimed = await transaction`INSERT INTO personal_note_mutations
    (owner_organization_id, owner_member_id, request_key, operation, payload_hash)
    VALUES (${member.organizationId}, ${member.memberId}, ${requestKey}, ${operation}, ${hash})
    ON CONFLICT (owner_organization_id, owner_member_id, request_key) DO NOTHING RETURNING request_key`;
  if (!claimed.length) {
    const [previous] = await transaction`SELECT operation, payload_hash, result FROM personal_note_mutations
      WHERE owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
        AND request_key = ${requestKey}`;
    if (previous?.operation !== operation) throw new Error("Ключ операции уже использован.");
    return { status: previous.payload_hash === hash ? "replayed" : "conflict", result: resultSchema.parse(previous.result) };
  }
  const result = resultSchema.parse(await work());
  await transaction`UPDATE personal_note_mutations SET result = ${transaction.json(result)}, completed_at = now()
    WHERE owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
      AND request_key = ${requestKey}`;
  return { status: "applied", result };
}
