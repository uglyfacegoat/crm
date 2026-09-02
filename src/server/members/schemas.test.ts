import assert from "node:assert/strict";
import test from "node:test";
import { createMemberSchema, resetMemberPasswordSchema, updateMemberAccessSchema } from "./schemas.ts";

const base = {
  idempotencyKey: "8f028fbd-4937-4598-85ce-3a0d972d5f07",
  displayName: "Алексей Смирнов",
  email: "master@example.local",
  phone: "+7 999 123-45-67",
  password: "SecurePassword2026",
};

test("master account requires an explicit master profile", () => {
  assert.equal(createMemberSchema.safeParse({ ...base, role: "master", masterId: "2cad58eb-c26a-4f0d-9d44-f79a01abb953" }).success, true);
  assert.equal(createMemberSchema.safeParse({ ...base, role: "master", masterId: "" }).success, false);
  assert.equal(createMemberSchema.safeParse({ ...base, role: "dispatcher", masterId: "2cad58eb-c26a-4f0d-9d44-f79a01abb953" }).success, false);
});

test("member access update requires a version and consistent role link", () => {
  const input = { memberId: "5b5ab8ec-8e07-4bc8-8f83-d2a383bd9d51", expectedVersion: 2, active: true, role: "dispatcher", masterId: "" };
  assert.equal(updateMemberAccessSchema.safeParse(input).success, true);
  assert.equal(updateMemberAccessSchema.safeParse({ ...input, expectedVersion: 0 }).success, false);
});

test("administrative password reset requires a strong matching password and version", () => {
  const input = {
    idempotencyKey: "8f028fbd-4937-4598-85ce-3a0d972d5f07",
    memberId: "5b5ab8ec-8e07-4bc8-8f83-d2a383bd9d51",
    expectedVersion: 3,
    password: "ReplacementPassword2026",
    passwordConfirmation: "ReplacementPassword2026",
  };
  assert.equal(resetMemberPasswordSchema.safeParse(input).success, true);
  assert.equal(resetMemberPasswordSchema.safeParse({ ...input, passwordConfirmation: "DifferentPassword2026" }).success, false);
  assert.equal(resetMemberPasswordSchema.safeParse({ ...input, password: "short", passwordConfirmation: "short" }).success, false);
  assert.equal(resetMemberPasswordSchema.safeParse({ ...input, expectedVersion: 0 }).success, false);
});
