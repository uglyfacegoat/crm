import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must identify an isolated test PostgreSQL instance.");
const sourceRoot = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
      if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", sourceRoot), { namedExports: { getDatabase: () => sql } });
const chat = await import("../src/server/chat/repository.ts");

test("chat file authorization uses current tenant, membership, channel and permission state", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_chat_access_test_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => {
    mock.restoreAll();
    hooks.deregister();
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });

  async function fixture(kind = "group", audience = "office") {
    const [organization] = await sql`INSERT INTO organizations (name, timezone)
      VALUES ('Chat authorization test', 'Europe/Moscow') RETURNING id`;
    const [author] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${organization.id}, 'Test author', 'author@example.invalid', 'admin') RETURNING id`;
    const member = { organizationId: organization.id, memberId: author.id, role: "admin", permissionOverrides: {}, sessionId: null };
    let subjectMemberId = null;
    if (audience === "master_direct") {
      const [technician] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
        VALUES (${organization.id}, 'Test master', '+70000000000', '+70000000000', 'Test region', 'Test zone') RETURNING id`;
      const [master] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
        VALUES (${organization.id}, 'Test master', 'master@example.invalid', 'master', ${technician.id}) RETURNING id`;
      subjectMemberId = master.id;
    }
    const [channel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, audience_kind, subject_member_id, created_by)
      VALUES (${organization.id}, 'Test channel', ${kind}, ${audience}, ${subjectMemberId}, ${author.id}) RETURNING id`;
    await sql`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
      VALUES (${organization.id}, ${channel.id}, ${author.id}, 'owner', ${author.id})`;
    const input = { channelId: channel.id, idempotencyKey: randomUUID(), body: "Test message", sharedEntityId: null, sharedEntityType: null };
    return { member, channelId: channel.id, input };
  }

  await t.test("authorized message persists once; retries do not duplicate it", async () => {
    const { member, channelId, input } = await fixture();
    await chat.assertChatMessageAccess(member, channelId);
    await chat.assertChatAvatarAccess(member, channelId, 1);
    assert.equal(await chat.sendChatMessage(member, input), input.idempotencyKey);
    assert.equal(await chat.sendChatMessage(member, input), input.idempotencyKey);
    const [count] = await sql`SELECT count(*)::integer AS total FROM chat_messages WHERE channel_id = ${channelId}`;
    assert.equal(count.total, 1);
  });
  await t.test("cross-company channels and nonmembers are rejected", async () => {
    const own = await fixture();
    const other = await fixture();
    for (const member of [other.member, { ...own.member, memberId: other.member.memberId }]) {
      await assert.rejects(chat.assertChatMessageAccess(member, own.channelId), chat.ChatChannelNotFoundError);
      await assert.rejects(chat.assertChatAvatarAccess(member, own.channelId, 1), chat.ChatChannelNotFoundError);
      await assert.rejects(chat.sendChatMessage(member, own.input), chat.ChatChannelNotFoundError);
    }
  });
  await t.test("permission overrides cannot be bypassed by membership or administrator role", async () => {
    const { member, channelId, input } = await fixture();
    const noWrite = { ...member, permissionOverrides: { "chat.write": false } };
    await assert.rejects(chat.assertChatMessageAccess(noWrite, channelId), AuthorizationError);
    await assert.rejects(chat.sendChatMessage(noWrite, input), AuthorizationError);
    for (const permission of ["chat.manage", "chat.read"]) {
      await assert.rejects(chat.assertChatAvatarAccess({ ...member, permissionOverrides: { [permission]: false } }, channelId, 1), AuthorizationError);
    }
  });
  for (const mutation of ["archive", "remove membership"]) {
    await t.test(`${mutation} after preflight is rechecked by the message transaction`, async () => {
      const { member, channelId, input } = await fixture();
      await chat.assertChatMessageAccess(member, channelId);
      if (mutation === "archive") await sql`UPDATE chat_channels SET archived_at = now() WHERE id = ${channelId}`;
      else await sql`DELETE FROM chat_channel_members WHERE channel_id = ${channelId}`;
      await assert.rejects(chat.assertChatMessageAccess(member, channelId), chat.ChatChannelNotFoundError);
      await assert.rejects(chat.assertChatAvatarAccess(member, channelId, 1), chat.ChatChannelNotFoundError);
      await assert.rejects(chat.sendChatMessage(member, input), chat.ChatChannelNotFoundError);
      const [count] = await sql`SELECT count(*)::integer AS total FROM chat_messages WHERE channel_id = ${channelId}`;
      assert.equal(count.total, 0);
    });
  }
  await t.test("avatars reject system/direct channels and stale versions", async () => {
    for (const [kind, audience] of [["general", "office"], ["group", "direct"], ["group", "master_direct"]]) {
      const { member, channelId } = await fixture(kind, audience);
      await assert.rejects(chat.assertChatAvatarAccess(member, channelId, 1), chat.ChatGeneralChannelMutationError);
    }
    const { member, channelId } = await fixture();
    await assert.rejects(chat.assertChatAvatarAccess(member, channelId, 2), chat.ChatChannelVersionConflictError);
  });
});
