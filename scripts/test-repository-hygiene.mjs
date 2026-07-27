import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const errorCodes = Object.freeze({
  gitUnavailable: "REPO_HYGIENE_GIT_UNAVAILABLE",
  wranglerTracked: "REPO_HYGIENE_WRANGLER_TRACKED",
  nodeModulesTracked: "REPO_HYGIENE_NODE_MODULES_TRACKED",
  localDatabaseTracked: "REPO_HYGIENE_LOCAL_DB_TRACKED",
  environmentTracked: "REPO_HYGIENE_ENV_TRACKED",
  deployLogTracked: "REPO_HYGIENE_DEPLOY_LOG_TRACKED",
  rootConfigTracked: "REPO_HYGIENE_ROOT_CONFIG_TRACKED",
  malformedPathTracked: "REPO_HYGIENE_MALFORMED_PATH_TRACKED",
  ignoreRuleMissing: "REPO_HYGIENE_IGNORE_RULE_MISSING"
});

class RepositoryHygieneError extends Error {
  constructor(code, path, count, ignoreRulePresent = null) {
    super(code);
    this.name = "RepositoryHygieneError";
    this.code = code;
    this.path = path;
    this.count = count;
    this.ignoreRulePresent = ignoreRulePresent;
  }
}

function runGit(args, { acceptedStatuses = [0] } = {}) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  if (result.error || !acceptedStatuses.includes(result.status)) {
    throw new RepositoryHygieneError(errorCodes.gitUnavailable, "-", 0, null);
  }
  return result;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function assertNoTrackedFiles(code, paths) {
  if (paths.length > 0) {
    throw new RepositoryHygieneError(code, paths[0], paths.length, null);
  }
}

function isIgnored(path) {
  const result = runGit(
    ["check-ignore", "-q", "--no-index", "--", path],
    { acceptedStatuses: [0, 1] }
  );
  return result.status === 0;
}

function assertIgnoreRule(path, expectedIgnored) {
  const ignored = isIgnored(path);
  if (ignored !== expectedIgnored) {
    throw new RepositoryHygieneError(
      errorCodes.ignoreRuleMissing,
      path,
      1,
      ignored
    );
  }
}

function isExamplePath(path) {
  return /(?:example|sample|template)/i.test(path.split("/").at(-1) ?? "");
}

function formatFailure(error) {
  const known = error instanceof RepositoryHygieneError;
  const code = known ? error.code : errorCodes.gitUnavailable;
  const path = known ? error.path : "-";
  const count = known ? error.count : 0;
  const ignoreRule = known && error.ignoreRulePresent !== null
    ? String(error.ignoreRulePresent)
    : "not_applicable";
  return "[repository-hygiene] code=" + code
    + " path=" + path
    + " count=" + count
    + " ignore_rule_present=" + ignoreRule;
}

function main() {
  const repositoryCheck = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (repositoryCheck.stdout.trim() !== "true") {
    throw new RepositoryHygieneError(errorCodes.gitUnavailable, "-", 0, null);
  }

  const trackedFiles = runGit(["ls-files", "-z"])
    .stdout
    .split("\0")
    .filter(Boolean)
    .map(normalizePath);

  const checks = [
    () => assertNoTrackedFiles(
      errorCodes.wranglerTracked,
      trackedFiles.filter((path) => /(^|\/)\.wrangler(?:\/|$)/i.test(path))
    ),
    () => assertNoTrackedFiles(
      errorCodes.nodeModulesTracked,
      trackedFiles.filter((path) => /(^|\/)node_modules(?:\/|$)/i.test(path))
    ),
    () => assertNoTrackedFiles(
      errorCodes.localDatabaseTracked,
      trackedFiles.filter((path) => /\.(?:sqlite|sqlite3|db|db-wal|db-shm)$/i.test(path))
    ),
    () => assertNoTrackedFiles(
      errorCodes.environmentTracked,
      trackedFiles.filter((path) => {
        const name = path.split("/").at(-1) ?? "";
        return /^\.dev\.vars(?:\..*)?$/i.test(name) && !isExamplePath(path);
      })
    ),
    () => assertNoTrackedFiles(
      errorCodes.environmentTracked,
      trackedFiles.filter((path) => {
        const name = path.split("/").at(-1) ?? "";
        return /^\.env(?:\..*)?$/i.test(name) && !isExamplePath(path);
      })
    ),
    () => assertNoTrackedFiles(
      errorCodes.deployLogTracked,
      trackedFiles.filter((path) => /(^|\/)\.deploy-logs(?:\/|$)/i.test(path))
    ),
    () => assertNoTrackedFiles(
      errorCodes.rootConfigTracked,
      trackedFiles.filter((path) => path.toLowerCase() === "wrangler.jsonc")
    ),
    () => assertNoTrackedFiles(
      errorCodes.malformedPathTracked,
      trackedFiles.filter((path) => /(^|\/)\.gitignore\//i.test(path))
    ),
    () => assertNoTrackedFiles(
      errorCodes.malformedPathTracked,
      trackedFiles.filter((path) => /(^|\/)(?:woorker|workre|wroker)(?:\/|$)/i.test(path))
    ),
    () => assertIgnoreRule(".wrangler/repository-hygiene-probe", true),
    () => assertIgnoreRule("worker/.wrangler/repository-hygiene-probe", true),
    () => assertIgnoreRule("worker/node_modules/repository-hygiene-probe", true),
    () => assertIgnoreRule("worker/.deploy-logs/repository-hygiene-probe", true),
    () => assertIgnoreRule("worker/.dev.vars", true),
    () => assertIgnoreRule("worker/.env", true),
    () => assertIgnoreRule(".dev.vars.example", false),
    () => assertIgnoreRule(".env.example", false)
  ];

  for (const check of checks) {
    check();
  }
  console.log("repository hygiene tests: " + checks.length + " checks passed");
}

try {
  main();
} catch (error) {
  console.error(formatFailure(error));
  process.exitCode = 1;
}
