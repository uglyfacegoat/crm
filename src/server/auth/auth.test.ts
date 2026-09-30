import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLoginIdentity } from "./identity.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { hasPermission, requireSameOrganization, AuthorizationError } from "./permissions.ts";
import { assignableOrganizationRoles, roleGrades, type AuthenticatedMember } from "./types.ts";
import { createMemberSchema } from "../members/schemas.ts";

test("new accounts use business roles and field roles require a linked master", () => {
  assert.equal(assignableOrganizationRoles.includes("admin" as never), false);
  assert.equal(assignableOrganizationRoles.includes("deputy"), true);
  assert.equal(roleGrades.sales_lead, 3);
  const input = { idempotencyKey: crypto.randomUUID(), displayName: "Новый сотрудник", email: "new@example.test", phone: "", password: "example-password-123", masterId: "" };
  assert.equal(createMemberSchema.safeParse({ ...input, role: "admin" }).success, false);
  assert.equal(createMemberSchema.safeParse({ ...input, role: "deputy" }).success, true);
  assert.equal(createMemberSchema.safeParse({ ...input, role: "foreman" }).success, false);
  assert.equal(createMemberSchema.safeParse({ ...input, role: "foreman", masterId: crypto.randomUUID() }).success, true);
});

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
  assert.equal(hasPermission("dispatcher", "search.use"), true);
  assert.equal(hasPermission("dispatcher", "analytics.read"), false);
  assert.equal(hasPermission("accountant", "contracts.read"), true);
  assert.equal(hasPermission("accountant", "contracts.write"), false);
  assert.equal(hasPermission("accountant", "finance.write"), true);
  assert.equal(hasPermission("manager", "finance.write"), false);
  assert.equal(hasPermission("manager", "analytics.read"), false);
  assert.equal(hasPermission("accountant", "chat.write"), true);
  assert.equal(hasPermission("accountant", "chat.manage"), false);
  assert.equal(hasPermission("accountant", "tasks.write"), false);
  assert.equal(hasPermission("master", "chat.read"), true);
  assert.equal(hasPermission("master", "chat.write"), true);
  assert.equal(hasPermission("master", "finance.read"), false);
  assert.equal(hasPermission("master", "orders.read"), false);
  assert.equal(hasPermission("master", "visits.write"), true);
  assert.equal(hasPermission("master", "document_templates.read"), true);
  assert.equal(hasPermission("master", "document_templates.write"), false);
  assert.equal(hasPermission("master", "notifications.read"), true);
  assert.equal(hasPermission("master", "companies.read"), false);
  assert.equal(hasPermission("master", "assistant.use"), false);
  for (const role of ["owner", "developer", "admin", "manager"] as const) {
    assert.equal(hasPermission(role, "assistant.use"), false);
    assert.equal(hasPermission(role, "workflow.read"), false);
    assert.equal(hasPermission(role, "workflow.publish"), false);
  }
  assert.equal(hasPermission({ role: "manager", permissionOverrides: { "workflow.read": true, "assistant.use": true } }, "workflow.read"), false);
  assert.equal(hasPermission("developer", "support.manage"), true);
  assert.equal(hasPermission("owner", "support.manage"), true);
  assert.equal(hasPermission("owner", "companies.write"), true);
  assert.equal(hasPermission("owner", "finance.write"), true);
  assert.equal(hasPermission("owner", "settings.write"), true);
  assert.equal(hasPermission("developer", "settings.write"), true);
  assert.equal(hasPermission("admin", "settings.write"), false);
  assert.equal(hasPermission("deputy", "settings.write"), false);
  assert.equal(hasPermission("finance_controller", "sites.read"), false);
  assert.equal(hasPermission("sales_lead", "sites.write"), false);
  assert.equal(hasPermission("sales_lead", "finance.read"), false);
  assert.equal(hasPermission("sales_lead", "analytics.read"), false);
  assert.equal(hasPermission("deputy", "finance.read"), true);
  assert.equal(hasPermission("sales_specialist", "finance.read"), false);
  assert.equal(hasPermission("sales_specialist", "orders.write"), true);
  assert.equal(hasPermission("developer", "developer.preview"), true);
  assert.equal(hasPermission("admin", "support.manage"), false);
  assert.equal(hasPermission("admin", "developer.preview"), false);
  const member: AuthenticatedMember = { sessionId: crypto.randomUUID(), organizationId: crypto.randomUUID(), organizationName: "CRM", memberId: crypto.randomUUID(), displayName: "Admin", email: "admin@example.com", role: "admin", masterId: null, permissionOverrides: {} };
  assert.equal(hasPermission({ ...member, role: "dispatcher", permissionOverrides: { "orders.write": false } }, "orders.write"), false);
  assert.equal(hasPermission({ ...member, role: "accountant", permissionOverrides: { "orders.write": true } }, "orders.write"), true);
  assert.equal(hasPermission({ ...member, permissionOverrides: { "support.manage": true } }, "support.manage"), false);
  assert.equal(hasPermission({ ...member, permissionOverrides: { "developer.preview": true } }, "developer.preview"), false);
  assert.equal(hasPermission({ ...member, role: "developer", permissionOverrides: { "support.manage": false } }, "support.manage"), true);
  assert.equal(hasPermission({ ...member, role: "owner", permissionOverrides: { "finance.write": false } }, "finance.write"), true);
  assert.equal(hasPermission({ ...member, role: "crm_coordinator", permissionOverrides: { "finance.read": true, "sites.read": true, "settings.write": true } }, "finance.read"), false);
  assert.equal(hasPermission({ ...member, role: "crm_coordinator", permissionOverrides: { "finance.read": true, "sites.read": true, "settings.write": true } }, "sites.read"), false);
  assert.equal(hasPermission({ ...member, role: "crm_coordinator", permissionOverrides: { "finance.read": true, "sites.read": true, "settings.write": true } }, "settings.write"), false);
  assert.equal(hasPermission("owner", "companies.switch"), true);
  assert.equal(hasPermission("developer", "companies.switch"), true);
  assert.equal(hasPermission("deputy", "companies.switch"), true);
  assert.equal(hasPermission("regional_director", "companies.switch"), true);
  assert.equal(hasPermission({ ...member, role: "deputy", permissionOverrides: { "companies.switch": false } }, "companies.switch"), true);
  assert.equal(hasPermission({ ...member, role: "regional_director", permissionOverrides: {} }, "companies.switch"), true);
  for (const role of ["admin", "dispatcher", "manager", "finance_controller", "sales_lead", "crm_coordinator", "tender_specialist", "accountant"] as const) {
    assert.equal(hasPermission(role, "companies.switch"), false);
    assert.equal(hasPermission({ ...member, role, permissionOverrides: { "companies.switch": true } }, "companies.switch"), true);
  }
  for (const role of ["foreman", "master"] as const) {
    assert.equal(hasPermission({ ...member, role, permissionOverrides: { "companies.switch": true } }, "companies.switch"), false);
  }
  assert.equal(hasPermission("deputy", "contracts.write"), true);
  assert.equal(hasPermission("deputy", "finance.write"), false);
  assert.equal(hasPermission("finance_controller", "finance.write"), true);
  assert.equal(hasPermission("finance_controller", "orders.write"), false);
  assert.equal(hasPermission("sales_lead", "leads.write"), true);
  assert.equal(hasPermission("sales_lead", "finance.write"), false);
  assert.equal(hasPermission("regional_director", "masters.write"), true);
  assert.equal(hasPermission("regional_director", "finance.write"), false);
  assert.equal(hasPermission("crm_coordinator", "orders.write"), true);
  assert.equal(hasPermission("crm_coordinator", "settings.write"), false);
  assert.equal(hasPermission("tender_specialist", "contracts.write"), true);
  assert.equal(hasPermission("tender_specialist", "finance.read"), false);
  assert.equal(hasPermission("foreman", "orders.read"), false);
  assert.equal(hasPermission("foreman", "finance.read"), false);
  assert.equal(hasPermission({ ...member, role: "foreman", permissionOverrides: { "orders.read": true } }, "orders.read"), false);
  assert.doesNotThrow(() => requireSameOrganization(member, member.organizationId));
  assert.throws(() => requireSameOrganization(member, crypto.randomUUID()), AuthorizationError);
});
