import assert from "node:assert/strict";
import test from "node:test";
import { configureWebsiteIntegrationSchema, createWebsiteSchema } from "./schemas.ts";

test("website input accepts a normalized hostname and rejects URLs", () => {
  const valid = createWebsiteSchema.parse({ idempotencyKey: crypto.randomUUID(), name: "ДезСервис Москва", domain: "DEZ-SERVICE.RU" });
  assert.equal(valid.domain, "dez-service.ru");
  assert.equal(createWebsiteSchema.safeParse({ idempotencyKey: crypto.randomUUID(), name: "Сайт", domain: "https://example.ru/path" }).success, false);
});

test("integration input stores only a secret reference, not a credential", () => {
  assert.equal(configureWebsiteIntegrationSchema.safeParse({ idempotencyKey: crypto.randomUUID(), websiteId: crypto.randomUUID(), provider: "yandex_metrica", propertyId: "12345678", secretReference: "YANDEX_METRICA_MAIN_TOKEN" }).success, true);
  assert.equal(configureWebsiteIntegrationSchema.safeParse({ idempotencyKey: crypto.randomUUID(), websiteId: crypto.randomUUID(), provider: "ga4", propertyId: "42", secretReference: "ya29.actual-token" }).success, false);
});
