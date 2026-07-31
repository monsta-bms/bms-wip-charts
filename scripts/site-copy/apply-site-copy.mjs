import path from "node:path";
import { execFileSync } from "node:child_process";
import { applyChanges, planApply, SiteCopyError } from "./site-copy-core.mjs";
import { runValidation, validationOptions } from "./validate-site-copy.mjs";

try {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  let manifestPath = null;
  const validationArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--apply") continue;
    if (argv[index] === "--manifest") {
      manifestPath = path.resolve(argv[++index]);
      continue;
    }
    validationArgs.push(argv[index]);
  }
  const options = validationOptions(validationArgs);
  manifestPath ??= path.join(options.rootDir, "site-copy", "site-copy-manifest.json");
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: options.rootDir, encoding: "utf8", windowsHide: true }).trim();
  if (status !== "") throw new SiteCopyError("SITE_COPY_APPLY_VALIDATION_FAILED", "worktreeがcleanではありません。", {});
  const validation = runValidation(options);
  const plan = planApply(options.rootDir, validation);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      code: "SITE_COPY_TXT_VALIDATION_COMPLETE",
      mode: "dry-run",
      changeCount: validation.changeCount,
      changedFiles: [...plan.plannedByFile.keys()],
      ids: validation.changes.map((change) => change.entry.id)
    }, null, 2)}\n`);
  } else {
    const result = applyChanges(options.rootDir, validation, { manifestPath });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  const known = error instanceof SiteCopyError;
  const code = known ? error.code : "SITE_COPY_APPLY_VALIDATION_FAILED";
  process.stderr.write(`${JSON.stringify({ code, message: known ? error.message : "反映処理に失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
  process.exitCode = 1;
}
