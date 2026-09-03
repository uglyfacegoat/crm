import assert from "node:assert/strict";
import test from "node:test";
import { configureWebsiteIntegrationSchema, createWebsiteSchema, updateWebsiteInfrastructureSchema } from "./schemas.ts";

const infrastructureInput = {
  websiteId: crypto.randomUUID(), expectedVersion: 1, status: "active", hostingProvider: "Selectel", planName: "Cloud M",
  serverRegion: "Москва", monthlyCostMinor: "4900", renewalOn: "2026-10-03", sslExpiresOn: "2026-12-01",
  diskCapacityMb: 102400, memoryCapacityMb: 8192, notes: "", healthStatus: "healthy", uptimePercent: 99.98,
  responseTimeMs: 184, cpuLoadPercent: 37.2, memoryUsedMb: 4100, diskUsedMb: 38400,
};

test("website input accepts a normalized hostname and rejects URLs", () => {
  const valid = createWebsiteSchema.parse({ idempotencyKey: crypto.randomUUID(), name: "ДезСервис Москва", domain: "DEZ-SERVICE.RU" });
  assert.equal(valid.domain, "dez-service.ru");
  assert.equal(createWebsiteSchema.safeParse({ idempotencyKey: crypto.randomUUID(), name: "Сайт", domain: "https://example.ru/path" }).success, false);
});

test("integration input stores only a secret reference, not a credential", () => {
  assert.equal(configureWebsiteIntegrationSchema.safeParse({ idempotencyKey: crypto.randomUUID(), websiteId: crypto.randomUUID(), provider: "yandex_metrica", propertyId: "12345678", secretReference: "YANDEX_METRICA_MAIN_TOKEN" }).success, true);
  assert.equal(configureWebsiteIntegrationSchema.safeParse({ idempotencyKey: crypto.randomUUID(), websiteId: crypto.randomUUID(), provider: "ga4", propertyId: "42", secretReference: "ya29.actual-token" }).success, false);
});

test("website infrastructure validates capacity and money", () => {
  const parsed = updateWebsiteInfrastructureSchema.parse(infrastructureInput);
  assert.equal(parsed.monthlyCostMinor, 490_000);
  assert.equal(updateWebsiteInfrastructureSchema.safeParse({ ...infrastructureInput, diskUsedMb: 200000 }).success, false);
  assert.equal(updateWebsiteInfrastructureSchema.safeParse({ ...infrastructureInput, uptimePercent: 101 }).success, false);
});

test("website infrastructure accepts Russian decimal separators and rejects blank metrics", () => {
  const valid = updateWebsiteInfrastructureSchema.safeParse({ ...infrastructureInput, uptimePercent: "99,98", cpuLoadPercent: "37,2" });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.uptimePercent, 99.98);
    assert.equal(valid.data.cpuLoadPercent, 37.2);
  }
  assert.equal(updateWebsiteInfrastructureSchema.safeParse({ ...infrastructureInput, responseTimeMs: "" }).success, false);
});
