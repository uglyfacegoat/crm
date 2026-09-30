import { recordFileWriteKey, withFileWriteLease } from "../../src/server/file-writes/gate.mjs";

await withFileWriteLease(async () => {
  await recordFileWriteKey("tenant/interrupted/v1.pdf");
  process.stdout.write("leased\n");
  await new Promise(() => {});
});
