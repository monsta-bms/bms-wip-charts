import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const REQUIRED_SECRET_NAMES = Object.freeze([
  "ADMIN_TOKEN",
  "PASSWORD_HASH_SECRET",
  "ABUSE_HASH_SECRET",
  "WITHDRAWAL_IDEMPOTENCY_SECRET",
  "TURNSTILE_SECRET",
  "TURNSTILE_MODE"
]);

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workerRoot, "..");
const requiredColumns = Object.freeze({
  versions: ["password_hash_version"],
  post_logs: ["fingerprint_hash_version"],
  bans: ["ban_hash_version"],
  version_withdrawals: ["idempotency_hash_version", "fingerprint_hash_version"],
  delete_requests: ["fingerprint_hash_version"]
});

const countQueries = Object.freeze({
  legacy_password_count: "SELECT COUNT(*) AS count FROM versions WHERE password_hash_version = 1",
  legacy_post_log_count: "SELECT COUNT(*) AS count FROM post_logs WHERE fingerprint_hash_version = 1",
  legacy_ban_count: "SELECT COUNT(*) AS count FROM bans WHERE ban_type IN ('ip_hash', 'ua_hash') AND ban_hash_version = 1",
  legacy_withdrawal_terminal_count: "SELECT COUNT(*) AS count FROM version_withdrawals WHERE idempotency_hash_version = 1 AND status NOT IN ('pending', 'processing')",
  legacy_withdrawal_pending_count: "SELECT COUNT(*) AS count FROM version_withdrawals WHERE idempotency_hash_version = 1 AND status = 'pending'",
  legacy_withdrawal_processing_count: "SELECT COUNT(*) AS count FROM version_withdrawals WHERE idempotency_hash_version = 1 AND status = 'processing'",
  legacy_delete_request_count: "SELECT COUNT(*) AS count FROM delete_requests WHERE fingerprint_hash_version = 1",
  version2_password_count: "SELECT COUNT(*) AS count FROM versions WHERE password_hash_version = 2",
  version2_post_log_count: "SELECT COUNT(*) AS count FROM post_logs WHERE fingerprint_hash_version = 2",
  version2_ban_count: "SELECT COUNT(*) AS count FROM bans WHERE ban_hash_version = 2",
  version2_withdrawal_count: "SELECT COUNT(*) AS count FROM version_withdrawals WHERE idempotency_hash_version = 2",
  version2_delete_request_count: "SELECT COUNT(*) AS count FROM delete_requests WHERE fingerprint_hash_version = 2"
});

function productionLegacySecretReferenceCount() {
  const sourceRoot = resolve(workerRoot, "src");
  const pending = [sourceRoot];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const matches = readFileSync(path, "utf8").match(/\bHASH_SECRET\b/gu);
        count += matches?.length ?? 0;
      }
    }
  }
  return count;
}

function hasRequiredSchema(readColumns) {
  return Object.entries(requiredColumns).every(([table, columns]) => {
    const present = new Set(readColumns(table));
    return columns.every((column) => present.has(column));
  });
}

export function evaluateCutoverSnapshot({ schemaReady, counts, secretNames, legacySecretReferenceCount }) {
  const configured = new Set(secretNames);
  const missingSecretCount = REQUIRED_SECRET_NAMES.filter((name) => !configured.has(name)).length;
  const version2Total = Object.entries(counts)
    .filter(([name]) => name.startsWith("version2_"))
    .reduce((total, [, value]) => total + Number(value ?? 0), 0);
  const summary = Object.freeze({
    schema_ready: schemaReady,
    legacy_secret_reference_count: legacySecretReferenceCount,
    missing_required_secret_count: missingSecretCount,
    ...counts,
    version2_total_count: version2Total
  });
  if (legacySecretReferenceCount > 0) {
    return { outcome: "SECURITY_HASH_CUTOVER_LEGACY_SECRET_REFERENCE", summary };
  }
  if (!schemaReady || missingSecretCount > 0) {
    return { outcome: "SECURITY_HASH_CUTOVER_SCHEMA_NOT_READY", summary };
  }
  if (
    Number(counts.legacy_withdrawal_pending_count ?? 0) > 0
    || Number(counts.legacy_withdrawal_processing_count ?? 0) > 0
  ) {
    return { outcome: "SECURITY_HASH_CUTOVER_BLOCKED_ACTIVE_WITHDRAWALS", summary };
  }
  return { outcome: "SECURITY_HASH_CUTOVER_READY", summary };
}

export function inspectLocalDatabase(databasePath, secretNames) {
  if (!existsSync(databasePath)) {
    throw new Error("Local database file does not exist.");
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const schemaReady = hasRequiredSchema((table) =>
      database.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name))
    );
    const counts = schemaReady
      ? Object.fromEntries(Object.entries(countQueries).map(([name, sql]) => [
          name,
          Number(database.prepare(sql).get()?.count ?? 0)
        ]))
      : {};
    return evaluateCutoverSnapshot({
      schemaReady,
      counts,
      secretNames,
      legacySecretReferenceCount: productionLegacySecretReferenceCount()
    });
  } finally {
    database.close();
  }
}

function wranglerExecutable() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function runWranglerJson(args) {
  return JSON.parse(runWranglerText(args));
}

function runWranglerText(args) {
  return execFileSync(wranglerExecutable(), ["wrangler", ...args], {
    cwd: workerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function extractD1Rows(payload) {
  const blocks = Array.isArray(payload) ? payload : [payload];
  return blocks.flatMap((block) => block?.results ?? block?.result?.[0]?.results ?? []);
}

export function parseVersionSecretNames(output) {
  return [...output.matchAll(/^Secret Name:\s+([A-Z0-9_]+)\s*$/gmu)]
    .map((match) => match[1]);
}

export function inspectRemoteDatabase(configPath = resolve(workerRoot, "wrangler.toml")) {
  const common = ["--config", configPath];
  const columnsByTable = {};
  for (const table of Object.keys(requiredColumns)) {
    const payload = runWranglerJson([
      "d1", "execute", "DB", "--remote", "--json", "--command", `PRAGMA table_info(${table})`, ...common
    ]);
    columnsByTable[table] = extractD1Rows(payload).map((row) => String(row.name));
  }
  const schemaReady = hasRequiredSchema((table) => columnsByTable[table] ?? []);
  const counts = {};
  if (schemaReady) {
    for (const [name, sql] of Object.entries(countQueries)) {
      const payload = runWranglerJson([
        "d1", "execute", "DB", "--remote", "--json", "--command", sql, ...common
      ]);
      counts[name] = Number(extractD1Rows(payload)[0]?.count ?? 0);
    }
  }
  const secretOutput = runWranglerText([
    "versions", "secret", "list", "--latest-version", ...common
  ]);
  const secretNames = parseVersionSecretNames(secretOutput);
  return evaluateCutoverSnapshot({
    schemaReady,
    counts,
    secretNames,
    legacySecretReferenceCount: productionLegacySecretReferenceCount()
  });
}

function parseArguments(argv) {
  const options = { remote: false, local: "", config: resolve(workerRoot, "wrangler.toml"), secretNames: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--remote") options.remote = true;
    else if (argument === "--local") options.local = resolve(argv[++index] ?? "");
    else if (argument === "--config") options.config = resolve(argv[++index] ?? "");
    else if (argument === "--secret-names") options.secretNames = (argv[++index] ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    else throw new Error("Unknown preflight argument.");
  }
  if (options.remote === Boolean(options.local)) {
    throw new Error("Specify exactly one of --remote or --local <database>.");
  }
  return options;
}

function printResult(result) {
  for (const [name, value] of Object.entries(result.summary)) {
    console.log(`${name}=${typeof value === "boolean" ? (value ? 1 : 0) : value}`);
  }
  console.log(result.outcome);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = options.remote
      ? inspectRemoteDatabase(options.config)
      : inspectLocalDatabase(options.local, options.secretNames);
    printResult(result);
    process.exitCode = result.outcome === "SECURITY_HASH_CUTOVER_READY" ? 0 : 2;
  } catch (error) {
    console.error("[security-hash-cutover-preflight] failed", {
      code: "SECURITY_HASH_PREFLIGHT_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  }
}
