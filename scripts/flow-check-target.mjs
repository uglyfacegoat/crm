const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BASE_URL_KEY = /(?:^|_)(?:BASE_URL|ORIGIN)$/;

export function assertFlowCheckTarget({ args = process.argv.slice(2), environment = process.env } = {}) {
  if (!args.includes("--allow-working-flow-check")) {
    throw new Error("Browser flow checks can create or delete CRM data. Pass --allow-working-flow-check explicitly after reviewing the target.");
  }
  const remoteTargets = [];
  for (const [key, value] of Object.entries(environment)) {
    if (!BASE_URL_KEY.test(key) || !value || !/^https?:\/\//i.test(value)) continue;
    let parsed;
    try { parsed = new URL(value); }
    catch { throw new Error(`Invalid browser flow target in ${key}.`); }
    if (!LOCAL_HOSTS.has(parsed.hostname)) remoteTargets.push(key);
  }
  if (environment.DATABASE_URL) {
    let database;
    try { database = new URL(environment.DATABASE_URL); }
    catch { throw new Error("Invalid browser flow target in DATABASE_URL."); }
    if (!LOCAL_HOSTS.has(database.hostname)) remoteTargets.push("DATABASE_URL");
  }
  if (remoteTargets.length && !args.includes("--allow-remote-flow-check")) {
    throw new Error(`Remote browser flow target (${remoteTargets.join(", ")}) requires --allow-remote-flow-check as well.`);
  }
}
