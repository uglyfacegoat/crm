import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveServiceChoice } from "./service-choice.ts";

const service = { id: "service", kind: "service" as const, name: "Обработка", unit: "м²", priceMode: "fixed" as const, defaultPriceMinor: 2500 };

test("area service uses the object's area and the catalog price", () => {
  const selected = resolveServiceChoice(service, "300,25");
  assert.equal(selected.quantity, "300.25");
  assert.equal(selected.unitPrice, "25.00");
  assert.equal(Number(selected.quantity) * Number(selected.unitPrice), 7506.25);
  assert.equal(selected.name, service.name);
});

test("an area service without a measurement requires manual quantity", () => {
  for (const area of [undefined, null, "", "0", "-2", "oops"]) assert.equal(resolveServiceChoice(service, area).quantity, "");
  assert.equal(resolveServiceChoice({ ...service, unit: "выезд" }, "300").quantity, "1");
});

test("zero prices stay zero and prices to be agreed stay empty", () => {
  assert.equal(resolveServiceChoice({ ...service, defaultPriceMinor: 0 }, "10").unitPrice, "0.00");
  assert.equal(resolveServiceChoice({ ...service, defaultPriceMinor: null }, "10").unitPrice, "");
});
