import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("calendar exposes the complete operational filter set", async () => {
  const source = await readFile(new URL("../src/components/calendar/calendar-workspace.tsx", import.meta.url), "utf8");

  for (const filter of ["query", "master", "region", "client", "object", "status", "service"]) {
    assert.match(source, new RegExp(`data-calendar-filter=\"${filter}\"`));
  }
  assert.match(source, /serviceSummary/);
  assert.match(source, /masterRegion/);
});
