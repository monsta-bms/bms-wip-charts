import path from "node:path";
import { execFileSync } from "node:child_process";
import { applyEditedCopies, SiteCopyError } from "./site-copy-core.mjs";
import { runValidation, validationOptions } from "./validate-site-copy.mjs";

try {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  let manifestPath = null;
  const validationArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--apply") continue;
    if (argv[index] === "--manifest") { manifestPath = path.resolve(argv[++index]); continue; }
    validationArgs.push(argv[index]);
  }
  const options = validationOptions(validationArgs);
  manifestPath ??= path.join(options.rootDir, "site-copy", "site-copy-manifest.json");
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: options.rootDir, encoding: "utf8", windowsHide: true }).trim();
  if (status !== "") throw new SiteCopyError("SITE_COPY_GUIDE_APPLY_FAILED", "worktreeがcleanではありません。", {});
  const validation = runValidation(options);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ code: validation.code, mode: "dry-run", uiChangeCount: validation.uiChangeCount, guideChangeCount: validation.guideChangeCount, changedFiles: validation.changedFiles }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(applyEditedCopies(options.rootDir, manifestPath, validation), null, 2)}\n`);
  }
} catch (error) {
  const known = error instanceof SiteCopyError;
  process.stderr.write(`${JSON.stringify({ code: known ? error.code : "SITE_COPY_GUIDE_APPLY_FAILED", message: known ? error.message : "反映処理に失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
  process.exitCode = 1;
}
