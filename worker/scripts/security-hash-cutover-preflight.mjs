import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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
const WRANGLER_TIMEOUT_MS = 30_000;
const requiredColumns = Object.freeze({
  versions: ["password_hash_version"],
  post_logs: ["fingerprint_hash_version"],
  bans: ["ban_hash_version"],
  version_withdrawals: ["idempotency_hash_version", "fingerprint_hash_version"],
  delete_requests: ["fingerprint_hash_version"]
});

const activeWithdrawalCountQueries = Object.freeze({
  legacy_withdrawal_pending_count:
    "SELECT COUNT(*) AS count FROM version_withdrawals WHERE status = 'pending'",
  legacy_withdrawal_processing_count:
    "SELECT COUNT(*) AS count FROM version_withdrawals WHERE status = 'processing'"
});

const versionedCountQueries = Object.freeze({
  legacy_password_count: "SELECT COUNT(*) AS count FROM versions WHERE password_hash_version = 1",
  legacy_post_log_count: "SELECT COUNT(*) AS count FROM post_logs WHERE fingerprint_hash_version = 1",
  legacy_ban_count: "SELECT COUNT(*) AS count FROM bans WHERE ban_type IN ('ip_hash', 'ua_hash') AND ban_hash_version = 1",
  legacy_withdrawal_terminal_count: "SELECT COUNT(*) AS count FROM version_withdrawals WHERE idempotency_hash_version = 1 AND status NOT IN ('pending', 'processing')",
  legacy_delete_request_count: "SELECT COUNT(*) AS count FROM delete_requests WHERE fingerprint_hash_version = 1",
  version2_password_count: "SELECT COUNT(*) AS count FROM versions WHERE password_hash_version = 2",
  version2_post_log_count: "SELECT COUNT(*) AS count FROM post_logs WHERE fingerprint_hash_version = 2",
  version2_ban_count: "SELECT COUNT(*) AS count FROM bans WHERE ban_hash_version = 2",
  version2_withdrawal_count: "SELECT COUNT(*) AS count FROM version_withdrawals WHERE idempotency_hash_version = 2",
  version2_delete_request_count: "SELECT COUNT(*) AS count FROM delete_requests WHERE fingerprint_hash_version = 2"
});

export class SecurityHashPreflightError extends Error {
  constructor(code) {
    super(code);
    this.name = "SecurityHashPreflightError";
    this.code = code;
  }
}

function productionLegacySecretReferenceCount() {
  const pending = [resolve(workerRoot, "src")];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        count += readFileSync(path, "utf8").match(/\bHASH_SECRET\b/gu)?.length ?? 0;
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
  if (
    Number(counts.legacy_withdrawal_pending_count ?? 0) > 0
    || Number(counts.legacy_withdrawal_processing_count ?? 0) > 0
  ) {
    return { outcome: "SECURITY_HASH_CUTOVER_BLOCKED_ACTIVE_WITHDRAWALS", summary };
  }
  if (!schemaReady || missingSecretCount > 0) {
    return { outcome: "SECURITY_HASH_CUTOVER_SCHEMA_NOT_READY", summary };
  }
  return { outcome: "SECURITY_HASH_CUTOVER_READY", summary };
}

function localActiveCounts(database) {
  const exists = database.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'version_withdrawals'
  `).get();
  if (Number(exists?.count ?? 0) !== 1) {
    return Object.fromEntries(Object.keys(activeWithdrawalCountQueries).map((name) => [name, 0]));
  }
  return Object.fromEntries(Object.entries(activeWithdrawalCountQueries).map(([name, sql]) => [
    name,
    Number(database.prepare(sql).get()?.count ?? 0)
  ]));
}

export function inspectLocalDatabase(databasePath, secretNames) {
  if (!existsSync(databasePath)) throw new SecurityHashPreflightError("LOCAL_DATABASE_NOT_FOUND");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const schemaReady = hasRequiredSchema((table) =>
      database.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name))
    );
    const counts = {
      ...localActiveCounts(database),
      ...(schemaReady
        ? Object.fromEntries(Object.entries(versionedCountQueries).map(([name, sql]) => [
            name,
            Number(database.prepare(sql).get()?.count ?? 0)
          ]))
        : {})
    };
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

export function resolveWranglerEntrypoint({
  root = workerRoot,
  readText = (path) => readFileSync(path, "utf8"),
  pathExists = existsSync
} = {}) {
  const packageRoot = resolve(root, "node_modules", "wrangler");
  const packagePath = resolve(packageRoot, "package.json");
  if (!pathExists(packagePath)) throw new SecurityHashPreflightError("WRANGLER_PACKAGE_NOT_FOUND");
  let metadata;
  try {
    metadata = JSON.parse(readText(packagePath));
  } catch {
    throw new SecurityHashPreflightError("WRANGLER_PACKAGE_INVALID");
  }
  const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.wrangler;
  if (typeof bin !== "string" || !bin.trim()) {
    throw new SecurityHashPreflightError("WRANGLER_BIN_NOT_FOUND");
  }
  const entrypoint = resolve(packageRoot, bin);
  const escaped = relative(packageRoot, entrypoint).startsWith("..");
  if (escaped || !pathExists(entrypoint)) {
    throw new SecurityHashPreflightError("WRANGLER_ENTRYPOINT_NOT_FOUND");
  }
  return entrypoint;
}

export function runWranglerProcess(args, {
  root = workerRoot,
  spawnSyncImpl = spawnSync,
  timeoutMs = WRANGLER_TIMEOUT_MS
} = {}) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new SecurityHashPreflightError("WRANGLER_ARGUMENTS_INVALID");
  }
  const entrypoint = resolveWranglerEntrypoint({ root });
  const result = spawnSyncImpl(process.execPath, [entrypoint, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result?.error?.code === "ETIMEDOUT" || result?.signal) {
    throw new SecurityHashPreflightError("WRANGLER_PROCESS_TIMEOUT");
  }
  if (result?.error || result?.status !== 0 || typeof result?.stdout !== "string") {
    throw new SecurityHashPreflightError("WRANGLER_PROCESS_FAILED");
  }
  return result.stdout;
}

export function parseWranglerJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new SecurityHashPreflightError("WRANGLER_JSON_INVALID");
  }
}

function runWranglerJson(args, dependencies) {
  return parseWranglerJson(runWranglerProcess(args, dependencies));
}

function extractD1Rows(payload) {
  const blocks = Array.isArray(payload) ? payload : [payload];
  return blocks.flatMap((block) => block?.results ?? block?.result?.[0]?.results ?? []);
}

export function parseSecretListNames(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.secrets)
      ? payload.secrets
      : [];
  return candidates
    .map((entry) => typeof entry?.name === "string" ? entry.name : "")
    .filter((name) => /^[A-Z0-9_]+$/u.test(name));
}

export function inspectRemoteDatabase(
  configPath = resolve(workerRoot, "wrangler.toml"),
  dependencies = {}
) {
  const runJson = dependencies.runJson
    ?? ((args) => runWranglerJson(args, dependencies));
  const common = ["--config", configPath];
  const columnsByTable = {};
  for (const table of Object.keys(requiredColumns)) {
    const payload = runJson([
      "d1", "execute", "DB", "--remote", "--json", "--command",
      `PRAGMA table_info(${table})`, ...common
    ]);
    columnsByTable[table] = extractD1Rows(payload).map((row) => String(row.name));
  }
  const schemaReady = hasRequiredSchema((table) => columnsByTable[table] ?? []);
  const counts = {};
  for (const [name, sql] of Object.entries(activeWithdrawalCountQueries)) {
    const payload = runJson([
      "d1", "execute", "DB", "--remote", "--json", "--command", sql, ...common
    ]);
    counts[name] = Number(extractD1Rows(payload)[0]?.count ?? 0);
  }
  if (schemaReady) {
    for (const [name, sql] of Object.entries(versionedCountQueries)) {
      const payload = runJson([
        "d1", "execute", "DB", "--remote", "--json", "--command", sql, ...common
      ]);
      counts[name] = Number(extractD1Rows(payload)[0]?.count ?? 0);
    }
  }
  const secretNames = parseSecretListNames(runJson([
    "secret", "list", "--format", "json", ...common
  ]));
  return evaluateCutoverSnapshot({
    schemaReady,
    counts,
    secretNames,
    legacySecretReferenceCount: productionLegacySecretReferenceCount()
  });
}

function parseArguments(argv) {
  const options = {
    remote: false,
    local: "",
    config: resolve(workerRoot, "wrangler.toml"),
    secretNames: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--remote") options.remote = true;
    else if (argument === "--local") options.local = resolve(argv[++index] ?? "");
    else if (argument === "--config") options.config = resolve(argv[++index] ?? "");
    else if (argument === "--secret-names") {
      options.secretNames = (argv[++index] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    } else throw new SecurityHashPreflightError("PREFLIGHT_ARGUMENT_INVALID");
  }
  if (options.remote === Boolean(options.local)) {
    throw new SecurityHashPreflightError("PREFLIGHT_MODE_INVALID");
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
      code: error instanceof SecurityHashPreflightError
        ? error.code
        : "SECURITY_HASH_PREFLIGHT_FAILED"
    });
    process.exitCode = 1;
  }
}
