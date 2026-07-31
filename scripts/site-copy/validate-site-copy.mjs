import fs from "node:fs";
import path from "node:path";
import { canonicalJson, readUtf8, sha256, SiteCopyError, TXT_FILENAME, validateEditedTxt } from "./site-copy-core.mjs";

export function validationOptions(argv) {
  const rootDir = path.resolve(import.meta.dirname, "../..");
  const outputDir = "C:\\Users\\longa\\Documents\\Tools\\bms-wip-charts-copy";
  const options = { rootDir, txtPath: path.join(outputDir, TXT_FILENAME), snapshotPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.rootDir = path.resolve(argv[++index]);
    else if (argv[index] === "--txt") options.txtPath = path.resolve(argv[++index]);
    else if (argv[index] === "--snapshot") options.snapshotPath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.snapshotPath) {
    const text = readUtf8(options.txtPath);
    const catalogId = text.match(/^CATALOG_ID: (.+)$/mu)?.[1];
    if (!catalogId) throw new SiteCopyError("SITE_COPY_TXT_INVALID_HEADER", "CATALOG_IDがありません。", {});
    options.snapshotPath = path.join(path.dirname(options.txtPath), catalogId, "site-copy-manifest.snapshot.json");
  }
  return options;
}

export function runValidation(options) {
  const snapshotText = readUtf8(options.snapshotPath);
  const snapshot = JSON.parse(snapshotText);
  const txt = readUtf8(options.txtPath);
  return validateEditedTxt(txt, snapshot, sha256(canonicalJson(snapshot)), { rootDir: options.rootDir });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const result = runValidation(validationOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({
      code: result.code,
      entryCount: result.entryCount,
      changeCount: result.changeCount,
      pagesChangeCount: result.pagesChangeCount,
      workerChangeCount: result.workerChangeCount,
      changedFiles: result.changedFiles,
      ids: result.changes.map((change) => change.entry.id)
    }, null, 2)}\n`);
  } catch (error) {
    const known = error instanceof SiteCopyError;
    const code = known ? error.code : "SITE_COPY_APPLY_VALIDATION_FAILED";
    process.stderr.write(`${JSON.stringify({ code, message: known ? error.message : "TXT検査に失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
    process.exitCode = 1;
  }
}
