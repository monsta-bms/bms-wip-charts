import { runValidation, validationOptions } from "./validate-site-copy.mjs";
import { SiteCopyError } from "./site-copy-core.mjs";

try {
  const result = runValidation(validationOptions(process.argv.slice(2)));
  const summary = {
    code: result.code,
    mode: "dry-run",
    changeCount: result.changeCount,
    pagesChangeCount: result.pagesChangeCount,
    workerChangeCount: result.workerChangeCount,
    changedFileCount: result.changedFiles.length,
    changedFiles: result.changedFiles,
    changes: result.changes.map((change) => ({
      id: change.entry.id,
      displayLocation: change.entry.displayLocation,
      deploymentTarget: change.entry.deploymentTarget,
      beforeLength: change.beforeLength,
      afterLength: change.afterLength,
      protectedTokens: "passed",
      before: change.before,
      after: change.after
    })),
    pagesRequirePush: result.pagesChangeCount > 0,
    workerRequiresSafeDeploy: result.workerChangeCount > 0
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  const known = error instanceof SiteCopyError;
  const code = known ? error.code : "SITE_COPY_APPLY_VALIDATION_FAILED";
  process.stderr.write(`${JSON.stringify({ code, message: known ? error.message : "dry-runに失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
  process.exitCode = 1;
}
