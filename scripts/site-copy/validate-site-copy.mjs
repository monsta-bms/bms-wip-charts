import path from "node:path";
import { GUIDE_FILENAME, readUtf8, SiteCopyError, UI_FILENAME, validateEditedCopies } from "./site-copy-core.mjs";

export function validationOptions(argv) {
  const rootDir = path.resolve(import.meta.dirname, "../..");
  const outputDir = "C:\\Users\\longa\\Documents\\Tools\\bms-wip-charts-copy";
  const options = { rootDir, uiPath: path.join(outputDir, UI_FILENAME), guidePath: path.join(outputDir, GUIDE_FILENAME), snapshotPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.rootDir = path.resolve(argv[++index]);
    else if (argv[index] === "--ui") options.uiPath = path.resolve(argv[++index]);
    else if (argv[index] === "--guide") options.guidePath = path.resolve(argv[++index]);
    else if (argv[index] === "--snapshot") options.snapshotPath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.snapshotPath) {
    const catalogId = readUtf8(options.guidePath).match(/^CATALOG_ID: (.+)$/mu)?.[1];
    if (!catalogId) throw new SiteCopyError("SITE_COPY_GUIDE_INVALID_HEADER", "CATALOG_IDがありません。", {});
    options.snapshotPath = path.join(path.dirname(options.guidePath), catalogId, "site-copy-manifest.snapshot.json");
  }
  return options;
}

export function runValidation(options) {
  const snapshot = JSON.parse(readUtf8(options.snapshotPath));
  return validateEditedCopies(readUtf8(options.uiPath), readUtf8(options.guidePath), snapshot, { rootDir: options.rootDir });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const result = runValidation(validationOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({
      code: result.code,
      uiBlockCount: result.uiBlockCount,
      guideSectionCount: result.guideSectionCount,
      uiChangeCount: result.uiChangeCount,
      uiFieldChangeCount: result.uiFieldChangeCount,
      guideChangeCount: result.guideChangeCount,
      changedFiles: result.changedFiles,
      uiBlocks: result.uiChanges.map((change) => change.block.id),
      guideSections: result.guideChanges.map((change) => change.section.id)
    }, null, 2)}\n`);
  } catch (error) {
    const known = error instanceof SiteCopyError;
    process.stderr.write(`${JSON.stringify({ code: known ? error.code : "SITE_COPY_GUIDE_PARSE_FAILED", message: known ? error.message : "TXT検査に失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
    process.exitCode = 1;
  }
}
