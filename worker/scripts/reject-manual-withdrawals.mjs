import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
const DEFAULT_TOKEN_FILE = "C:\\Users\\longa\\Documents\\Tools\\bms-history-rewrite\\private\\admin-token.txt";
const REASON_CODE = "security_hash_cutover";

function parseArguments(argv) {
  const options = {
    execute: false,
    expectedCount: null,
    baseUrl: DEFAULT_BASE_URL,
    tokenFile: DEFAULT_TOKEN_FILE
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") {
      options.execute = true;
    } else if (value === "--expected-count") {
      options.expectedCount = Number.parseInt(argv[++index] ?? "", 10);
    } else if (value === "--base-url") {
      options.baseUrl = argv[++index] ?? "";
    } else if (value === "--token-file") {
      options.tokenFile = argv[++index] ?? "";
    } else {
      throw new Error("UNKNOWN_ARGUMENT");
    }
  }
  if (!/^https?:\/\//i.test(options.baseUrl)) throw new Error("INVALID_BASE_URL");
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!options.tokenFile) throw new Error("TOKEN_FILE_REQUIRED");
  if (options.execute
    && (!Number.isInteger(options.expectedCount) || options.expectedCount < 1)) {
    throw new Error("EXPECTED_COUNT_REQUIRED");
  }
  return options;
}

async function requestJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error(`INVALID_JSON_RESPONSE:${response.status}`);
  }
  if (!response.ok) {
    const code = typeof body?.code === "string" && /^[A-Z0-9_]+$/.test(body.code)
      ? body.code
      : "HTTP_REQUEST_FAILED";
    throw new Error(`${code}:${response.status}`);
  }
  return body;
}

export async function runManualWithdrawalRecovery({
  argv = process.argv.slice(2),
  fetchImpl = fetch,
  readFileImpl = readFile,
  writeLine = (line) => process.stdout.write(`${line}\n`)
} = {}) {
  const options = parseArguments(argv);
  const token = (await readFileImpl(options.tokenFile, "utf8")).trim();
  if (!token) throw new Error("ADMIN_TOKEN_EMPTY");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const listUrl = `${options.baseUrl}/api/admin/version-withdrawals?handlingMode=manual_review&pageSize=100`;
  const before = await requestJson(fetchImpl, listUrl, { method: "GET", headers });
  const items = Array.isArray(before?.items) ? before.items : [];
  const candidates = items.filter((item) => item?.status === "pending"
    && item?.handlingMode === "manual_review"
    && typeof item?.withdrawalId === "string"
    && item.withdrawalId.length > 0);
  const total = Number(before?.total ?? -1);
  if (total !== candidates.length || candidates.length !== items.length) {
    throw new Error("CANDIDATE_LIST_MISMATCH");
  }

  if (!options.execute) {
    writeLine(`WITHDRAWAL_RECOVERY_DRY_RUN candidate_count=${candidates.length}`);
    return { mode: "dry-run", candidateCount: candidates.length, rejectedCount: 0 };
  }
  if (candidates.length !== options.expectedCount) {
    throw new Error(`EXPECTED_COUNT_MISMATCH:${candidates.length}`);
  }

  let rejectedCount = 0;
  let idempotentCount = 0;
  for (const item of candidates) {
    const result = await requestJson(
      fetchImpl,
      `${options.baseUrl}/api/admin/version-withdrawals/${encodeURIComponent(item.withdrawalId)}/reject`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ reasonCode: REASON_CODE })
      }
    );
    if (result?.outcome === "rejected") rejectedCount += 1;
    else if (result?.outcome === "already_rejected") idempotentCount += 1;
    else throw new Error("UNEXPECTED_REJECTION_OUTCOME");
  }

  const after = await requestJson(fetchImpl, listUrl, { method: "GET", headers });
  const remainingCount = Number(after?.total ?? -1);
  if (remainingCount !== 0) throw new Error(`ACTIVE_WITHDRAWALS_REMAIN:${remainingCount}`);
  writeLine(
    `WITHDRAWAL_RECOVERY_COMPLETE selected_count=${candidates.length} rejected_count=${rejectedCount} idempotent_count=${idempotentCount} remaining_count=0`
  );
  return {
    mode: "execute",
    candidateCount: candidates.length,
    rejectedCount,
    idempotentCount,
    remainingCount
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runManualWithdrawalRecovery().catch((error) => {
    const code = error instanceof Error
      ? String(error.message).split(":", 1)[0]
      : "WITHDRAWAL_RECOVERY_FAILED";
    process.stderr.write(`WITHDRAWAL_RECOVERY_FAILED code=${code}\n`);
    process.exitCode = 1;
  });
}
