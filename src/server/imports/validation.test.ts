import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "./csv.ts";
import type { ImportValidationContext } from "./types";
import { validateImportPackage } from "./validation.ts";

const emptyContext: ImportValidationContext = {
  existingClientTaxIds: new Set(),
  existingOrderNumbers: new Set(),
  existingLinks: new Set(),
};

test("validateImportPackage accepts a connected CRM CSV v1 package", () => {
  const result = validateImportPackage({
    clients: parseCsv("external_id;legal_name;kind;tax_id;phone;email\nc-1;ООО Альфа;legal_entity;7701234567;+74951234567;office@example.ru"),
    objects: parseCsv("external_id;client_external_id;name;object_type;address\no-1;c-1;Склад;Склад;Москва, ул. Ленина, 1"),
    orders: parseCsv("external_id;order_number;client_external_id;object_external_id;status;currency;agreed_total_rub;notes\nr-1;OLD-1;c-1;o-1;new;RUB;15000;"),
    services: parseCsv("external_id;order_external_id;name;quantity;unit_price_rub\ns-1;r-1;Дератизация;1;15000"),
    documents: parseCsv("external_id;order_external_id;title;category;filename\nd-1;r-1;Договор;contract;contract.pdf"),
  }, emptyContext);
  assert.equal(result.status, "ready");
  assert.equal(result.errorCount, 0);
  assert.equal(result.totalRows, 5);
});

test("validateImportPackage blocks broken references, duplicates and missing services", () => {
  const result = validateImportPackage({
    clients: parseCsv("external_id;legal_name;kind;tax_id;phone;email\nc-1;ООО Альфа;legal_entity;7701234567;;\nc-1;ООО Бета;legal_entity;7701234568;;"),
    orders: parseCsv("external_id;order_number;client_external_id;object_external_id;status;currency;agreed_total_rub;notes\nr-1;OLD-1;c-404;o-404;new;RUB;1000;"),
  }, emptyContext);
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "duplicate_external_id"));
  assert.ok(result.issues.some((issue) => issue.code === "missing_client_reference"));
  assert.ok(result.issues.some((issue) => issue.code === "order_without_services"));
});

test("validateImportPackage warns about existing linked records and total mismatch", () => {
  const result = validateImportPackage({
    orders: parseCsv("external_id;order_number;client_external_id;object_external_id;status;currency;agreed_total_rub;notes\nr-1;OLD-1;c-1;o-1;new;RUB;1000;"),
    services: parseCsv("external_id;order_external_id;name;quantity;unit_price_rub\ns-1;r-1;Обработка;1;900"),
  }, { existingClientTaxIds: new Set(), existingOrderNumbers: new Set(["OLD-1"]), existingLinks: new Set(["client:c-1", "object:o-1", "order:r-1"]) });
  assert.equal(result.status, "ready");
  assert.ok(result.issues.some((issue) => issue.code === "already_imported"));
  assert.ok(result.issues.some((issue) => issue.code === "order_total_mismatch"));
});
