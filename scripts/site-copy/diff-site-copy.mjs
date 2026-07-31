import { paragraphDiff, SiteCopyError } from "./site-copy-core.mjs";
import { runValidation, validationOptions } from "./validate-site-copy.mjs";

try {
  const result = runValidation(validationOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    code: result.code,
    mode: "dry-run",
    uiChangeCount: result.uiChangeCount,
    guideChangeCount: result.guideChangeCount,
    changedFiles: result.changedFiles,
    uiBlocks: result.uiChanges.map((change) => ({
      id: change.block.id,
      fields: change.fields.map((field) => ({ label: field.field.label, beforeLength: [...field.before].length, afterLength: [...field.after].length }))
    })),
    guideSections: result.guideChanges.map((change) => ({ id: change.section.id, paragraphs: paragraphDiff(change.before, change.after) }))
  }, null, 2)}\n`);
} catch (error) {
  const known = error instanceof SiteCopyError;
  process.stderr.write(`${JSON.stringify({ code: known ? error.code : "SITE_COPY_GUIDE_PARSE_FAILED", message: known ? error.message : "dry-runに失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
  process.exitCode = 1;
}
