import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Upstream fix: https://github.com/porsager/postgres/pull/1168
// Remove this after a released postgres version contains the same guard.
const packageRoot = resolve(import.meta.dirname, "../node_modules/postgres");
const pkg = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
assert.equal(pkg.version, "3.4.9", "Recheck the postgres null-socket patch when upgrading postgres");

const original = "    const x = socket.write(chunk, fn)\n    nextWriteTimer !== null && clearImmediate(nextWriteTimer)";
const patched = "    const x = socket ? socket.write(chunk, fn) : false\n    nextWriteTimer !== null && clearImmediate(nextWriteTimer)";
for (const path of ["src/connection.js", "cjs/src/connection.js"]) {
  const target = resolve(packageRoot, path);
  const source = await readFile(target, "utf8");
  if (source.includes(patched)) continue;
  assert.equal(source.split(original).length, 2, `Unexpected postgres connection code in ${path}`);
  await writeFile(target, source.replace(original, patched));
}
