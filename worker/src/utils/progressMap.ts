import type { BmsAnalysis } from "./bms";

const PROGRESS_MAP_COLOR = "#1f7a5c";
const MAX_PROGRESS_MAP_BLOCKS = 5000;

type ProgressMapLayerKind = "initial" | "followup" | "completion_fill" | "rejected_auto_fill";

type ProgressMapBlock = {
  index: number;
  startMeasure: number | null;
  endMeasure: number | null;
  startTimeSec: number | null;
  endTimeSec: number | null;
  playNotes: number;
};

type ProgressMapLayer = {
  versionId: string;
  color: string;
  kind: ProgressMapLayerKind;
  ranges: Array<[number, number]>;
};

export type ProgressMapJson = {
  schemaVersion: 2;
  blockMode: "standardized_measure";
  firstMeasure: number | null;
  lastMeasure: number | null;
  targetBlockCount: number;
  blocks: ProgressMapBlock[];
  layers: ProgressMapLayer[];
  progress: number;
};

export type ProgressMapFailure = {
  status: number;
  code: string;
  message: string;
  detail: string;
};

type ProgressMapResult =
  | {
    ok: true;
    progress: number;
    progressMap: ProgressMapJson | null;
    progressMapJson: string | null;
  }
  | { ok: false; failure: ProgressMapFailure };

type PrepareProgressMapParams = {
  rawProgressMap: string;
  versionId: string;
  isRejected: boolean;
  fallbackProgress: number;
  bmsAnalysis: BmsAnalysis | null;
  isZip?: boolean;
  analysisFailed?: boolean;
};

type PrepareAppendProgressMapParams = {
  rawProgressMap: string;
  versionId: string;
  parentProgressMapJson: string | null;
  bmsAnalysis: BmsAnalysis | null;
  isZip?: boolean;
  analysisFailed?: boolean;
};

type ProgressMapLayout = {
  ok: true;
  firstMeasure: number | null;
  lastMeasure: number | null;
  targetBlockCount: number;
  blocks: ProgressMapBlock[];
};

type NormalizeLayoutResult = ProgressMapLayout | { ok: false; failure: ProgressMapFailure };

function failure(code: string, detail: string, status = 400): ProgressMapFailure {
  const messages: Record<string, string> = {
    INVALID_PROGRESS_MAP: "進捗マップ情報が不正です。",
    PROGRESS_MAP_OUT_OF_RANGE: "進捗マップの範囲が不正です。",
    PROGRESS_MAP_BLOCK_COUNT_MISMATCH: "進捗マップのブロック数が一致しません。",
    ZIP_PROGRESS_MAP_MISMATCH: "ZIP内譜面と進捗マップが一致しません。",
    ZIP_BMS_ANALYSIS_FAILED: "ZIP内譜面を解析できないため進捗マップを確認できません。",
    PROGRESS_MAP_UNCHANGED: "進捗マップに変更がありません。"
  };

  return {
    status,
    code,
    message: messages[code] ?? "進捗マップ情報が不正です。",
    detail
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProgressMapFailure(value: unknown): value is ProgressMapFailure {
  return isRecord(value) && typeof value.code === "string" && typeof value.detail === "string";
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeNullableInteger(value: unknown, fieldName: string): number | null | ProgressMapFailure {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isSafeNonNegativeInteger(value)) {
    return failure("INVALID_PROGRESS_MAP", `${fieldName} must be a non-negative integer or null.`);
  }

  return value;
}

function normalizeNullableSeconds(value: unknown, fieldName: string): number | null | ProgressMapFailure {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return failure("INVALID_PROGRESS_MAP", `${fieldName} must be a non-negative number or null.`);
  }

  return value;
}

function parseProgressMap(rawProgressMap: string): { ok: true; value: unknown } | { ok: false; failure: ProgressMapFailure } {
  try {
    return { ok: true, value: JSON.parse(rawProgressMap) };
  } catch (error) {
    return {
      ok: false,
      failure: failure(
        "INVALID_PROGRESS_MAP",
        `progressMap must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    };
  }
}

function normalizeBlock(value: unknown, expectedIndex: number): { ok: true; value: ProgressMapBlock } | { ok: false; failure: ProgressMapFailure } {
  if (!isRecord(value)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", `blocks[${expectedIndex}] must be an object.`) };
  }

  if (value.index !== expectedIndex) {
    return {
      ok: false,
      failure: failure("INVALID_PROGRESS_MAP", `blocks[${expectedIndex}].index must be ${expectedIndex}.`)
    };
  }

  const startMeasure = normalizeNullableInteger(value.startMeasure, `blocks[${expectedIndex}].startMeasure`);
  if (isProgressMapFailure(startMeasure)) {
    return { ok: false, failure: startMeasure };
  }

  const endMeasure = normalizeNullableInteger(value.endMeasure, `blocks[${expectedIndex}].endMeasure`);
  if (isProgressMapFailure(endMeasure)) {
    return { ok: false, failure: endMeasure };
  }

  const startTimeSec = normalizeNullableSeconds(value.startTimeSec, `blocks[${expectedIndex}].startTimeSec`);
  if (isProgressMapFailure(startTimeSec)) {
    return { ok: false, failure: startTimeSec };
  }

  const endTimeSec = normalizeNullableSeconds(value.endTimeSec, `blocks[${expectedIndex}].endTimeSec`);
  if (isProgressMapFailure(endTimeSec)) {
    return { ok: false, failure: endTimeSec };
  }

  if (!isSafeNonNegativeInteger(value.playNotes)) {
    return {
      ok: false,
      failure: failure("INVALID_PROGRESS_MAP", `blocks[${expectedIndex}].playNotes must be a non-negative integer.`)
    };
  }

  return {
    ok: true,
    value: {
      index: expectedIndex,
      startMeasure,
      endMeasure,
      startTimeSec,
      endTimeSec,
      playNotes: value.playNotes
    }
  };
}

function nullableSecondsEqual(left: number | null, right: number | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return Math.abs(left - right) <= 0.05;
}

function buildCanonicalLayout(bmsAnalysis: BmsAnalysis): ProgressMapLayout {
  return {
    ok: true,
    firstMeasure: bmsAnalysis.displayFirstMeasure,
    lastMeasure: bmsAnalysis.displayLastMeasure,
    targetBlockCount: bmsAnalysis.standardBlocks.length,
    blocks: bmsAnalysis.standardBlocks.map((block) => ({ ...block }))
  };
}

function layoutsMatchAnalysis(client: ProgressMapLayout, canonical: ProgressMapLayout): boolean {
  if (
    client.firstMeasure !== canonical.firstMeasure
    || client.lastMeasure !== canonical.lastMeasure
    || client.targetBlockCount !== canonical.targetBlockCount
    || client.blocks.length !== canonical.blocks.length
  ) {
    return false;
  }

  return client.blocks.every((block, index) => {
    const expected = canonical.blocks[index];
    return block.index === expected.index
      && block.startMeasure === expected.startMeasure
      && block.endMeasure === expected.endMeasure
      && block.playNotes === expected.playNotes
      && nullableSecondsEqual(block.startTimeSec, expected.startTimeSec)
      && nullableSecondsEqual(block.endTimeSec, expected.endTimeSec);
  });
}

function layoutsShareGrid(left: ProgressMapLayout, right: ProgressMapLayout): boolean {
  if (
    left.firstMeasure !== right.firstMeasure
    || left.lastMeasure !== right.lastMeasure
    || left.targetBlockCount !== right.targetBlockCount
    || left.blocks.length !== right.blocks.length
  ) {
    return false;
  }

  return left.blocks.every((block, index) => {
    const other = right.blocks[index];
    return block.index === other.index
      && block.startMeasure === other.startMeasure
      && block.endMeasure === other.endMeasure;
  });
}

function normalizeLayout(
  root: unknown,
  bmsAnalysis: BmsAnalysis | null,
  mismatchCode = "PROGRESS_MAP_BLOCK_COUNT_MISMATCH"
): NormalizeLayoutResult {
  if (!isRecord(root)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap must be an object.") };
  }

  if (root.schemaVersion !== 2) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap.schemaVersion must be 2.") };
  }

  if (root.blockMode !== "standardized_measure") {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap.blockMode must be standardized_measure.") };
  }

  if (!isSafeNonNegativeInteger(root.targetBlockCount) || root.targetBlockCount > MAX_PROGRESS_MAP_BLOCKS) {
    return {
      ok: false,
      failure: failure("INVALID_PROGRESS_MAP", `targetBlockCount must be a non-negative integer up to ${MAX_PROGRESS_MAP_BLOCKS}.`)
    };
  }

  if (!Array.isArray(root.blocks)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap.blocks must be an array.") };
  }

  if (root.blocks.length !== root.targetBlockCount) {
    return {
      ok: false,
      failure: failure(
        "PROGRESS_MAP_BLOCK_COUNT_MISMATCH",
        `blocks.length (${root.blocks.length}) must match targetBlockCount (${root.targetBlockCount}).`
      )
    };
  }

  if (bmsAnalysis && bmsAnalysis.playNotes > 0 && root.targetBlockCount === 0) {
    return {
      ok: false,
      failure: failure("PROGRESS_MAP_BLOCK_COUNT_MISMATCH", "BMS analysis detected play notes, but progressMap has zero blocks.")
    };
  }

  const firstMeasure = normalizeNullableInteger(root.firstMeasure, "progressMap.firstMeasure");
  if (isProgressMapFailure(firstMeasure)) {
    return { ok: false, failure: firstMeasure };
  }

  const lastMeasure = normalizeNullableInteger(root.lastMeasure, "progressMap.lastMeasure");
  if (isProgressMapFailure(lastMeasure)) {
    return { ok: false, failure: lastMeasure };
  }

  const blocks: ProgressMapBlock[] = [];
  for (let index = 0; index < root.blocks.length; index += 1) {
    const normalized = normalizeBlock(root.blocks[index], index);
    if (!normalized.ok) {
      return normalized;
    }
    blocks.push(normalized.value);
  }

  const clientLayout: ProgressMapLayout = {
    ok: true,
    firstMeasure,
    lastMeasure,
    targetBlockCount: root.targetBlockCount,
    blocks
  };

  if (!bmsAnalysis) {
    return clientLayout;
  }

  const canonicalLayout = buildCanonicalLayout(bmsAnalysis);
  if (!layoutsMatchAnalysis(clientLayout, canonicalLayout)) {
    return {
      ok: false,
      failure: failure(
        mismatchCode,
        "Client progressMap blocks do not match the Worker BMS analysis."
      )
    };
  }

  return canonicalLayout;
}

export function compressBlockIndexesToRanges(indexes: Iterable<number>): Array<[number, number]> {
  const sortedIndexes = [...new Set(indexes)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((a, b) => a - b);

  const ranges: Array<[number, number]> = [];
  for (const index of sortedIndexes) {
    const previousRange = ranges[ranges.length - 1];
    if (previousRange && previousRange[1] + 1 === index) {
      previousRange[1] = index;
    } else {
      ranges.push([index, index]);
    }
  }

  return ranges;
}

function collectPaintedIndexes(root: Record<string, unknown>, targetBlockCount: number): { ok: true; indexes: Set<number> } | { ok: false; failure: ProgressMapFailure } {
  if (!Array.isArray(root.layers)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap.layers must be an array.") };
  }

  const indexes = new Set<number>();
  for (const [layerIndex, layer] of root.layers.entries()) {
    if (!isRecord(layer) || !Array.isArray(layer.ranges)) {
      return { ok: false, failure: failure("INVALID_PROGRESS_MAP", `layers[${layerIndex}].ranges must be an array.`) };
    }

    for (const [rangeIndex, range] of layer.ranges.entries()) {
      if (!Array.isArray(range) || range.length !== 2 || !isSafeNonNegativeInteger(range[0]) || !isSafeNonNegativeInteger(range[1])) {
        return {
          ok: false,
          failure: failure("INVALID_PROGRESS_MAP", `layers[${layerIndex}].ranges[${rangeIndex}] must be [startIndex, endIndex].`)
        };
      }

      const [startIndex, endIndex] = range;
      if (startIndex > endIndex) {
        return {
          ok: false,
          failure: failure("PROGRESS_MAP_OUT_OF_RANGE", `Range start must be less than or equal to end: ${startIndex}-${endIndex}.`)
        };
      }

      if (targetBlockCount === 0 || endIndex >= targetBlockCount) {
        return {
          ok: false,
          failure: failure("PROGRESS_MAP_OUT_OF_RANGE", `Range ${startIndex}-${endIndex} exceeds targetBlockCount ${targetBlockCount}.`)
        };
      }

      for (let index = startIndex; index <= endIndex; index += 1) {
        indexes.add(index);
      }
    }
  }

  return { ok: true, indexes };
}

function collectRangeIndexes(ranges: Array<[number, number]>): Set<number> {
  const indexes = new Set<number>();
  for (const [startIndex, endIndex] of ranges) {
    for (let index = startIndex; index <= endIndex; index += 1) {
      indexes.add(index);
    }
  }
  return indexes;
}

function normalizeLayerKind(root: Record<string, unknown>, progress: number): ProgressMapLayerKind {
  const firstLayer = Array.isArray(root.layers) && isRecord(root.layers[0]) ? root.layers[0] : null;
  const kind = firstLayer?.kind;
  if (kind === "completion_fill" && progress === 100) {
    return "completion_fill";
  }

  return "initial";
}

function normalizeLayerKindValue(value: unknown, fallback: ProgressMapLayerKind): ProgressMapLayerKind {
  if (value === "initial" || value === "followup" || value === "completion_fill" || value === "rejected_auto_fill") {
    return value;
  }

  return fallback;
}

function normalizeLayerColor(value: unknown): string {
  if (typeof value !== "string") {
    return PROGRESS_MAP_COLOR;
  }

  const color = value.trim();
  return color ? color.slice(0, 32) : PROGRESS_MAP_COLOR;
}

function normalizeVersionId(value: unknown, fallbackVersionId: string): string {
  if (typeof value !== "string") {
    return fallbackVersionId;
  }

  const versionId = value.trim();
  return versionId && versionId !== "pending" ? versionId.slice(0, 160) : fallbackVersionId;
}

function normalizeLayerRanges(
  ranges: unknown,
  targetBlockCount: number,
  layerIndex: number
): { ok: true; ranges: Array<[number, number]> } | { ok: false; failure: ProgressMapFailure } {
  if (!Array.isArray(ranges)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", `layers[${layerIndex}].ranges must be an array.`) };
  }

  const indexes = new Set<number>();
  for (const [rangeIndex, range] of ranges.entries()) {
    if (!Array.isArray(range) || range.length !== 2 || !isSafeNonNegativeInteger(range[0]) || !isSafeNonNegativeInteger(range[1])) {
      return {
        ok: false,
        failure: failure("INVALID_PROGRESS_MAP", `layers[${layerIndex}].ranges[${rangeIndex}] must be [startIndex, endIndex].`)
      };
    }

    const [startIndex, endIndex] = range;
    if (startIndex > endIndex) {
      return {
        ok: false,
        failure: failure("PROGRESS_MAP_OUT_OF_RANGE", `Range start must be less than or equal to end: ${startIndex}-${endIndex}.`)
      };
    }

    if (targetBlockCount === 0 || endIndex >= targetBlockCount) {
      return {
        ok: false,
        failure: failure("PROGRESS_MAP_OUT_OF_RANGE", `Range ${startIndex}-${endIndex} exceeds targetBlockCount ${targetBlockCount}.`)
      };
    }

    for (let index = startIndex; index <= endIndex; index += 1) {
      indexes.add(index);
    }
  }

  return { ok: true, ranges: compressBlockIndexesToRanges(indexes) };
}

function normalizeFollowupLayers(
  root: Record<string, unknown>,
  targetBlockCount: number,
  versionId: string
): { ok: true; layers: ProgressMapLayer[]; paintedIndexes: Set<number> } | { ok: false; failure: ProgressMapFailure } {
  if (!Array.isArray(root.layers)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap.layers must be an array.") };
  }

  const layers: ProgressMapLayer[] = [];
  const paintedIndexes = new Set<number>();
  const lastLayerIndex = root.layers.length - 1;

  for (const [layerIndex, layer] of root.layers.entries()) {
    if (!isRecord(layer)) {
      return { ok: false, failure: failure("INVALID_PROGRESS_MAP", `layers[${layerIndex}] must be an object.`) };
    }

    const normalizedRanges = normalizeLayerRanges(layer.ranges, targetBlockCount, layerIndex);
    if (!normalizedRanges.ok) {
      return normalizedRanges;
    }

    for (const index of collectRangeIndexes(normalizedRanges.ranges)) {
      paintedIndexes.add(index);
    }

    const fallbackKind: ProgressMapLayerKind = layerIndex === lastLayerIndex ? "followup" : "initial";
    const incomingVersionId = normalizeVersionId(layer.versionId, versionId);
    layers.push({
      versionId: layerIndex === lastLayerIndex ? versionId : incomingVersionId,
      color: normalizeLayerColor(layer.color),
      kind: normalizeLayerKindValue(layer.kind, fallbackKind),
      ranges: normalizedRanges.ranges
    });
  }

  return { ok: true, layers, paintedIndexes };
}

function buildProgressMapJson(
  versionId: string,
  layout: ProgressMapLayout,
  kind: ProgressMapLayerKind,
  paintedIndexes: Set<number>,
  forcedProgress?: number
): ProgressMapJson {
  const progress = forcedProgress ?? (layout.targetBlockCount === 0
    ? 0
    : Math.round((paintedIndexes.size / layout.targetBlockCount) * 100));

  return {
    schemaVersion: 2,
    blockMode: "standardized_measure",
    firstMeasure: layout.firstMeasure,
    lastMeasure: layout.lastMeasure,
    targetBlockCount: layout.targetBlockCount,
    blocks: layout.blocks,
    layers: [
      {
        versionId,
        color: PROGRESS_MAP_COLOR,
        kind,
        ranges: compressBlockIndexesToRanges(paintedIndexes)
      }
    ],
    progress
  };
}

function buildPaintedSignature(targetBlockCount: number, indexes: Set<number>): string {
  return `${targetBlockCount}:${compressBlockIndexesToRanges(indexes)
    .map(([startIndex, endIndex]) => `${startIndex}-${endIndex}`)
    .join(",")}`;
}

function buildStoredProgressMapSignature(rawProgressMap: string | null): string | null {
  if (!rawProgressMap?.trim()) {
    return null;
  }

  const parsed = parseProgressMap(rawProgressMap);
  if (!parsed.ok) {
    return null;
  }

  const layout = normalizeLayout(parsed.value, null);
  if (!layout.ok || !isRecord(parsed.value)) {
    return null;
  }

  const painted = collectPaintedIndexes(parsed.value, layout.targetBlockCount);
  if (!painted.ok) {
    return null;
  }

  return buildPaintedSignature(layout.targetBlockCount, painted.indexes);
}

function normalizeClientProgressMap(
  rawProgressMap: string,
  versionId: string,
  bmsAnalysis: BmsAnalysis | null,
  isZip: boolean
): ProgressMapResult {
  const parsed = parseProgressMap(rawProgressMap);
  if (!parsed.ok) {
    return parsed;
  }

  const layout = normalizeLayout(
    parsed.value,
    bmsAnalysis,
    isZip ? "ZIP_PROGRESS_MAP_MISMATCH" : "PROGRESS_MAP_BLOCK_COUNT_MISMATCH"
  );
  if (!layout.ok) {
    return layout;
  }

  if (!isRecord(parsed.value)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap must be an object.") };
  }

  const painted = collectPaintedIndexes(parsed.value, layout.targetBlockCount);
  if (!painted.ok) {
    return painted;
  }

  const progress = layout.targetBlockCount === 0
    ? 0
    : Math.round((painted.indexes.size / layout.targetBlockCount) * 100);
  const kind = normalizeLayerKind(parsed.value, progress);
  const progressMap = buildProgressMapJson(versionId, layout, kind, painted.indexes, progress);

  return {
    ok: true,
    progress,
    progressMap,
    progressMapJson: JSON.stringify(progressMap)
  };
}

function normalizeAppendProgressMap(
  rawProgressMap: string,
  versionId: string,
  parentProgressMapJson: string | null,
  bmsAnalysis: BmsAnalysis | null,
  isZip: boolean
): ProgressMapResult {
  const parsed = parseProgressMap(rawProgressMap);
  if (!parsed.ok) {
    return parsed;
  }

  const layout = normalizeLayout(
    parsed.value,
    bmsAnalysis,
    isZip ? "ZIP_PROGRESS_MAP_MISMATCH" : "PROGRESS_MAP_BLOCK_COUNT_MISMATCH"
  );
  if (!layout.ok) {
    return layout;
  }

  if (!isRecord(parsed.value)) {
    return { ok: false, failure: failure("INVALID_PROGRESS_MAP", "progressMap must be an object.") };
  }

  if (isZip) {
    if (!parentProgressMapJson?.trim()) {
      return {
        ok: false,
        failure: failure("ZIP_PROGRESS_MAP_MISMATCH", "Parent progressMap is missing.")
      };
    }
    const parentParsed = parseProgressMap(parentProgressMapJson);
    if (!parentParsed.ok) {
      return {
        ok: false,
        failure: failure("ZIP_PROGRESS_MAP_MISMATCH", "Parent progressMap is invalid.")
      };
    }
    const parentLayout = normalizeLayout(parentParsed.value, null);
    if (!parentLayout.ok || !layoutsShareGrid(parentLayout, layout)) {
      return {
        ok: false,
        failure: failure("ZIP_PROGRESS_MAP_MISMATCH", "Parent progressMap grid does not match the ZIP BMS analysis.")
      };
    }
  }

  const normalizedLayers = normalizeFollowupLayers(parsed.value, layout.targetBlockCount, versionId);
  if (!normalizedLayers.ok) {
    return normalizedLayers;
  }

  const progress = layout.targetBlockCount === 0
    ? 0
    : Math.round((normalizedLayers.paintedIndexes.size / layout.targetBlockCount) * 100);
  const nextSignature = buildPaintedSignature(layout.targetBlockCount, normalizedLayers.paintedIndexes);
  const parentSignature = buildStoredProgressMapSignature(parentProgressMapJson);

  if (parentSignature !== null && parentSignature === nextSignature) {
    return {
      ok: false,
      failure: failure(
        "PROGRESS_MAP_UNCHANGED",
        "Follow-up progressMap painted ranges are identical to the parent version.",
        409
      )
    };
  }

  const progressMap: ProgressMapJson = {
    schemaVersion: 2,
    blockMode: "standardized_measure",
    firstMeasure: layout.firstMeasure,
    lastMeasure: layout.lastMeasure,
    targetBlockCount: layout.targetBlockCount,
    blocks: layout.blocks,
    layers: normalizedLayers.layers,
    progress
  };

  return {
    ok: true,
    progress,
    progressMap,
    progressMapJson: JSON.stringify(progressMap)
  };
}

function buildFallbackLayoutFromBmsAnalysis(bmsAnalysis: BmsAnalysis | null): ProgressMapLayout {
  if (!bmsAnalysis || bmsAnalysis.playNotes <= 0) {
    return {
      ok: true,
      firstMeasure: null,
      lastMeasure: null,
      targetBlockCount: 0,
      blocks: []
    };
  }

  return buildCanonicalLayout(bmsAnalysis);
}

function buildRejectedProgressMap(
  rawProgressMap: string,
  versionId: string,
  bmsAnalysis: BmsAnalysis | null,
  isZip: boolean
): ProgressMapResult {
  let layout: ProgressMapLayout | null = null;

  if (rawProgressMap.trim()) {
    const parsed = parseProgressMap(rawProgressMap);
    if (parsed.ok) {
      const normalizedLayout = normalizeLayout(
        parsed.value,
        bmsAnalysis,
        isZip ? "ZIP_PROGRESS_MAP_MISMATCH" : "PROGRESS_MAP_BLOCK_COUNT_MISMATCH"
      );
      if (normalizedLayout.ok) {
        layout = normalizedLayout;
      } else if (isZip) {
        return normalizedLayout;
      }
    }
  }

  if (!layout) {
    layout = buildFallbackLayoutFromBmsAnalysis(bmsAnalysis);
  }

  const paintedIndexes = new Set<number>();
  for (let index = 0; index < layout.targetBlockCount; index += 1) {
    paintedIndexes.add(index);
  }

  const progressMap = buildProgressMapJson(versionId, layout, "rejected_auto_fill", paintedIndexes, 100);

  return {
    ok: true,
    progress: 100,
    progressMap,
    progressMapJson: JSON.stringify(progressMap)
  };
}

export function prepareProgressMap(params: PrepareProgressMapParams): ProgressMapResult {
  const isZip = params.isZip === true;
  if (isZip && params.analysisFailed && params.rawProgressMap.trim()) {
    return {
      ok: false,
      failure: failure("ZIP_BMS_ANALYSIS_FAILED", "Worker could not analyze the ZIP BMS required to validate progressMap.")
    };
  }

  if (params.isRejected) {
    return buildRejectedProgressMap(params.rawProgressMap, params.versionId, params.bmsAnalysis, isZip);
  }

  if (!params.rawProgressMap.trim()) {
    return {
      ok: true,
      progress: params.fallbackProgress,
      progressMap: null,
      progressMapJson: null
    };
  }

  return normalizeClientProgressMap(params.rawProgressMap, params.versionId, params.bmsAnalysis, isZip);
}

export function prepareAppendProgressMap(params: PrepareAppendProgressMapParams): ProgressMapResult {
  if (!params.rawProgressMap.trim()) {
    return {
      ok: false,
      failure: failure("INVALID_PROGRESS_MAP", "progressMap field is required for follow-up versions.")
    };
  }

  if (params.isZip && params.analysisFailed) {
    return {
      ok: false,
      failure: failure("ZIP_BMS_ANALYSIS_FAILED", "Worker could not analyze the ZIP BMS required to validate progressMap.")
    };
  }

  return normalizeAppendProgressMap(
    params.rawProgressMap,
    params.versionId,
    params.parentProgressMapJson,
    params.bmsAnalysis,
    params.isZip === true
  );
}
