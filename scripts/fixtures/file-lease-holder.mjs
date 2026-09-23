import { withFileWriteLease } from "../../src/server/file-writes/gate.mjs";

await withFileWriteLease(async () => {
  process.stdout.write("leased\n");
  await new Promise(() => {});
});
