import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("../src/components/quick-order/quick-order-workspace.tsx", import.meta.url);

test("quick order renders one continuous workspace with stable navigation landmarks", async () => {
  const source = await readFile(componentUrl, "utf8");

  for (const sectionId of ["quick-client-section", "quick-object-section", "quick-work-section", "quick-visit-section"]) {
    assert.match(source, new RegExp(`id=[{]?\"${sectionId}\"`));
  }

  assert.match(source, /data-testid="quick-order-summary"/);
  assert.match(source, /data-testid="quick-next"/);
  assert.match(source, /data-testid="quick-submit"/);
  assert.doesNotMatch(source, /step === [0-3] \?/);
});

test("continue and final submit have distinct DOM identities", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /key="continue"\s+data-testid="quick-next"\s+type="button"/);
  assert.match(source, /key="submit"\s+data-testid="quick-submit"\s+type="submit"/);
});
