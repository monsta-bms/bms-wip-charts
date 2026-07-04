#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_BASE_URL = "http://localhost:8787";

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const equalIndex = token.indexOf("=");
    if (equalIndex >= 0) {
      const key = token.slice(2, equalIndex);
      const value = token.slice(equalIndex + 1);
      args.set(key, value);
      continue;
    }

    const key = token.slice(2);
    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    args.set(key, nextValue);
    index += 1;
  }

  return {
    apiBaseUrl: trimTrailingSlash(args.get("apiBaseUrl") ?? DEFAULT_API_BASE_URL),
    chartId: requireArg(args, "chartId"),
    parentVersionId: requireArg(args, "parentVersionId"),
    filePath: requireArg(args, "filePath"),
    author: requireArg(args, "author"),
    password: requireArg(args, "password"),
    comment: args.get("comment") ?? "BRANCH-01A-CHECK append test",
  };
}

function requireArg(args, key) {
  const value = args.get(key);
  if (!value || value.trim() === "") {
    throw new Error(`Missing required argument: --${key}`);
  }

  return value;
}

function trimTrailingSlash(value) {
  return value.trim().replace(/\/+$/, "");
}

function printUsage() {
  console.error(`Usage:
node ./scripts/test-append-version.mjs \\
  --apiBaseUrl "http://localhost:8787" \\
  --chartId "chart_xxx" \\
  --parentVersionId "version_xxx" \\
  --filePath "./branch-append.bms" \\
  --author "append-author" \\
  --password "test-password"`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  const body = parseJsonOrNull(text);

  if (!response.ok) {
    const detail = body ? JSON.stringify(body, null, 2) : text;
    throw new Error(`GET failed. status=${response.status}, url=${url}\n${detail}`);
  }

  if (!body) {
    throw new Error(`GET returned non-JSON response. url=${url}`);
  }

  return body;
}

function parseJsonOrNull(text) {
  if (!text || text.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function findParentVersion(apiBaseUrl, chartId, parentVersionId) {
  let page = 1;
  const pageSize = 200;

  while (true) {
    const url = new URL(`${apiBaseUrl}/api/charts`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));

    const body = await fetchJson(url);
    const charts = Array.isArray(body.charts) ? body.charts : [];

    for (const entry of charts) {
      if (!entry?.chart || entry.chart.id !== chartId) {
        continue;
      }

      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      for (const version of versions) {
        if (version?.id === parentVersionId) {
          return { entry, version };
        }
      }
    }

    if (!body.pagination?.hasNext) {
      break;
    }

    page += 1;
  }

  throw new Error(`Parent version not found. chartId=${chartId}, parentVersionId=${parentVersionId}`);
}

function cloneProgressMap(value) {
  if (value == null) {
    throw new Error("Parent version has no progressMap. Use a parent created after PROG-04A.");
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Parent progressMap is not valid JSON. ${error.message}`);
    }
  }

  return JSON.parse(JSON.stringify(value));
}

function assertProgressMapBase(progressMap) {
  if (progressMap.schemaVersion !== 2) {
    throw new Error("progressMap.schemaVersion must be 2.");
  }

  if (progressMap.blockMode !== "standardized_measure") {
    throw new Error("progressMap.blockMode must be standardized_measure.");
  }

  if (!Array.isArray(progressMap.blocks) || progressMap.blocks.length === 0) {
    throw new Error("progressMap.blocks must be a non-empty array.");
  }

  if (!Array.isArray(progressMap.layers)) {
    throw new Error("progressMap.layers must be an array before appending.");
  }
}

function normalizeRange(range, layerIndex, rangeIndex) {
  if (!Array.isArray(range) || range.length !== 2) {
    throw new Error(`progressMap.layers[${layerIndex}].ranges[${rangeIndex}] must be [start,end].`);
  }

  const start = Number(range[0]);
  const end = Number(range[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`progressMap.layers[${layerIndex}].ranges[${rangeIndex}] must contain integer indexes.`);
  }

  if (start > end) {
    throw new Error(`progressMap.layers[${layerIndex}].ranges[${rangeIndex}] start must be <= end.`);
  }

  return [start, end];
}

function normalizeLayer(layer, layerIndex) {
  if (!layer || typeof layer !== "object") {
    throw new Error(`progressMap.layers[${layerIndex}] must be an object.`);
  }

  if (!Array.isArray(layer.ranges)) {
    throw new Error(`progressMap.layers[${layerIndex}].ranges must be an array.`);
  }

  return {
    ...layer,
    ranges: layer.ranges.map((range, rangeIndex) => normalizeRange(range, layerIndex, rangeIndex)),
  };
}

function collectPaintedIndexes(layers) {
  const painted = new Set();

  for (const [layerIndex, layer] of layers.entries()) {
    for (const [rangeIndex, range] of layer.ranges.entries()) {
      const [start, end] = normalizeRange(range, layerIndex, rangeIndex);
      for (let index = start; index <= end; index += 1) {
        painted.add(index);
      }
    }
  }

  return painted;
}

function getBlockIndexes(progressMap) {
  return progressMap.blocks.map((block, fallbackIndex) => {
    const index = Number(block?.index ?? fallbackIndex);
    if (!Number.isInteger(index)) {
      throw new Error(`progressMap.blocks[${fallbackIndex}].index must be an integer.`);
    }

    return index;
  });
}

function appendOneBlock(progressMap) {
  assertProgressMapBase(progressMap);

  const targetBlockCount = Number(progressMap.targetBlockCount ?? progressMap.blocks.length);
  if (!Number.isInteger(targetBlockCount) || targetBlockCount <= 0) {
    throw new Error("progressMap.targetBlockCount must be a positive integer.");
  }

  if (progressMap.blocks.length !== targetBlockCount) {
    throw new Error(`progressMap block count mismatch. blocks=${progressMap.blocks.length}, targetBlockCount=${targetBlockCount}`);
  }

  const parentLayers = progressMap.layers.map((layer, index) => normalizeLayer(layer, index));
  const blockIndexes = getBlockIndexes(progressMap);
  const paintedBefore = collectPaintedIndexes(parentLayers);
  const nextIndex = blockIndexes.find((blockIndex) => !paintedBefore.has(blockIndex));

  if (nextIndex == null) {
    throw new Error("No unpainted block is available. Parent progressMap is already fully painted.");
  }

  const followupLayer = {
    versionId: "pending",
    color: "#2563eb",
    kind: "followup",
    ranges: [[nextIndex, nextIndex]],
  };

  const layers = [...parentLayers, followupLayer];
  const paintedAfter = collectPaintedIndexes(layers);
  const progress = Math.round((paintedAfter.size / targetBlockCount) * 100);

  return {
    progressMap: {
      ...progressMap,
      schemaVersion: 2,
      blockMode: "standardized_measure",
      blocks: progressMap.blocks,
      layers,
      progress,
    },
    addedBlockIndex: nextIndex,
    progress,
  };
}

function assertGeneratedProgressMap(progressMap) {
  if (!Array.isArray(progressMap.layers)) {
    throw new Error("Generated progressMap.layers must be an array.");
  }

  if (progressMap.layers.length < 1) {
    throw new Error("Generated progressMap.layers must contain at least one layer.");
  }

  if (!Array.isArray(progressMap.layers[0].ranges)) {
    throw new Error("Generated progressMap.layers[0].ranges must be an array.");
  }

  if (!Array.isArray(progressMap.layers[0].ranges[0])) {
    throw new Error("Generated progressMap.layers[0].ranges[0] must be an array.");
  }

  if (progressMap.layers[0].ranges[0].length !== 2) {
    throw new Error("Generated progressMap.layers[0].ranges[0] must contain exactly two values.");
  }

  const json = JSON.stringify(progressMap);
  const parsed = JSON.parse(json);

  if (!Array.isArray(parsed.layers) || !Array.isArray(parsed.layers[0]?.ranges) || !Array.isArray(parsed.layers[0]?.ranges?.[0])) {
    throw new Error("Generated progressMap did not survive JSON.stringify/JSON.parse array validation.");
  }

  return json;
}

function getNestedValue(object, pathParts) {
  let current = object;
  for (const part of pathParts) {
    if (current == null || typeof current !== "object" || !(part in current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function firstValue(object, paths) {
  for (const pathValue of paths) {
    const value = getNestedValue(object, pathValue.split("."));
    if (value != null && value !== "") {
      return value;
    }
  }

  return "<not returned>";
}

async function postAppendVersion(options, progressMapJson) {
  const fileBuffer = await readFile(options.filePath);
  const fileName = path.basename(options.filePath);
  const fileBlob = new Blob([fileBuffer], { type: "application/octet-stream" });

  const form = new FormData();
  form.append("file", fileBlob, fileName);
  form.append("parentVersionId", options.parentVersionId);
  form.append("author", options.author);
  form.append("progressMap", progressMapJson);
  form.append("comment", options.comment);
  form.append("password", options.password);

  const url = `${options.apiBaseUrl}/api/charts/${encodeURIComponent(options.chartId)}/versions`;
  const response = await fetch(url, {
    method: "POST",
    body: form,
  });

  const text = await response.text();
  const body = parseJsonOrNull(text);

  return {
    ok: response.ok,
    status: response.status,
    body,
    text,
  };
}

function printFullResponse(result) {
  if (result.body) {
    console.log(JSON.stringify(result.body, null, 2));
  } else if (result.text.trim()) {
    console.log(result.text);
  } else {
    console.log("<empty response body>");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log(`API_BASE_URL: ${options.apiBaseUrl}`);
  console.log(`chartId: ${options.chartId}`);
  console.log(`parentVersionId: ${options.parentVersionId}`);
  console.log(`filePath: ${path.resolve(options.filePath)}`);

  const { version } = await findParentVersion(options.apiBaseUrl, options.chartId, options.parentVersionId);
  const parentProgressMap = cloneProgressMap(version.progressMap);
  const appendResult = appendOneBlock(parentProgressMap);
  const progressMapJson = assertGeneratedProgressMap(appendResult.progressMap);

  console.log(`Parent displayVersion: ${version.displayVersion ?? "<not returned>"}`);
  console.log(`Added block index: ${appendResult.addedBlockIndex}`);
  console.log(`Expected recalculated progress: ${appendResult.progress}%`);
  console.log(`progressMapJson preview: ${progressMapJson.slice(0, 200)}`);
  console.log(`progressMap layers array: ${Array.isArray(appendResult.progressMap.layers)}; layers count: ${appendResult.progressMap.layers.length}; first ranges array: ${Array.isArray(appendResult.progressMap.layers[0].ranges)}; first range array: ${Array.isArray(appendResult.progressMap.layers[0].ranges[0])}; first range length: ${appendResult.progressMap.layers[0].ranges[0].length}`);

  const result = await postAppendVersion(options, progressMapJson);

  if (result.ok && result.body?.mode === "stub") {
    console.error("API returned stub response. Deploy or route implementation is not active.");
    console.error("Full response body:");
    printFullResponse(result);
    process.exitCode = 1;
    return;
  }

  if (!result.ok) {
    console.error("Append request failed.");
    console.error(`HTTP status: ${result.status}`);
    if (result.body) {
      console.error(`code: ${result.body.code ?? "<not returned>"}`);
      console.error(`message: ${result.body.message ?? "<not returned>"}`);
      console.error(`detail: ${result.body.detail ?? "<not returned>"}`);
    } else {
      console.error(result.text || "<empty response body>");
    }
    process.exitCode = 1;
    return;
  }

  console.log("Append request succeeded.");
  console.log("Full response body:");
  printFullResponse(result);

  console.log(`versionId: ${firstValue(result.body, ["versionId", "id", "version.id", "data.versionId", "data.version.id"])}`);
  console.log(`branchPath: ${firstValue(result.body, ["branchPath", "branch_path", "version.branchPath", "version.branch_path", "data.branchPath", "data.branch_path", "data.version.branchPath", "data.version.branch_path"])}`);
  console.log(`progress: ${firstValue(result.body, ["progress", "version.progress", "data.progress", "data.version.progress"])}`);
}

main().catch((error) => {
  console.error("Append check failed.");
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exitCode = 1;
});
