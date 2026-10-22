import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js/index-native.js";

const workerRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(workerRoot, "..");
let passed = 0;
async function check(name, action) {
  await action();
  console.log(`ok ${++passed} - ${name}`);
}

const bundle = await build({
  entryPoints: [resolve(workerRoot, "src/utils/zipValidation.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
  logLevel: "silent"
});
const { inspectZipUpload } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const chartText = "#TITLE ZIP互換確認\n#ARTIST Local Test\n#BPM 120\n#00111:01\n";
const chartBytes = new TextEncoder().encode(chartText);
async function makeArchive(level) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    useCompressionStream: true
  });
  await writer.add("譜面/chart.bms", new Uint8ArrayReader(chartBytes), { level, dataDescriptor: false });
  return writer.close();
}
const stored = await makeArchive(0);
const deflated = await makeArchive(6);
const corrupted = stored.slice();
const header = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength);
assert.equal(header.getUint32(0, true), 0x04034b50);
const dataOffset = 30 + header.getUint16(26, true) + header.getUint16(28, true);
corrupted[dataOffset] ^= 1;

const vendorSource = await readFile(resolve(repositoryRoot, "docs/vendor/zip.min.js"), "utf8");
await check("browser vendor is the exact installed zip.js bundle", async () => {
  const installed = await readFile(resolve(workerRoot, "node_modules/@zip.js/zip.js/dist/zip.min.js"), "utf8");
  assert.equal(vendorSource, installed);
});

for (const [name, bytes] of [["stored", stored], ["deflated", deflated]]) {
  await check(`Worker reads ${name} ZIP and preserves Unicode file names and bytes`, async () => {
    const result = await inspectZipUpload(new File([bytes], "local.zip", { type: "application/zip" }));
    assert.equal(result.ok, true);
    assert.equal(result.chart.fileName, "譜面/chart.bms");
    assert.equal(new TextDecoder().decode(result.chart.bytes), chartText);
  });
}
await check("Worker maps corrupted chart CRC to ZIP_INVALID", async () => {
  const result = await inspectZipUpload(new File([corrupted], "corrupt.zip", { type: "application/zip" }));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "ZIP_INVALID");
});

let externalRequests = 0;
const context = vm.createContext({
  Blob, File, Response, Request, URL, TextEncoder, TextDecoder, ReadableStream, WritableStream,
  TransformStream, CompressionStream, DecompressionStream, crypto, atob, btoa, setTimeout, clearTimeout,
  navigator: { hardwareConcurrency: 1 },
  document: { currentScript: { src: "https://local.invalid/zip-bms-reader.js" }, baseURI: "https://local.invalid/" },
  fetch: async (url) => {
    if (String(url).startsWith("data:")) return fetch(url);
    externalRequests += 1;
    throw new Error("External network is disabled for this test");
  }
});
context.window = context;
context.self = context;
vm.runInContext(vendorSource, context, { filename: "docs/vendor/zip.min.js" });
context.zip.configure({ useWebWorkers: false });
vm.runInContext(await readFile(resolve(repositoryRoot, "docs/zip-bms-reader.js"), "utf8"), context, { filename: "docs/zip-bms-reader.js" });
for (const [name, bytes] of [["stored", stored], ["deflated", deflated]]) {
  await check(`browser ZIP helper reads ${name} archive through updated vendored library`, async () => {
    const result = await context.BmsZipReader.extractSingleBms(new File([bytes], "local.zip"));
    assert.equal(result.fileName, "譜面/chart.bms");
    assert.equal(new TextDecoder().decode(result.buffer), chartText);
  });
}
await check("browser ZIP helper rejects corrupted chart CRC", async () => {
  await assert.rejects(context.BmsZipReader.extractSingleBms(new File([corrupted], "corrupt.zip")), /CRC32/u);
});
await check("ZIP compatibility checks make no external network requests", async () => {
  assert.equal(externalRequests, 0);
});
console.log(`PASS: ${passed} ZIP dependency compatibility checks`);
