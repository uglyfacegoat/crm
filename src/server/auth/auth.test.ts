import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLoginIdentity } from "./identity.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { hasPermission, requireSameOrganization, AuthorizationError } from "./permissions.ts";
import type { AuthenticatedMember } from "./types.ts";

test("normalizes email and Russian phone login identities", () => {
  assert.deepEqual(normalizeLoginIdentity(" Admin@Example.COM "), { kind: "email", normalizedValue: "admin@example.com" });
  assert.deepEqual(normalizeLoginIdentity("8 (999) 123-45-67"), { kind: "phone", normalizedValue: "+79991234567" });
  assert.equal(normalizeLoginIdentity("not-a-login"), null);
});

test("hashes passwords with a unique salt and verifies without exposing plaintext", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(first.includes("correct horse"), false);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword("anything", "malformed"), false);
});

test("enforces role grants and organization boundaries", () => {
  assert.equal(hasPermission("dispatcher", "orders.write"), true);
  assert.equal(hasPermission("dispatcher", "tasks.write"), true);
  assert.equal(hasPermission("dispatcher", "chat.manage"), true);
  assert.equal(hasPermission("dispatcher", "contracts.write"), true);
  assert.equal(hasPermission("accountant", "contracts.read"), true);
  assert.equal(hasPermission("accountant", "contracts.write"), false);
  assert.equal(hasPermission("accountant", "finance.write"), true);
  assert.equal(hasPermission("manager", "finance.write"), false);
  assert.equal(hasPermission("accountant", "chat.write"), true);
  assert.equal(hasPermission("accountant", "chat.manage"), false);
  assert.equal(hasPermission("accountant", "tasks.write"), false);
  assert.equal(hasPermission("master", "chat.read"), false);
  assert.equal(hasPermission("master", "finance.read"), false);
  assert.equal(hasPermission("master", "orders.read"), false);
  assert.equal(hasPermission("master", "visits.write"), true);
  assert.equal(hasPermission("master", "document_templates.read"), true);
  assert.equal(hasPermission("master", "document_templates.write"), false);
  const member: AuthenticatedMember = { sessionId: crypto.randomUUID(), organizationId: crypto.randomUUID(), organizationName: "CRM", memberId: crypto.randomUUID(), displayName: "Admin", email: "admin@example.com", role: "admin", masterId: null };
  assert.doesNotThrow(() => requireSameOrganization(member, member.organizationId));
  assert.throws(() => requireSameOrganization(member, crypto.randomUUID()), AuthorizationError);
});
