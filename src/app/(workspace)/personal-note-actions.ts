"use server";

import { z } from "zod";
import { getAuthMode } from "@/server/auth/config";
import { requireOfficeSession } from "@/server/auth/session";
import { getDatabase } from "@/server/database";
import { runPersonalNoteMutation } from "@/server/personal-notes/mutations";
import {
  canAccessNoteTarget, listPersonalNotes, listPersonalNoteTemplates,
  searchNoteDestinations, type NoteTarget,
} from "@/server/personal-notes/repository";

const uuid = z.string().uuid();
const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dashboard"), organizationId: z.null(), id: z.null() }),
  z.object({ kind: z.literal("order"), organizationId: uuid, id: uuid }),
  z.object({ kind: z.literal("client"), organizationId: uuid, id: uuid }),
]);
const noteContentSchema = z.object({ title: z.string().trim().max(160), body: z.string().trim().min(1).max(12000) });

async function authorizedTarget(value: NoteTarget) {
  if (getAuthMode() === "preview") throw new Error("Сохранение недоступно в деморежиме.");
  const member = await requireOfficeSession();
  const target = targetSchema.parse(value);
  if (!await canAccessNoteTarget(member, target)) throw new Error("Карточка недоступна.");
  return { member, target };
}

export async function savePersonalNoteAction(input: { target: NoteTarget; id?: string; requestKey?: string; title: string; body: string; template?: { id?: string; name: string; body: string; kind?: "plain" | "liza_order" } }) {
  const { member, target } = await authorizedTarget(input.target);
  const content = noteContentSchema.parse(input);
  const id = uuid.optional().parse(input.id);
  const requestKey = uuid.optional().parse(input.requestKey);
  const template = input.template ? z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(12000), kind: z.enum(["plain", "liza_order"]).default("plain") }).parse(input.template) : null;
  const sql = getDatabase();
  const mutation = await sql.begin(async (transaction) => runPersonalNoteMutation(transaction, member, requestKey,
    "note.save", { target, id: id ?? null, ...content, template }, async () => {
      let noteId: string;
      if (id) {
        const rows = await transaction`UPDATE personal_notes SET title = ${content.title}, body = ${content.body}, updated_at = now()
          WHERE id = ${id} AND owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
            AND target_kind = ${target.kind} AND target_organization_id IS NOT DISTINCT FROM ${target.organizationId}
            AND target_id IS NOT DISTINCT FROM ${target.id} RETURNING id`;
        if (!rows.length) throw new Error("Заметка не найдена.");
        noteId = id;
      } else {
        const [row] = await transaction`INSERT INTO personal_notes (owner_organization_id, owner_member_id, target_kind, target_organization_id, target_id, title, body)
          VALUES (${member.organizationId}, ${member.memberId}, ${target.kind}, ${target.organizationId}, ${target.id}, ${content.title}, ${content.body}) RETURNING id`;
        noteId = uuid.parse(row.id);
      }
      let templateId: string | null = null;
      if (template?.id) {
        const rows = await transaction`UPDATE personal_note_templates SET name = ${template.name}, body = ${template.body}
          WHERE id = ${template.id} AND owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId} RETURNING id`;
        if (!rows.length) throw new Error("Шаблон не найден.");
        templateId = template.id;
      } else if (template) {
        const [row] = await transaction`INSERT INTO personal_note_templates (owner_organization_id, owner_member_id, name, body, template_kind)
          VALUES (${member.organizationId}, ${member.memberId}, ${template.name}, ${template.body}, ${template.kind}) RETURNING id`;
        templateId = uuid.parse(row.id);
      }
      return { noteId, templateId };
    }));
  const [notes, templates] = await Promise.all([listPersonalNotes(member, target), listPersonalNoteTemplates(member)]);
  return { notes, templates, mutation };
}

export async function deletePersonalNoteAction(input: { target: NoteTarget; id: string }) {
  const { member, target } = await authorizedTarget(input.target);
  await getDatabase()`DELETE FROM personal_notes WHERE id = ${uuid.parse(input.id)}
    AND owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
    AND target_kind = ${target.kind} AND target_organization_id IS NOT DISTINCT FROM ${target.organizationId}
    AND target_id IS NOT DISTINCT FROM ${target.id}`;
  return listPersonalNotes(member, target);
}

export async function transferPersonalNoteAction(input: { source: NoteTarget; destination: NoteTarget; id: string; mode: "copy" | "move"; requestKey?: string }) {
  const { member, target: source } = await authorizedTarget(input.source);
  const destination = targetSchema.parse(input.destination);
  if (!await canAccessNoteTarget(member, destination)) throw new Error("Место назначения недоступно.");
  const id = uuid.parse(input.id);
  const requestKey = uuid.optional().parse(input.requestKey);
  const mode = z.enum(["copy", "move"]).parse(input.mode);
  const sql = getDatabase();
  const mutation = await sql.begin(async (transaction) => runPersonalNoteMutation(transaction, member, requestKey,
    "note.transfer", { source, destination, id, mode }, async () => {
      const rows = await transaction`SELECT title, body FROM personal_notes WHERE id = ${id}
        AND owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
        AND target_kind = ${source.kind} AND target_organization_id IS NOT DISTINCT FROM ${source.organizationId}
        AND target_id IS NOT DISTINCT FROM ${source.id} FOR UPDATE`;
      if (!rows.length) throw new Error("Заметка не найдена.");
      if (mode === "move") {
        await transaction`UPDATE personal_notes SET target_kind = ${destination.kind}, target_organization_id = ${destination.organizationId},
          target_id = ${destination.id}, updated_at = now() WHERE id = ${id}
          AND owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}`;
        return { noteId: id, templateId: null };
      }
      const [row] = await transaction`INSERT INTO personal_notes (owner_organization_id, owner_member_id, target_kind, target_organization_id, target_id, title, body)
        VALUES (${member.organizationId}, ${member.memberId}, ${destination.kind}, ${destination.organizationId}, ${destination.id}, ${rows[0].title}, ${rows[0].body}) RETURNING id`;
      return { noteId: uuid.parse(row.id), templateId: null };
    }));
  return { notes: await listPersonalNotes(member, source), mutation };
}

export async function searchPersonalNoteTargetsAction(query: string, offset = 0) {
  if (getAuthMode() === "preview") return { items: [], total: 0, nextOffset: null };
  const member = await requireOfficeSession();
  return searchNoteDestinations(member, z.string().trim().max(120).parse(query), z.number().int().min(0).max(1_000_000).parse(offset));
}

export async function savePersonalNoteTemplateAction(input: { id?: string; name: string; body: string }) {
  if (getAuthMode() === "preview") throw new Error("Сохранение недоступно в деморежиме.");
  const member = await requireOfficeSession();
  const name = z.string().trim().min(1).max(100).parse(input.name);
  const body = z.string().trim().min(1).max(12000).parse(input.body);
  if (input.id) {
    const rows = await getDatabase()`UPDATE personal_note_templates SET name = ${name}, body = ${body}
      WHERE id = ${uuid.parse(input.id)} AND owner_organization_id = ${member.organizationId}
        AND owner_member_id = ${member.memberId} RETURNING id`;
    if (!rows.length) throw new Error("Шаблон не найден.");
  } else {
    await getDatabase()`INSERT INTO personal_note_templates (owner_organization_id, owner_member_id, name, body)
      VALUES (${member.organizationId}, ${member.memberId}, ${name}, ${body})`;
  }
  return listPersonalNoteTemplates(member);
}

export async function deletePersonalNoteTemplateAction(id: string) {
  if (getAuthMode() === "preview") throw new Error("Удаление недоступно в деморежиме.");
  const member = await requireOfficeSession();
  await getDatabase()`DELETE FROM personal_note_templates WHERE id = ${uuid.parse(id)}
    AND owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}`;
  return listPersonalNoteTemplates(member);
}
