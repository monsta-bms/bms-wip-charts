import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workerRoot, "..");

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

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function readVarint(state) {
  let value = 0;
  let multiplier = 1;
  while (state.offset < state.bytes.length) {
    const byte = state.bytes[state.offset++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value;
    multiplier *= 128;
  }
  throw new Error("MINIVIEW_TEST_VARINT_UNTERMINATED");
}

function decodePackedEvents(payload) {
  const state = { bytes: Buffer.from(payload.eventData, "base64"), offset: 0 };
  const events = [];
  let measure = 0;
  for (let groupIndex = 0; groupIndex < payload.eventGroupCount; groupIndex += 1) {
    measure += readVarint(state);
    const descriptor = state.bytes[state.offset++];
    const lane = descriptor & 0x07;
    const kind = descriptor >> 3;
    const denominator = readVarint(state);
    const count = readVarint(state);
    let numerator = 0;
    for (let index = 0; index < count; index += 1) {
      numerator += readVarint(state);
      events.push({ measure, lane, kind, numerator, denominator });
    }
  }
  assert.equal(state.offset, state.bytes.length);
  return events;
}

const { analyzeUploadedBmsBytes } = await importAnalyzer();
const localAnalysisContext = {
  window: {},
  Blob,
  TextDecoder,
  TextEncoder,
  btoa: (value) => Buffer.from(value, "binary").toString("base64")
};
vm.runInNewContext(
  await readFile(resolve(repositoryRoot, "docs", "local-bms-analysis.js"), "utf8"),
  localAnalysisContext,
  { filename: "docs/local-bms-analysis.js" }
);
const localAnalyzer = localAnalysisContext.window.BmsLocalChartAnalysis;
const rendererContext = {
  window: {},
  document: { querySelector: () => null },
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  Uint8Array
};
const rendererSource = (await readFile(resolve(repositoryRoot, "docs", "chart-miniview.js"), "utf8")).replace(
  "  if (!listElement) {\n    return;\n  }",
  "  if (!listElement) {\n    window.__normalizeMiniViewPayloadForTest = normalizePayload;\n    return;\n  }"
);
vm.runInNewContext(rendererSource, rendererContext, { filename: "docs/chart-miniview.js" });
const normalizeRendererPayload = rendererContext.window.__normalizeMiniViewPayloadForTest;
let passed = 0;

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function analyzeText(text, name = "mine-fixture.bms") {
  return analyzeUploadedBmsBytes(asArrayBuffer(Buffer.from(text, "utf8")), name);
}

const sevenKeyMineFixture = [
  "#PLAYER 1",
  "#TITLE Mine fixture",
  "#ARTIST Test",
  "#BPM 120",
  "#00111:0100",
  "#00118:0001",
  "#001D1:0002",
  "#001D2:0003",
  "#001D3:0004",
  "#001D4:0005",
  "#001D5:0006",
  "#001D6:0007",
  "#001D8:0008",
  "#001D9:0009"
].join("\r\n");

await check("7key SP mine channels produce a ready miniview", () => {
  const result = analyzeText(sevenKeyMineFixture);
  assert.equal(result.analysisFailed, false);
  assert.ok(result.analysis);
  assert.equal(result.analysis.measureNotesJson.miniView.status, "ready");
  assert.equal(result.analysisWarnings.some((warning) => warning.code.startsWith("MINIVIEW_")), false);
});

await check("D1-D6,D8,D9 map to all eight miniview lanes", () => {
  const result = analyzeText(sevenKeyMineFixture);
  const payload = result.analysis.measureNotesJson.miniView.payload;
  assert.equal(payload.mineCount, 8);
  assert.equal(payload.tapCount, 2);
  const mines = decodePackedEvents(payload).filter((event) => event.kind === 3);
  assert.equal(mines.length, 8);
  assert.deepEqual([...new Set(mines.map((event) => event.lane))].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

await check("Pages and Worker mine parsers produce the same payload", () => {
  const workerResult = analyzeText(sevenKeyMineFixture);
  const localResult = localAnalyzer.analyzeMiniViewText(
    sevenKeyMineFixture,
    "mine-fixture.bms",
    { displayFirstMeasure: 1, displayLastMeasure: 1 }
  );
  assert.equal(localResult.miniView.status, "ready", JSON.stringify(localResult.warning));
  assert.deepEqual(
    JSON.parse(JSON.stringify(localResult.miniView.payload)),
    workerResult.analysis.measureNotesJson.miniView.payload
  );
  const normalized = normalizeRendererPayload(workerResult.analysis.measureNotesJson.miniView.payload);
  assert.equal(normalized.mineCount, 8);
  assert.equal(normalized.mineEvents.length, 8);
});

await check("a miniview without mines remains compatible with mineCount zero", () => {
  const result = analyzeText([
    "#PLAYER 1",
    "#BPM 120",
    "#00111:01",
    "#00118:01"
  ].join("\r\n"));
  assert.equal(result.analysis.measureNotesJson.miniView.status, "ready");
  assert.equal(result.analysis.measureNotesJson.miniView.payload.mineCount, 0);
});

await check("second-player mine channels remain unsupported", () => {
  const result = analyzeText(`${sevenKeyMineFixture}\r\n#002E1:01`);
  assert.equal(result.analysis.measureNotesJson.miniView.status, "unsupported");
  assert.equal(result.analysis.measureNotesJson.miniView.reasonCode, "MINIVIEW_UNSUPPORTED_MODE");
});

await check("special D7 mine channel remains unsupported", () => {
  const result = analyzeText(`${sevenKeyMineFixture}\r\n#002D7:01`);
  assert.equal(result.analysis.measureNotesJson.miniView.status, "unsupported");
  assert.equal(result.analysis.measureNotesJson.miniView.reasonCode, "MINIVIEW_UNSUPPORTED_MODE");
});

await check("malformed mine data fails closed", () => {
  const result = analyzeText(`${sevenKeyMineFixture}\r\n#002D1:0A0`);
  assert.equal(result.analysis.measureNotesJson.miniView.status, "unsupported");
  assert.equal(result.analysis.measureNotesJson.miniView.reasonCode, "MINIVIEW_GENERATION_FAILED");
});

const targetFileIndex = process.argv.indexOf("--target-file");
if (targetFileIndex >= 0) {
  const targetPath = process.argv[targetFileIndex + 1];
  assert.ok(targetPath, "--target-file requires a path");
  await check("downloaded production target now produces a mine-aware miniview", async () => {
    const bytes = await readFile(targetPath);
    const result = analyzeUploadedBmsBytes(asArrayBuffer(bytes), "_15nightrider_mukyu.bms");
    assert.equal(result.analysisFailed, false);
    assert.equal(result.analysis.measureNotesJson.miniView.status, "ready");
    assert.ok(result.analysis.measureNotesJson.miniView.payload.mineCount > 0);
    const payload = result.analysis.measureNotesJson.miniView.payload;
    const decoded = decodePackedEvents(payload);
    console.log(JSON.stringify({
      payloadEndMeasure: payload.endMeasure,
      maximumEventMeasure: Math.max(...decoded.map((event) => event.measure)),
      maximumMineMeasure: Math.max(...decoded.filter((event) => event.kind === 3).map((event) => event.measure))
    }));
    const normalized = normalizeRendererPayload(payload);
    assert.equal(normalized.mineCount, result.analysis.measureNotesJson.miniView.payload.mineCount);
    console.log(JSON.stringify({
      targetStatus: result.analysis.measureNotesJson.miniView.status,
      mineCount: result.analysis.measureNotesJson.miniView.payload.mineCount,
      payloadBytes: new TextEncoder().encode(JSON.stringify(result.analysis.measureNotesJson.miniView)).byteLength
    }));
  });
}

console.log(`bms miniview mine regression tests: ${passed} checks passed`);
