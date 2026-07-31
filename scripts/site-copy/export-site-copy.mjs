import fs from "node:fs";
import path from "node:path";
import {
  assertExportRepository,
  buildExport,
  groupCounts,
  loadManifest,
  safeDiagnostic,
  SiteCopyError,
  TXT_FILENAME
} from "./site-copy-core.mjs";

function parseArgs(argv) {
  const rootDir = path.resolve(import.meta.dirname, "../..");
  const options = {
    rootDir,
    manifestPath: null,
    outputDir: "C:\\Users\\longa\\Documents\\Tools\\bms-wip-charts-copy"
  };
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
  const catalogDir = path.join(options.outputDir, manifest.catalogId);
  fs.mkdirSync(catalogDir, { recursive: true });
  const txtPath = path.join(options.outputDir, TXT_FILENAME);
  const snapshotPath = path.join(catalogDir, "site-copy-manifest.snapshot.json");
  const logPath = path.join(catalogDir, "site-copy-export.log");
  const resultPath = path.join(catalogDir, "site-copy-export-result.json");
  fs.writeFileSync(txtPath, result.txt, "utf8");
  fs.writeFileSync(snapshotPath, result.snapshotText, "utf8");
  const diagnostic = safeDiagnostic({
    mode: "export",
    timestamp: result.snapshot.exportedAt,
    head: repo.head,
    manifestSha256: result.manifestSha256,
    catalogId: manifest.catalogId,
    entryCount: result.snapshot.entries.length,
    pagesCount: result.snapshot.entries.filter((entry) => entry.deploymentTarget === "PAGES").length,
    workerCount: result.snapshot.entries.filter((entry) => entry.deploymentTarget === "WORKER").length,
    manualReviewCount: manifest.manualReview?.length ?? 0,
    paths: [txtPath, snapshotPath],
    code: "SITE_COPY_EXPORT_COMPLETE",
    status: "passed"
  });
  fs.writeFileSync(logPath, `${Object.entries(diagnostic).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`, "utf8");
  fs.writeFileSync(resultPath, `${JSON.stringify({ ...diagnostic, groupCounts: groupCounts(result.snapshot.entries) }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...diagnostic, txtPath, snapshotPath, logPath, resultPath, groupCounts: groupCounts(result.snapshot.entries) }, null, 2)}\n`);
} catch (error) {
  const known = error instanceof SiteCopyError;
  const code = known ? error.code : "SITE_COPY_EXPORT_UNSUPPORTED_TEXT";
  process.stderr.write(`${JSON.stringify({ code, message: known ? error.message : "export処理に失敗しました。", detail: known ? error.detail : { errorType: error?.constructor?.name ?? "Error" } })}\n`);
  process.exitCode = 1;
}
