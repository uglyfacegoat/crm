import assert from "node:assert/strict";
import test from "node:test";
import { CsvParseError, parseCsv } from "./csv.ts";

test("parseCsv supports BOM, semicolons, escaped quotes and embedded newlines", () => {
  const parsed = parseCsv('\ufeffexternal_id;legal_name;notes\r\nc-1;"ООО ""Альфа""";"первая\nстрока"');
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["external_id", "legal_name", "notes"]);
  assert.equal(parsed.rows[0].values.legal_name, 'ООО "Альфа"');
  assert.equal(parsed.rows[0].values.notes, "первая\nстрока");
});

test("parseCsv detects comma-delimited files", () => {
  const parsed = parseCsv("external_id,name\na-1,Объект");
  assert.equal(parsed.delimiter, ",");
  assert.equal(parsed.rows[0].rowNumber, 2);
});

test("parseCsv rejects malformed rows and quotes", () => {
  assert.throws(() => parseCsv("a;b\n1"), CsvParseError);
  assert.throws(() => parseCsv('a;b\n"1;2'), CsvParseError);
  assert.throws(() => parseCsv("a;a\n1;2"), CsvParseError);
});
