import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PURGE_ERROR_CODES,
  TestDataPurgeError,
  assertR2TargetUnchanged,
  assertSafeLogText,
  assertTargetUnchanged,
  buildD1Batch,
  buildRestorePlanText,
  deleteExactR2Objects,
  encodeR2ObjectKey,
  safeErrorRecord,
  validateManifest
} from "./test-data-purge-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerRoot = resolve(repositoryRoot, "worker");
const ACCOUNT_ID = "68c451b294d091023d5a32b1418c2eee";
const DEFAULT_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
const TABLES = Object.freeze([
  "charts",
  "versions",
  "songs",
  "version_withdrawals",
  "delete_requests",
  "post_logs",
  "version_source_metadata",
  "admin_logs",
  "bans"
]);
const OPERATOR_PATHS = Object.freeze([
  "scripts/admin/test-data-purge-lib.mjs",
  "scripts/admin/test-data-purge.mjs",
  "scripts/test-test-data-purge.mjs"
]);

function fail(code, stage, detail = {}) {
  throw new TestDataPurgeError(code, stage, detail);
}

function parseArguments(argv) {
  const [mode, ...rest] = argv;
  const allowedModes = new Set([
    "inventory",
    "validate-manifest",
    "backup",
    "dry-run",
    "apply-d1",
    "apply-r2",
    "verify",
    "restore-plan"
  ]);
  if (!allowedModes.has(mode)) fail(PURGE_ERROR_CODES.manifestInvalid, "arguments", { reason: "mode" });
  const options = { mode, config: "", manifest: "", outputDir: "", baseUrl: DEFAULT_BASE_URL, adminTokenFile: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--config") options.config = resolve(rest[++index] ?? "");
    else if (value === "--manifest") options.manifest = resolve(rest[++index] ?? "");
    else if (value === "--output-dir") options.outputDir = resolve(rest[++index] ?? "");
    else if (value === "--base-url") options.baseUrl = String(rest[++index] ?? "").replace(/\/+$/u, "");
    else if (value === "--admin-token-file") options.adminTokenFile = resolve(rest[++index] ?? "");
    else fail(PURGE_ERROR_CODES.manifestInvalid, "arguments", { reason: "unknown_argument" });
  }
  if (!isAbsolute(options.config) || !isAbsolute(options.manifest) || !isAbsolute(options.outputDir)) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "arguments", { reason: "absolute_paths_required" });
  }
  const relativeOutput = relative(repositoryRoot, options.outputDir);
  if (relativeOutput === "" || (!relativeOutput.startsWith("..") && !isAbsolute(relativeOutput))) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "arguments", { reason: "output_must_be_outside_repository" });
  }
  if (!/^https:\/\//u.test(options.baseUrl)) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "arguments", { reason: "base_url" });
  }
  return options;
}

async function readJson(path, code = PURGE_ERROR_CODES.manifestInvalid) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(code, "read-json", { file: path.split(/[\\/]/u).at(-1) });
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeSafeLog(path, lines) {
  const text = `${lines.join("\r\n")}\r\n`;
  assertSafeLogText(text);
  await writeFile(path, text, "utf8");
}

async function fileSha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function runProcess(command, args, {
  cwd = repositoryRoot,
  timeout = 120_000,
  maxBuffer = 16 * 1024 * 1024,
  env = process.env,
  stage = "process",
  errorCode = PURGE_ERROR_CODES.dryRunFailed
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer
  });
  if (result.error || result.status !== 0) {
    fail(errorCode, stage, { reason: "process_failed" });
  }
  return result.stdout;
}

function resolveWranglerEntrypoint() {
  const bin = runProcess(process.execPath, ["-e", [
    "const p=require('./node_modules/wrangler/package.json');",
    "process.stdout.write(typeof p.bin==='string'?p.bin:p.bin.wrangler);"
  ].join("")], { cwd: workerRoot }).trim();
  return resolve(workerRoot, "node_modules", "wrangler", bin);
}

function runWrangler(args, options = {}) {
  return runProcess(process.execPath, [resolveWranglerEntrypoint(), ...args], {
    cwd: workerRoot,
    timeout: options.timeout ?? 180_000,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    stage: options.stage ?? "wrangler",
    errorCode: options.errorCode ?? PURGE_ERROR_CODES.dryRunFailed
  });
}

function runWranglerWithRetries(args, { attempts = 3, retryDelayMs = 2_000, ...options } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return runWrangler(args, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
      }
    }
  }
  throw lastError;
}

function parseConfig(text, manifest) {
  const value = (name) => text.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, "mu"))?.[1] ?? "";
  const workerName = value("name");
  const databaseName = value("database_name");
  const databaseId = value("database_id");
  const bucketName = value("bucket_name");
  if (!workerName || !databaseId || databaseName !== manifest.d1DatabaseName || bucketName !== manifest.r2BucketName) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "config", { reason: "binding_mismatch" });
  }
  return { workerName, databaseName, databaseId, bucketName };
}

async function loadContext(options) {
  const manifest = await readJson(options.manifest);
  const candidatePath = resolve(dirname(options.manifest), "test-data-candidates.txt");
  const candidateBytes = await readFile(candidatePath);
  validateManifest(manifest, { candidateBytes });
  const config = parseConfig(await readFile(options.config, "utf8"), manifest);
  await mkdir(options.outputDir, { recursive: true });
  return { ...options, manifest, candidatePath, config };
}

function getApiToken() {
  const payload = JSON.parse(runWrangler(["auth", "token", "--json"]));
  if (typeof payload?.token !== "string" || !payload.token) {
    fail(PURGE_ERROR_CODES.dryRunFailed, "authentication", { reason: "token_missing" });
  }
  return payload.token;
}

async function cloudflareRequest(path, { token, method = "GET", body, raw = false } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (raw) return response;
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("CLOUDFLARE_JSON_INVALID");
  }
  if (!response.ok || payload?.success !== true) throw new Error("CLOUDFLARE_REQUEST_FAILED");
  return payload;
}

async function queryD1(context, entries, { allowWrite = false } = {}) {
  const token = getApiToken();
  const payload = await cloudflareRequest(
    `/accounts/${ACCOUNT_ID}/d1/database/${context.config.databaseId}/query`,
    { token, method: "POST", body: { batch: entries.map(({ sql, params = [] }) => ({ sql, params })) } }
  );
  const results = Array.isArray(payload.result) ? payload.result : [];
  if (results.length !== entries.length || results.some((result) => result?.success !== true)) {
    throw new Error("D1_BATCH_FAILED");
  }
  if (!allowWrite && results.some((result) => Number(result?.meta?.rows_written ?? 0) !== 0
    || result?.meta?.changed_db === true)) {
    throw new Error("D1_READ_ONLY_GUARD_FAILED");
  }
  return results;
}

function placeholders(values) {
  return values.length > 0 ? values.map(() => "?").join(",") : "NULL";
}

function relationSql(table, chartIds, versionIds, columns = "*") {
  return {
    sql: `SELECT ${columns} FROM ${table} WHERE chart_id IN (${placeholders(chartIds)}) OR version_id IN (${placeholders(versionIds)}) ORDER BY id`,
    params: [...chartIds, ...versionIds]
  };
}

async function collectSnapshot(context, { fullRows = false } = {}) {
  const { manifest } = context;
  const related = manifest.relatedRowIdsByTable;
  const adminTargets = [...new Set([
    ...manifest.chartIds,
    ...manifest.versionIds,
    ...related.version_withdrawals,
    ...related.delete_requests
  ])];
  const select = fullRows ? "*" : "id";
  const entries = [
    { name: "charts", sql: `SELECT ${select} FROM charts WHERE id IN (${placeholders(manifest.chartIds)}) ORDER BY id`, params: manifest.chartIds },
    { name: "versions", sql: `SELECT ${fullRows ? "*" : "id,chart_id,parent_version_id,collapsed_by_version_id"} FROM versions WHERE chart_id IN (${placeholders(manifest.chartIds)}) OR id IN (${placeholders(manifest.versionIds)}) ORDER BY id`, params: [...manifest.chartIds, ...manifest.versionIds] },
    { name: "songs", sql: `SELECT ${select} FROM songs WHERE id IN (${placeholders(manifest.songIds)}) ORDER BY id`, params: manifest.songIds },
    { name: "version_withdrawals", ...relationSql("version_withdrawals", manifest.chartIds, manifest.versionIds, fullRows ? "*" : "id") },
    { name: "delete_requests", ...relationSql("delete_requests", manifest.chartIds, manifest.versionIds, fullRows ? "*" : "id") },
    { name: "post_logs", ...relationSql("post_logs", manifest.chartIds, manifest.versionIds, fullRows ? "*" : "id") },
    { name: "version_source_metadata", sql: `SELECT ${fullRows ? "*" : "version_id"} FROM version_source_metadata WHERE version_id IN (${placeholders(manifest.versionIds)}) ORDER BY version_id`, params: manifest.versionIds },
    { name: "admin_logs", sql: `SELECT ${select} FROM admin_logs WHERE target_id IN (${placeholders(adminTargets)}) ORDER BY id`, params: adminTargets },
    { name: "external_references", sql: `SELECT id FROM versions WHERE chart_id NOT IN (${placeholders(manifest.chartIds)}) AND (parent_version_id IN (${placeholders(manifest.versionIds)}) OR collapsed_by_version_id IN (${placeholders(manifest.versionIds)})) ORDER BY id`, params: [...manifest.chartIds, ...manifest.versionIds, ...manifest.versionIds] },
    { name: "song_shares", sql: `SELECT s.id AS song_id,COUNT(c.id) AS chart_count FROM songs s LEFT JOIN charts c ON c.song_id=s.id WHERE s.id IN (${placeholders(manifest.songIds)}) GROUP BY s.id ORDER BY s.id`, params: manifest.songIds },
    { name: "keep_charts", sql: `SELECT COUNT(*) AS count FROM charts WHERE id IN (${placeholders(manifest.keepChartIds)})`, params: manifest.keepChartIds },
    { name: "keep_versions", sql: `SELECT COUNT(*) AS count FROM versions WHERE id IN (${placeholders(manifest.keepVersionIds)})`, params: manifest.keepVersionIds },
    ...TABLES.map((table) => ({ name: `count_${table}`, sql: `SELECT COUNT(*) AS count FROM ${table}`, params: [] })),
    { name: "foreign_key_check", sql: "PRAGMA foreign_key_check", params: [] }
  ];
  const results = await queryD1(context, entries);
  const rows = Object.fromEntries(entries.map((entry, index) => [entry.name, results[index].results ?? []]));
  const snapshot = {
    chartIds: rows.charts.map((row) => row.id),
    versionRows: rows.versions.map((row) => ({
      id: row.id,
      chart_id: row.chart_id,
      parent_version_id: row.parent_version_id,
      collapsed_by_version_id: row.collapsed_by_version_id
    })),
    songIds: rows.songs.map((row) => row.id),
    withdrawalIds: rows.version_withdrawals.map((row) => row.id),
    deleteRequestIds: rows.delete_requests.map((row) => row.id),
    postLogIds: rows.post_logs.map((row) => row.id),
    sourceMetadataVersionIds: rows.version_source_metadata.map((row) => row.version_id),
    adminLogIds: rows.admin_logs.map((row) => row.id),
    externalReferenceCount: rows.external_references.length,
    songChartCounts: rows.song_shares,
    keepChartCount: Number(rows.keep_charts[0]?.count ?? 0),
    keepVersionCount: Number(rows.keep_versions[0]?.count ?? 0),
    baselineCounts: Object.fromEntries(TABLES.map((table) => [table, Number(rows[`count_${table}`][0]?.count ?? 0)])),
    foreignKeyViolationCount: rows.foreign_key_check.length
  };
  if (fullRows) snapshot.fullRows = Object.fromEntries(TABLES.map((table) => [table, rows[table] ?? []]));
  return snapshot;
}

async function listR2Objects(context) {
  const token = getApiToken();
  const objects = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ per_page: "1000", ...(cursor ? { cursor } : {}) });
    const payload = await cloudflareRequest(
      `/accounts/${ACCOUNT_ID}/r2/buckets/${encodeURIComponent(context.config.bucketName)}/objects?${query}`,
      { token }
    );
    objects.push(...(payload.result ?? []).map((entry) => ({
      key: entry.key,
      size: Number(entry.size ?? 0),
      etag: entry.etag ?? null,
      uploaded: entry.uploaded ?? null,
      storageClass: entry.storage_class ?? null,
      httpMetadata: entry.http_metadata ?? null,
      customMetadata: entry.custom_metadata ?? null
    })));
    cursor = payload.result_info?.is_truncated ? String(payload.result_info.cursor ?? "") : "";
  } while (cursor);
  return objects;
}

function targetR2Objects(manifest, objects) {
  return objects.filter((object) => manifest.chartIds.some(
    (chartId) => object.key.startsWith(`charts/${chartId}/`)
  ));
}

function keySetDigest(keys) {
  return createHash("sha256").update([...keys].sort().join("\n"), "utf8").digest("hex");
}

function getGitState() {
  const head = runProcess("git", ["rev-parse", "HEAD"]).trim();
  const originMain = runProcess("git", ["rev-parse", "origin/main"]).trim();
  const statusLines = runProcess("git", ["status", "--porcelain=v1", "--untracked-files=all"])
    .split(/\r?\n/u)
    .filter(Boolean);
  const paths = statusLines.map((line) => line.slice(3).replaceAll("\\", "/")).sort();
  const expectedPaths = [...OPERATOR_PATHS].sort();
  const clean = statusLines.length === 0;
  const operatorOnly = statusLines.length === expectedPaths.length
    && statusLines.every((line) => line.startsWith("?? "))
    && paths.every((path, index) => path === expectedPaths[index]);
  return { head, originMain, clean, operatorOnly };
}

function assertRemoteState(context) {
  const git = getGitState();
  if ((!git.clean && !git.operatorOnly)
    || git.head !== context.manifest.sourceCommit
    || git.originMain !== context.manifest.sourceCommit) {
    fail(PURGE_ERROR_CODES.targetChanged, "git", { reason: "remote_head" });
  }
  const deployments = JSON.parse(runWrangler(["deployments", "list", "--config", context.optionsConfig, "--json"]));
  const latest = [...deployments].sort((left, right) => String(right.created_on).localeCompare(String(left.created_on)))[0];
  if (latest?.id !== context.manifest.deploymentId
    || latest?.versions?.length !== 1
    || latest.versions[0].version_id !== context.manifest.workerVersionId
    || Number(latest.versions[0].percentage) !== 100) {
    fail(PURGE_ERROR_CODES.targetChanged, "deployment", { reason: "deployment_changed" });
  }
  return { git, deploymentId: latest.id, workerVersionId: latest.versions[0].version_id, traffic: 100 };
}

async function collectDryRunState(context) {
  const snapshot = await collectSnapshot(context);
  assertTargetUnchanged(context.manifest, snapshot);
  if (snapshot.foreignKeyViolationCount !== 0) {
    fail(PURGE_ERROR_CODES.targetChanged, "d1", { reason: "foreign_key" });
  }
  const objects = await listR2Objects(context);
  const targetObjects = targetR2Objects(context.manifest, objects);
  assertR2TargetUnchanged(context.manifest, targetObjects.map((object) => object.key));
  const remote = assertRemoteState(context);
  return { snapshot, objects, targetObjects, remote };
}

async function requireBackup(context) {
  const result = await readJson(join(context.outputDir, "backup-result.json"), PURGE_ERROR_CODES.backupFailed);
  if (result.status !== "complete" || result.manifestId !== context.manifest.manifestId) {
    fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "result" });
  }
  const privateRoot = resolve(context.outputDir, "backup");
  if (!applyRestrictedAcl(privateRoot).ok) {
    fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "acl" });
  }
  const requiredFiles = [
    ["d1FullExport", result.d1FullExportPath],
    ["d1SchemaExport", result.d1SchemaExportPath],
    ["targetSnapshot", result.targetSnapshotPath],
    ["r2Mapping", result.r2MappingPath]
  ];
  for (const [name, path] of requiredFiles) {
    const relativePath = relative(privateRoot, resolve(path));
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "path_scope" });
    }
    if ((await stat(path)).size <= 0) fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "empty_file" });
    if (!/^[0-9a-f]{64}$/u.test(String(result.backupFileSha256?.[name] ?? ""))
      || await fileSha256(path) !== result.backupFileSha256[name]) {
      fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "file_integrity" });
    }
  }
  if (Number(result.r2ObjectCount) !== context.manifest.expectedObjectCount || result.aclOk !== true) {
    fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "verification" });
  }
  const mapping = await readJson(result.r2MappingPath, PURGE_ERROR_CODES.backupFailed);
  if (mapping.manifestId !== context.manifest.manifestId
    || !Array.isArray(mapping.objects)
    || mapping.objects.length !== context.manifest.expectedObjectCount) {
    fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "r2_mapping" });
  }
  assertR2TargetUnchanged(context.manifest, mapping.objects.map((object) => object.key));
  for (const object of mapping.objects) {
    if (!/^\d{4}\.bin$/u.test(String(object.localFile ?? ""))
      || !Number.isInteger(object.size)
      || object.size < 0
      || !/^[0-9a-f]{64}$/u.test(String(object.sha256 ?? ""))) {
      fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "r2_mapping_entry" });
    }
    const localPath = resolve(result.r2BackupPath, object.localFile);
    const relativePath = relative(resolve(result.r2BackupPath), localPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)
      || (await stat(localPath)).size !== object.size
      || await fileSha256(localPath) !== object.sha256) {
      fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "r2_integrity" });
    }
  }
  return result;
}

function makeSqlPreview(batch) {
  return batch.map((statement, index) => [
    `-- ${index + 1} kind=${statement.kind} table=${statement.table}`,
    `${statement.sql};`,
    `-- parameter_count=${statement.params.length}`
  ].join("\r\n")).join("\r\n\r\n");
}

function applyRestrictedAcl(path) {
  const identity = runProcess("whoami.exe", []).trim();
  const paths = [];
  const visit = (current) => {
    paths.push(current);
    if (statSync(current).isDirectory()) {
      for (const entry of readdirSync(current)) visit(join(current, entry));
    }
  };
  visit(path);
  for (const current of paths) {
    const directory = statSync(current).isDirectory();
    const rights = directory ? "(OI)(CI)F" : "F";
    runProcess("icacls.exe", [
      current,
      "/inheritance:r",
      "/grant:r",
      `${identity}:${rights}`,
      `SYSTEM:${rights}`
    ], {
      timeout: 120_000,
      stage: "backup-acl",
      errorCode: PURGE_ERROR_CODES.backupFailed
    });
  }
  const aclScript = [
    "$items = @((Get-Item -LiteralPath $env:TEST_DATA_PURGE_ACL_PATH)) + @(Get-ChildItem -LiteralPath $env:TEST_DATA_PURGE_ACL_PATH -Force -Recurse)",
    "$bad = 0",
    "foreach ($item in $items) {",
    "  $entries = @((Get-Acl -LiteralPath $item.FullName).Access)",
    "  $allowed = @($env:TEST_DATA_PURGE_ACL_IDENTITY.ToLowerInvariant(), 'nt authority\\system', 'system')",
    "  $valid = $entries.Count -eq 2",
    "  $valid = $valid -and (@($entries | Where-Object { $allowed -contains $_.IdentityReference.Value.ToLowerInvariant() }).Count -eq 2)",
    "  $valid = $valid -and (@($entries | Where-Object { $_.IsInherited -or $_.AccessControlType.ToString() -ne 'Allow' -or -not $_.FileSystemRights.ToString().Contains('FullControl') }).Count -eq 0)",
    "  $valid = $valid -and (@($entries | Where-Object { $_.IdentityReference.Value.ToLowerInvariant() -eq $env:TEST_DATA_PURGE_ACL_IDENTITY.ToLowerInvariant() }).Count -eq 1)",
    "  $valid = $valid -and (@($entries | Where-Object { $_.IdentityReference.Value -match '(?i)(^|\\\\)SYSTEM$' }).Count -eq 1)",
    "  if (-not $valid) { $bad += 1 }",
    "}",
    "[pscustomobject]@{ ItemCount = $items.Count; BadCount = $bad } | ConvertTo-Json -Compress"
  ].join("\n");
  const rawAcl = runProcess("powershell.exe", ["-NoProfile", "-Command", aclScript], {
    env: {
      ...process.env,
      TEST_DATA_PURGE_ACL_PATH: path,
      TEST_DATA_PURGE_ACL_IDENTITY: identity
    },
    stage: "backup-acl",
    errorCode: PURGE_ERROR_CODES.backupFailed
  });
  const verification = JSON.parse(rawAcl);
  const ok = Number(verification.ItemCount) === paths.length && Number(verification.BadCount) === 0;
  if (!ok) fail(PURGE_ERROR_CODES.backupFailed, "backup-acl", { reason: "acl" });
  return { ok, identity };
}

async function runBackup(context) {
  const state = await collectDryRunState(context);
  const privateRoot = join(context.outputDir, "backup");
  const r2Root = join(privateRoot, "r2-objects");
  await mkdir(r2Root, { recursive: true });
  applyRestrictedAcl(privateRoot);
  const d1FullExportPath = join(privateRoot, "d1-full.sql");
  const d1SchemaExportPath = join(privateRoot, "d1-schema.sql");
  const exportOptions = {
    timeout: 300_000,
    stage: "d1-export",
    errorCode: PURGE_ERROR_CODES.backupFailed
  };
  runWranglerWithRetries(["d1", "export", context.config.databaseName, "--remote", "--output", d1FullExportPath, "--config", context.optionsConfig, "--y"], exportOptions);
  runWranglerWithRetries(["d1", "export", context.config.databaseName, "--remote", "--output", d1SchemaExportPath, "--no-data", "--config", context.optionsConfig, "--y"], exportOptions);
  if ((await stat(d1FullExportPath)).size <= 0 || (await stat(d1SchemaExportPath)).size <= 0) {
    fail(PURGE_ERROR_CODES.backupFailed, "d1-export", { reason: "empty_export" });
  }

  const fullSnapshot = await collectSnapshot(context, { fullRows: true });
  assertTargetUnchanged(context.manifest, fullSnapshot);
  const targetSnapshotPath = join(privateRoot, "d1-target-rows.json");
  await writeJson(targetSnapshotPath, {
    manifestId: context.manifest.manifestId,
    createdAt: new Date().toISOString(),
    rows: fullSnapshot.fullRows
  });
  await writeJson(join(privateRoot, "row-count-snapshot.json"), {
    manifestId: context.manifest.manifestId,
    baselineCounts: fullSnapshot.baselineCounts,
    expectedTargetCounts: context.manifest.expectedRowCountsByTable
  });
  const batch = buildD1Batch(context.manifest, fullSnapshot);
  await writeFile(join(privateRoot, "delete-sql-preview.sql"), `${makeSqlPreview(batch)}\r\n`, "utf8");

  await writeJson(join(privateRoot, "r2-full-object-inventory.json"), {
    manifestId: context.manifest.manifestId,
    objects: state.objects
  });
  const token = getApiToken();
  const mapping = [];
  for (const [index, object] of state.targetObjects.entries()) {
    const response = await cloudflareRequest(
      `/accounts/${ACCOUNT_ID}/r2/buckets/${encodeURIComponent(context.config.bucketName)}/objects/${encodeR2ObjectKey(object.key)}`,
      { token, raw: true }
    );
    if (!response.ok) fail(PURGE_ERROR_CODES.backupFailed, "r2-backup", { reason: "download" });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== object.size) fail(PURGE_ERROR_CODES.backupFailed, "r2-backup", { reason: "size" });
    const localFile = `${String(index + 1).padStart(4, "0")}.bin`;
    await writeFile(join(r2Root, localFile), bytes);
    mapping.push({ ...object, localFile, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const r2MappingPath = join(privateRoot, "r2-object-mapping.json");
  await writeJson(r2MappingPath, { manifestId: context.manifest.manifestId, objects: mapping });
  const restorePlanPath = join(context.outputDir, "restore-plan.txt");
  await writeFile(restorePlanPath, buildRestorePlanText({
    manifestId: context.manifest.manifestId,
    d1BackupPath: d1FullExportPath,
    r2BackupPath: r2Root
  }), "utf8");
  const acl = applyRestrictedAcl(privateRoot);
  const result = {
    status: "complete",
    manifestId: context.manifest.manifestId,
    createdAt: new Date().toISOString(),
    d1FullExportPath,
    d1SchemaExportPath,
    targetSnapshotPath,
    r2BackupPath: r2Root,
    r2MappingPath,
    restorePlanPath,
    d1TargetRowCounts: context.manifest.expectedRowCountsByTable,
    r2ObjectCount: mapping.length,
    r2Bytes: mapping.reduce((total, entry) => total + entry.size, 0),
    backupFileSha256: {
      d1FullExport: await fileSha256(d1FullExportPath),
      d1SchemaExport: await fileSha256(d1SchemaExportPath),
      targetSnapshot: await fileSha256(targetSnapshotPath),
      r2Mapping: await fileSha256(r2MappingPath)
    },
    aclOk: acl.ok,
    productionWriteCount: 0
  };
  await writeJson(join(context.outputDir, "backup-result.json"), result);
  await writeSafeLog(join(context.outputDir, "backup.log"), [
    `manifest_id=${context.manifest.manifestId}`,
    "d1_full_export=complete",
    "d1_schema_export=complete",
    `d1_target_rows=${Object.values(context.manifest.expectedRowCountsByTable).reduce((a, b) => a + b, 0)}`,
    `r2_objects=${mapping.length}`,
    `r2_bytes=${result.r2Bytes}`,
    "acl=restricted",
    "production_writes=0",
    "status=TEST_DATA_PURGE_BACKUP_COMPLETE"
  ]);
  return result;
}

async function runDryRun(context, { writeResult = true, requireBackupResult = true } = {}) {
  const backup = requireBackupResult ? await requireBackup(context) : null;
  const state = await collectDryRunState(context);
  const batch = buildD1Batch(context.manifest, state.snapshot);
  const outsideKeys = state.objects
    .map((object) => object.key)
    .filter((key) => !context.manifest.r2ExactObjectKeys.includes(key));
  const result = {
    status: "complete",
    manifestId: context.manifest.manifestId,
    createdAt: new Date().toISOString(),
    sourceCommit: context.manifest.sourceCommit,
    workerVersionId: state.remote.workerVersionId,
    deploymentId: state.remote.deploymentId,
    traffic: state.remote.traffic,
    targetRowCounts: context.manifest.expectedRowCountsByTable,
    baselineCounts: state.snapshot.baselineCounts,
    statementCount: batch.length,
    r2TargetCount: state.targetObjects.length,
    r2OutsideCount: outsideKeys.length,
    r2OutsideKeySetDigest: keySetDigest(outsideKeys),
    backupVerified: backup?.status === "complete" || !requireBackupResult,
    productionWriteCount: 0,
    fixedStatusCode: "TEST_DATA_PURGE_DRY_RUN_COMPLETE"
  };
  if (writeResult) {
    await writeJson(join(context.outputDir, "dry-run-result.json"), result);
    await writeSafeLog(join(context.outputDir, "dry-run.log"), [
      `manifest_id=${context.manifest.manifestId}`,
      `statement_count=${batch.length}`,
      `target_rows=${Object.values(context.manifest.expectedRowCountsByTable).reduce((a, b) => a + b, 0)}`,
      `r2_target_objects=${state.targetObjects.length}`,
      "external_references=0",
      "production_writes=0",
      "status=TEST_DATA_PURGE_DRY_RUN_COMPLETE"
    ]);
  }
  return { result, state, batch };
}

async function runApplyD1(context) {
  await requireBackup(context);
  const dryRun = await runDryRun(context, { writeResult: false, requireBackupResult: true });
  const results = await queryD1(context, dryRun.batch, { allowWrite: true });
  const changesByTable = Object.fromEntries(TABLES.map((table) => [table, 0]));
  dryRun.batch.forEach((statement, index) => {
    if (statement.kind !== "delete") return;
    const changes = Number(results[index]?.meta?.changes ?? -1);
    if (changes !== statement.expectedChanges) {
      fail(PURGE_ERROR_CODES.d1Failed, "d1-apply", { table: statement.table, reason: "change_count" });
    }
    changesByTable[statement.table] += changes;
  });
  const purgeResult = {
    status: "d1_complete",
    manifestId: context.manifest.manifestId,
    startedAt: new Date().toISOString(),
    d1ApplyRequestCount: 1,
    d1ChangesByTable: changesByTable,
    d1TotalChanges: Object.values(changesByTable).reduce((a, b) => a + b, 0),
    r2DeleteAttemptCount: 0,
    r2DeletedCount: 0,
    r2FailureCount: 0,
    secretOperationCount: 0,
    workerDeployCount: 0
  };
  await writeJson(join(context.outputDir, "purge-result.json"), purgeResult);
  await writeSafeLog(join(context.outputDir, "purge.log"), [
    `manifest_id=${context.manifest.manifestId}`,
    "d1_apply_requests=1",
    `d1_total_changes=${purgeResult.d1TotalChanges}`,
    "r2_deleted=0",
    "status=TEST_DATA_PURGE_D1_COMPLETE"
  ]);
  return purgeResult;
}

function assertD1PostDeleteState(context, post, dryRun) {
  const targetCounts = {
    charts: post.chartIds.length,
    versions: post.versionRows.length,
    songs: post.songIds.length,
    version_withdrawals: post.withdrawalIds.length,
    delete_requests: post.deleteRequestIds.length,
    post_logs: post.postLogIds.length,
    version_source_metadata: post.sourceMetadataVersionIds.length,
    admin_logs: post.adminLogIds.length
  };
  if (Object.values(targetCounts).some((count) => count !== 0)
    || post.externalReferenceCount !== 0
    || post.foreignKeyViolationCount !== 0
    || post.keepChartCount !== context.manifest.keepChartIds.length
    || post.keepVersionCount !== context.manifest.keepVersionIds.length) {
    fail(PURGE_ERROR_CODES.verifyFailed, "d1-verify", { reason: "target_rows" });
  }
  for (const table of TABLES) {
    const expected = Number(dryRun.baselineCounts[table]) - Number(context.manifest.expectedRowCountsByTable[table]);
    if (post.baselineCounts[table] !== expected) {
      fail(PURGE_ERROR_CODES.verifyFailed, "d1-verify", { table, reason: "outside_count" });
    }
  }
  return targetCounts;
}

async function runApplyR2(context) {
  await requireBackup(context);
  const path = join(context.outputDir, "purge-result.json");
  const purgeResult = await readJson(path, PURGE_ERROR_CODES.r2Failed);
  if (!["d1_complete", "partial_r2_failure"].includes(purgeResult.status)
    || purgeResult.manifestId !== context.manifest.manifestId) {
    fail(PURGE_ERROR_CODES.r2Failed, "r2-apply", { reason: "d1_not_complete" });
  }
  const dryRun = await readJson(join(context.outputDir, "dry-run-result.json"), PURGE_ERROR_CODES.r2Failed);
  assertD1PostDeleteState(context, await collectSnapshot(context), dryRun);
  const token = getApiToken();
  const bucket = encodeURIComponent(context.config.bucketName);
  const deleted = await deleteExactR2Objects({
    keys: context.manifest.r2ExactObjectKeys,
    deleteObject: async (key) => {
      await cloudflareRequest(
        `/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects/${encodeR2ObjectKey(key)}`,
        { token, method: "DELETE" }
      );
    },
    objectExists: async (key) => {
      const response = await cloudflareRequest(
        `/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects/${encodeR2ObjectKey(key)}`,
        { token, raw: true }
      );
      if (response.status === 404) return false;
      if (!response.ok) throw new Error("R2_VERIFY_FAILED");
      return true;
    }
  });
  purgeResult.r2ApplyRunCount = Number(purgeResult.r2ApplyRunCount ?? (purgeResult.status === "partial_r2_failure" ? 1 : 0)) + 1;
  purgeResult.r2DeleteAttemptCount = Number(purgeResult.r2DeleteAttemptCount ?? 0) + deleted.attemptCount;
  purgeResult.r2DeletedCount = deleted.deleted.length;
  purgeResult.r2FailureCount = deleted.failures.length;
  purgeResult.status = deleted.failures.length === 0 ? "complete" : "partial_r2_failure";
  purgeResult.completedAt = new Date().toISOString();
  await writeJson(path, purgeResult);
  await writeJson(join(context.outputDir, "r2-orphan-plan.json"), {
    manifestId: context.manifest.manifestId,
    items: deleted.orphanPlan
  });
  await writeSafeLog(join(context.outputDir, "purge.log"), [
    `manifest_id=${context.manifest.manifestId}`,
    "d1_apply_requests=1",
    `d1_total_changes=${purgeResult.d1TotalChanges}`,
    `r2_deleted=${deleted.deleted.length}`,
    `r2_failures=${deleted.failures.length}`,
    `status=${deleted.failures.length === 0 ? "TEST_DATA_PURGE_APPLY_COMPLETE" : "TEST_DATA_PURGE_PARTIAL_R2_ORPHANS"}`
  ]);
  if (deleted.failures.length > 0) {
    fail(PURGE_ERROR_CODES.partialR2, "r2-apply", { failureCount: deleted.failures.length });
  }
  return purgeResult;
}

async function fetchStatus(url, init) {
  const response = await fetch(url, init);
  return { response, text: await response.text() };
}

async function runVerify(context) {
  const purge = await readJson(join(context.outputDir, "purge-result.json"), PURGE_ERROR_CODES.verifyFailed);
  const dryRun = await readJson(join(context.outputDir, "dry-run-result.json"), PURGE_ERROR_CODES.verifyFailed);
  if (purge.status !== "complete") fail(PURGE_ERROR_CODES.verifyFailed, "verify", { reason: "purge_incomplete" });
  const post = await collectSnapshot(context);
  const targetCounts = assertD1PostDeleteState(context, post, dryRun);
  const objects = await listR2Objects(context);
  const target = targetR2Objects(context.manifest, objects);
  const outside = objects.map((object) => object.key).filter((key) => !context.manifest.r2ExactObjectKeys.includes(key));
  if (target.length !== 0 || outside.length !== dryRun.r2OutsideCount
    || keySetDigest(outside) !== dryRun.r2OutsideKeySetDigest) {
    fail(PURGE_ERROR_CODES.verifyFailed, "r2-verify", { reason: "object_set" });
  }

  const publicPaths = [
    "/api/health",
    "/api/charts",
    "/api/versions",
    "/difficulty-tables/rc-star",
    "/difficulty-tables/rc-double-star"
  ];
  const publicStatuses = {};
  const publicBodies = {};
  for (const path of publicPaths) {
    const result = await fetchStatus(`${context.baseUrl}${path}`);
    publicStatuses[path] = result.response.status;
    publicBodies[path] = result.text;
    if (result.response.status !== 200) fail(PURGE_ERROR_CODES.verifyFailed, "public-api", { path });
  }
  for (const chartId of context.manifest.chartIds) {
    const result = await fetchStatus(`${context.baseUrl}/api/charts/${encodeURIComponent(chartId)}`);
    if (result.response.status !== 404) fail(PURGE_ERROR_CODES.verifyFailed, "public-api", { reason: "chart_detail" });
  }
  const publicCombined = `${publicBodies["/api/charts"]}\n${publicBodies["/api/versions"]}`;
  if ([...context.manifest.chartIds, ...context.manifest.versionIds].some((id) => publicCombined.includes(id))) {
    fail(PURGE_ERROR_CODES.verifyFailed, "public-api", { reason: "target_visible" });
  }
  let listPayload;
  try {
    listPayload = JSON.parse(publicBodies["/api/charts"]);
  } catch {
    fail(PURGE_ERROR_CODES.verifyFailed, "public-api", { reason: "list_json" });
  }
  const candidateIds = new Set(context.manifest.candidateChartIds);
  const normalChartId = listPayload?.charts
    ?.map((entry) => entry?.chart?.id)
    .find((id) => typeof id === "string" && !candidateIds.has(id));
  if (!normalChartId) fail(PURGE_ERROR_CODES.verifyFailed, "public-api", { reason: "normal_probe_missing" });
  const normalProbe = await fetchStatus(`${context.baseUrl}/api/charts/${encodeURIComponent(normalChartId)}`);
  if (normalProbe.response.status !== 200) fail(PURGE_ERROR_CODES.verifyFailed, "public-api", { reason: "normal_probe" });

  const adminNoToken = await fetchStatus(`${context.baseUrl}/api/admin/delete-requests?status=pending&page=1&pageSize=1`);
  const adminDummy = await fetchStatus(`${context.baseUrl}/api/admin/delete-requests?status=pending&page=1&pageSize=1`, {
    headers: { Authorization: "Bearer invalid-test-token" }
  });
  if (adminNoToken.response.status !== 401 || adminDummy.response.status !== 401) {
    fail(PURGE_ERROR_CODES.verifyFailed, "admin-api", { reason: "unauthorized" });
  }
  let adminStatus = null;
  if (context.adminTokenFile) {
    const token = (await readFile(context.adminTokenFile, "utf8")).trim();
    if (!token) fail(PURGE_ERROR_CODES.verifyFailed, "admin-api", { reason: "token_empty" });
    const headers = { Authorization: `Bearer ${token}` };
    const adminPaths = [
      "/api/admin/delete-requests?status=pending&page=1&pageSize=100",
      "/api/admin/version-withdrawals?handlingMode=manual_review&page=1&pageSize=100",
      "/api/admin/r2-cleanup-candidates?olderThanDays=30&page=1&pageSize=100"
    ];
    for (const path of adminPaths) {
      const result = await fetchStatus(`${context.baseUrl}${path}`, { headers });
      adminStatus = result.response.status;
      if (result.response.status !== 200
        || [...context.manifest.chartIds, ...context.manifest.versionIds].some((id) => result.text.includes(id))) {
        fail(PURGE_ERROR_CODES.verifyFailed, "admin-api", { path });
      }
    }
  }
  const result = {
    status: "complete",
    manifestId: context.manifest.manifestId,
    createdAt: new Date().toISOString(),
    d1TargetCounts: targetCounts,
    d1CountsAfter: post.baselineCounts,
    foreignKeyViolationCount: post.foreignKeyViolationCount,
    keepChartCount: post.keepChartCount,
    keepVersionCount: post.keepVersionCount,
    r2TargetRemainingCount: target.length,
    r2OutsideObjectCount: outside.length,
    publicStatuses,
    targetChartDetailStatus: 404,
    normalControlChartStatus: normalProbe.response.status,
    adminNoTokenStatus: adminNoToken.response.status,
    adminDummyStatus: adminDummy.response.status,
    adminTokenStatus: adminStatus,
    secretOperationCount: 0,
    workerDeployCount: 0,
    fixedStatusCode: "TEST_DATA_PURGE_VERIFY_COMPLETE"
  };
  await writeJson(join(context.outputDir, "verify-result.json"), result);
  await writeSafeLog(join(context.outputDir, "verify.log"), [
    `manifest_id=${context.manifest.manifestId}`,
    "d1_target_rows=0",
    "foreign_key_violations=0",
    "r2_target_remaining=0",
    "public_api=200",
    "target_chart_detail=404",
    `admin_token_status=${adminStatus ?? "not_checked"}`,
    "status=TEST_DATA_PURGE_VERIFY_COMPLETE"
  ]);
  return result;
}

async function runInventory(context) {
  const state = await collectDryRunState(context);
  return {
    manifestId: context.manifest.manifestId,
    targetRows: context.manifest.expectedRowCountsByTable,
    targetObjects: state.targetObjects.length,
    productionWriteCount: 0
  };
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const context = await loadContext(options);
  context.optionsConfig = options.config;
  context.configFile = options.config;
  if (options.mode === "validate-manifest") return { manifestId: context.manifest.manifestId, status: "valid" };
  if (options.mode === "inventory") return runInventory(context);
  if (options.mode === "backup") {
    const result = await runBackup(context);
    return {
      status: result.status,
      manifestId: result.manifestId,
      d1FullExportPath: result.d1FullExportPath,
      r2BackupPath: result.r2BackupPath,
      d1TargetRowCounts: result.d1TargetRowCounts,
      r2ObjectCount: result.r2ObjectCount,
      r2Bytes: result.r2Bytes,
      aclOk: result.aclOk,
      productionWriteCount: result.productionWriteCount
    };
  }
  if (options.mode === "dry-run") {
    const { result } = await runDryRun(context);
    return {
      status: result.status,
      manifestId: result.manifestId,
      targetRowCounts: result.targetRowCounts,
      statementCount: result.statementCount,
      r2TargetCount: result.r2TargetCount,
      backupVerified: result.backupVerified,
      productionWriteCount: result.productionWriteCount,
      fixedStatusCode: result.fixedStatusCode
    };
  }
  if (options.mode === "apply-d1") return runApplyD1(context);
  if (options.mode === "apply-r2") return runApplyR2(context);
  if (options.mode === "verify") return runVerify(context);
  if (options.mode === "restore-plan") {
    const backup = await requireBackup(context);
    const text = buildRestorePlanText({
      manifestId: context.manifest.manifestId,
      d1BackupPath: backup.d1FullExportPath,
      r2BackupPath: backup.r2BackupPath
    });
    await writeFile(join(context.outputDir, "restore-plan.txt"), text, "utf8");
    return { manifestId: context.manifest.manifestId, status: "restore_plan_ready" };
  }
  fail(PURGE_ERROR_CODES.manifestInvalid, "arguments", { reason: "mode" });
}

run().then((result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}).catch((error) => {
  const record = safeErrorRecord(error, "TEST_DATA_PURGE_OPERATOR_FAILED");
  process.stderr.write(`[test-data-purge] stage=${record.stage} code=${record.code}\n`);
  process.exitCode = 1;
});
