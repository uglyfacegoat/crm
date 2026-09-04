import assert from "node:assert/strict";
import test from "node:test";
import { filterPickerOptions } from "./picker-options.ts";

const options = [
  { value: "none", label: "Не назначен" },
  { value: "alexey", label: "Алексей Петров", detail: "+7 (999) 111-22-33" },
  { value: "marina", label: "Марина Соколова", detail: "+7 (916) 444-55-66" },
];

test("picker search matches labels without regard to case", () => {
  assert.deepEqual(filterPickerOptions(options, "ПЕТРОВ"), [options[1]]);
});

test("picker search matches compact phone fragments", () => {
  assert.deepEqual(filterPickerOptions(options, "99911122"), [options[1]]);
});

test("blank picker search preserves option order", () => {
  assert.deepEqual(filterPickerOptions(options, "  "), options);
});
