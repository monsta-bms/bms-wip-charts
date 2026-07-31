import fs from "node:fs";
import path from "node:path";
import {
  assertExportRepository,
  buildExport,
  exportSummary,
  GUIDE_FILENAME,
  loadManifest,
  SiteCopyError,
  UI_FILENAME
} from "./site-copy-core.mjs";

function parseArgs(argv) {
  const rootDir = path.resolve(import.meta.dirname, "../..");
  const options = { rootDir, manifestPath: null, outputDir: "C:\\Users\\longa\\Documents\\Tools\\bms-wip-charts-copy" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.rootDir = path.resolve(argv[++index]);
    else if (argv[index] === "--manifest") options.manifestPath = path.resolve(argv[++index]);
    else if (argv[index] === "--output-dir") options.outputDir = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.manifestPath ??= path.join(options.rootDir, "site-copy", "site-copy-manifest.json");
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const repo = assertExportRepository(options.rootDir);
  const manifest = loadManifest(options.manifestPath);
  const result = buildExport(options.rootDir, manifest);
  const summary = exportSummary(manifest, result);
  const catalogDir = path.join(options.outputDir, manifest.catalogId);
  fs.mkdirSync(catalogDir, { recursive: true });
  const uiPath = path.join(options.outputDir, UI_FILENAME);
  const guidePath = path.join(options.outputDir, GUIDE_FILENAME);
  const snapshotPath = path.join(catalogDir, "site-copy-manifest.snapshot.json");
  const logPath = path.join(catalogDir, "site-copy-export.log");
  const resultPath = path.join(catalogDir, "site-copy-export-result.json");
  fs.writeFileSync(uiPath, result.uiTxt, "utf8");
  fs.writeFileSync(guidePath, result.guideTxt, "utf8");
  fs.writeFileSync(snapshotPath, result.snapshotText, "utf8");
  const diagnostic = {
    mode: "export",
    timestamp: result.snapshot.exportedAt,
    head: repo.head,
    snapshotSha256: result.snapshotSha256,
    ...summary,
    paths: [uiPath, guidePath, snapshotPath],
    code: "SITE_COPY_EXPORT_COMPLETE",
    status: "passed"
  };
  fs.writeFileSync(logPath, `${Object.entries(diagnostic).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`, "utf8");
  fs.writeFileSync(resultPath, `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...diagnostic, uiPath, guidePath, snapshotPath, logPath, resultPath }, null, 2)}\n`);
} catch (error) {
  const known = error instanceof SiteCopyError;
  process.stderr.write(`${JSON.stringify({ code: known ? error.code : "SITE_COPY_EXPORT_REPO_INVALID", message: known ? error.message : "export処理に失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
  process.exitCode = 1;
}
