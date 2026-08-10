import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workerRoot, "..");

function readArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("MINIVIEW_REPAIR_ARGUMENT_INVALID");
    }
    result[name.slice(2)] = value;
  }
  return result;
}

function assertOutsideRepository(outputDirectory) {
  const relativePath = relative(repositoryRoot, outputDirectory);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
    throw new Error("MINIVIEW_REPAIR_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY");
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function importAnalyzer() {
  const result = await build({
    entryPoints: ["src/utils/bmsUploadAnalysis.ts"],
    absWorkingDir: workerRoot,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    logLevel: "silent"
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const args = readArguments(process.argv.slice(2));
const sourceFile = resolve(args["source-file"] || "");
const sourceName = String(args["source-name"] || "").trim();
const expectedSha256 = String(args["expected-sha256"] || "").toLowerCase();
const versionId = String(args["version-id"] || "").trim();
const outputDirectory = resolve(args["output-dir"] || "");

if (!sourceName || !/^[a-f0-9]{64}$/u.test(expectedSha256) || !/^version_[A-Za-z0-9-]+$/u.test(versionId)) {
  throw new Error("MINIVIEW_REPAIR_ARGUMENT_INVALID");
}
assertOutsideRepository(outputDirectory);

const bytes = await readFile(sourceFile);
const actualSha256 = createHash("sha256").update(bytes).digest("hex");
if (actualSha256 !== expectedSha256) {
  throw new Error("MINIVIEW_REPAIR_SOURCE_HASH_MISMATCH");
}

const { analyzeUploadedBmsBytes } = await importAnalyzer();
const sourceBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const analysisResult = analyzeUploadedBmsBytes(sourceBuffer, sourceName);
const miniView = analysisResult?.analysis?.measureNotesJson?.miniView;
if (analysisResult?.analysisFailed || miniView?.status !== "ready" || miniView?.payload?.mineCount <= 0) {
  throw new Error("MINIVIEW_REPAIR_CANDIDATE_INVALID");
}

const miniViewJson = JSON.stringify(miniView);
const guard = [
  `id = ${sqlString(versionId)}`,
  "json_extract(measure_notes_json, '$.schemaVersion') = 3",
  "json_extract(measure_notes_json, '$.miniView.status') = 'unsupported'",
  "json_extract(measure_notes_json, '$.miniView.reasonCode') = 'MINIVIEW_UNSUPPORTED_MODE'"
].join("\n  AND ");
const applySql = `UPDATE versions\nSET measure_notes_json = json_set(measure_notes_json, '$.miniView', json(${sqlString(miniViewJson)}))\nWHERE ${guard};\nSELECT changes() AS changed_rows;\n`;
const originalMiniView = JSON.stringify({
  schemaVersion: 3,
  status: "unsupported",
  mode: null,
  reasonCode: "MINIVIEW_UNSUPPORTED_MODE"
});
const rollbackSql = `UPDATE versions\nSET measure_notes_json = json_set(measure_notes_json, '$.miniView', json(${sqlString(originalMiniView)}))\nWHERE id = ${sqlString(versionId)}\n  AND json_extract(measure_notes_json, '$.schemaVersion') = 3\n  AND json_extract(measure_notes_json, '$.miniView.status') = 'ready'\n  AND json_extract(measure_notes_json, '$.miniView.payload.mineCount') = ${Number(miniView.payload.mineCount)};\nSELECT changes() AS changed_rows;\n`;

await mkdir(outputDirectory, { recursive: true });
const applyPath = resolve(outputDirectory, "apply.sql");
const rollbackPath = resolve(outputDirectory, "rollback.sql");
const resultPath = resolve(outputDirectory, "build-result.json");
await writeFile(applyPath, applySql, { encoding: "utf8", flag: "wx" });
await writeFile(rollbackPath, rollbackSql, { encoding: "utf8", flag: "wx" });
await writeFile(resultPath, `${JSON.stringify({
  code: "MINIVIEW_REPAIR_CANDIDATE_READY",
  versionId,
  sourceHashVerified: true,
  miniViewStatus: miniView.status,
  mineCount: miniView.payload.mineCount,
  payloadBytes: new TextEncoder().encode(miniViewJson).byteLength,
  applyPath,
  rollbackPath
}, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

console.log(JSON.stringify({
  code: "MINIVIEW_REPAIR_CANDIDATE_READY",
  versionId,
  mineCount: miniView.payload.mineCount,
  payloadBytes: new TextEncoder().encode(miniViewJson).byteLength,
  outputDirectory
}));
