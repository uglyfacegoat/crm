import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLizaNote, isStructuredLizaNote, parseLizaNote } from "./liza-note.ts";

test("edited legacy template keeps its values and matches each service to a separate rate", () => {
  const old = "Название объекта: {{object}}\nПлощадь объекта: 100\nНаименование услуг: Дезинфекция; Дератизация\nЦена за кВ.м.: 0,23\nОбщий чек: 1000\nОбслуживание: два раза в месяц";
  assert.equal(isStructuredLizaNote(old), true);
  const fields = parseLizaNote(old);
  assert.equal(fields.area, "100");
  assert.equal(fields.maintenance, "два раза в месяц");
  assert.deepEqual(fields.serviceRates, [
    { name: "Дезинфекция", pricePerSquareMeter: "" },
    { name: "Дератизация", pricePerSquareMeter: "" },
  ]);
  fields.serviceRates[0].pricePerSquareMeter = "0,07";
  fields.serviceRates[1].pricePerSquareMeter = "0,23";
  assert.deepEqual(parseLizaNote(formatLizaNote(fields)).serviceRates, fields.serviceRates);
  assert.equal(isStructuredLizaNote("Любой свободный текст"), false);
});
