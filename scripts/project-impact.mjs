#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const configPath = path.join(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsedConfig = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && extensions.has(path.extname(entry.name)) && !entry.name.endsWith(".test.ts")
      ? [full]
      : [];
  });
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function resolveImport(specifier, from) {
  const resolved = ts.resolveModuleName(specifier, from, parsedConfig.options, ts.sys).resolvedModule?.resolvedFileName;
  return resolved && resolved.startsWith(sourceRoot + path.sep) ? path.resolve(resolved) : null;
}

const files = sourceFiles(sourceRoot);
const fileSet = new Set(files);
const dependencies = new Map();
const importers = new Map(files.map((file) => [file, new Set()]));
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const imports = ts.preProcessFile(source, true, true).importedFiles;
  const targets = new Set(imports.map(({ fileName }) => resolveImport(fileName, file)).filter((target) => target && fileSet.has(target)));
  dependencies.set(file, targets);
  for (const target of targets) importers.get(target).add(file);
}

const input = process.argv[2];
if (!input) {
  process.stderr.write("Использование: npm run map:impact -- src/путь/к/файлу.tsx\n");
  process.exitCode = 1;
} else {
  const target = path.resolve(root, input);
  if (!existsSync(target) || !fileSet.has(target)) {
    process.stderr.write(`Файл не найден в src: ${input}\n`);
    process.exitCode = 1;
  } else {
    const visited = new Set([target]);
    const queue = [target];
    while (queue.length) {
      for (const parent of importers.get(queue.shift()) ?? []) {
        if (visited.has(parent)) continue;
        visited.add(parent);
        queue.push(parent);
      }
    }
    const entryPoint = (file) => /\/app\/.*\/(?:page|actions|route)\.[cm]?[jt]sx?$/.test(file) || /\/app\/\(workspace\)\/(?:page|actions)\.tsx?$/.test(file);
    const direct = [...importers.get(target)].map(relative).sort();
    const entries = [...visited].filter(entryPoint).map(relative).sort();
    process.stdout.write(`Файл: ${relative(target)}\n\n`);
    process.stdout.write(`Импортирует напрямую (${dependencies.get(target).size}):\n${[...dependencies.get(target)].map(relative).sort().map((file) => `  ${file}`).join("\n") || "  —"}\n\n`);
    process.stdout.write(`Его импортируют напрямую (${direct.length}):\n${direct.map((file) => `  ${file}`).join("\n") || "  —"}\n\n`);
    process.stdout.write(`Затронутые точки входа по графу импортов (${entries.length}):\n${entries.map((file) => `  ${file}`).join("\n") || "  —"}\n\n`);
    process.stdout.write(`Всего зависимых файлов: ${visited.size - 1}. Это граф статических импортов, а не замена карте сценариев и проверке прав/данных.\n`);
  }
}
