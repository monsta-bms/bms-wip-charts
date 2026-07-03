import type { BmsAnalysis } from "./bms";

const PROGRESS_MAP_COLOR = "#1f7a5c";
const MAX_PROGRESS_MAP_BLOCKS = 5000;

type ProgressMapLayerKind = "initial" | "completion_fill" | "rejected_auto_fill";

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

type ProgressMapFailure = {
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
};

type NormalizeLayoutResult =
  | { ok: true; firstMeasure: number | null; lastMeasure: number | null; targetBlockCount: number; blocks: ProgressMapBlock[] }
  | { ok: false; failure: ProgressMapFailure };

function failure(code: string, detail: string, status = 400): ProgressMapFailure {
  const messages: Record<string, string> = {
    INVALID_PROGRESS_MAP: "進捗マップ情報が不正です。",
    PROGRESS_MAP_OUT_OF_RANGE: "進捗マップの範囲が不正です。",
    PROGRESS_MAP_BLOCK_COUNT_MISMATCH: "進捗マップのブロック数が一致しません。"
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
  if (isRecord(startMeasure)) {
    return { ok: false, failure: startMeasure };
  }

  const endMeasure = normalizeNullableInteger(value.endMeasure, `blocks[${expectedIndex}].endMeasure`);
  if (isRecord(endMeasure)) {
    return { ok: false, failure: endMeasure };
  }

  const startTimeSec = normalizeNullableSeconds(value.startTimeSec, `blocks[${expectedIndex}].startTimeSec`);
  if (isRecord(startTimeSec)) {
    return { ok: false, failure: startTimeSec };
  }

  const endTimeSec = normalizeNullableSeconds(value.endTimeSec, `blocks[${expectedIndex}].endTimeSec`);
  if (isRecord(endTimeSec)) {
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

function normalizeLayout(root: unknown, bmsAnalysis: BmsAnalysis | null): NormalizeLayoutResult {
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
  if (isRecord(firstMeasure)) {
    return { ok: false, failure: firstMeasure };
  }

  const lastMeasure = normalizeNullableInteger(root.lastMeasure, "progressMap.lastMeasure");
  if (isRecord(lastMeasure)) {
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

  return {
    ok: true,
    firstMeasure,
    lastMeasure,
    targetBlockCount: root.targetBlockCount,
    blocks
  };
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

function normalizeLayerKind(root: Record<string, unknown>, progress: number): ProgressMapLayerKind {
  const firstLayer = Array.isArray(root.layers) && isRecord(root.layers[0]) ? root.layers[0] : null;
  const kind = firstLayer?.kind;
  if (kind === "completion_fill" && progress === 100) {
    return "completion_fill";
  }

  return "initial";
}

function buildProgressMapJson(
  versionId: string,
  layout: Extract<NormalizeLayoutResult, { ok: true }>,
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

function normalizeClientProgressMap(
  rawProgressMap: string,
  versionId: string,
  bmsAnalysis: BmsAnalysis | null
): ProgressMapResult {
  const parsed = parseProgressMap(rawProgressMap);
  if (!parsed.ok) {
    return parsed;
  }

  const layout = normalizeLayout(parsed.value, bmsAnalysis);
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

function buildFallbackLayoutFromBmsAnalysis(bmsAnalysis: BmsAnalysis | null): Extract<NormalizeLayoutResult, { ok: true }> {
  if (!bmsAnalysis || bmsAnalysis.playNotes <= 0) {
    return {
      ok: true,
      firstMeasure: null,
      lastMeasure: null,
      targetBlockCount: 0,
      blocks: []
    };
  }

  const blocks = bmsAnalysis.measureNotesJson.measures.map((measure, index) => ({
    index,
    startMeasure: measure.measure,
    endMeasure: measure.measure,
    startTimeSec: null,
    endTimeSec: null,
    playNotes: measure.playNotes
  }));

  return {
    ok: true,
    firstMeasure: bmsAnalysis.firstNoteMeasure,
    lastMeasure: bmsAnalysis.lastNoteMeasure,
    targetBlockCount: blocks.length,
    blocks
  };
}

function buildRejectedProgressMap(
  rawProgressMap: string,
  versionId: string,
  bmsAnalysis: BmsAnalysis | null
): ProgressMapResult {
  let layout: Extract<NormalizeLayoutResult, { ok: true }> | null = null;

  if (rawProgressMap.trim()) {
    const parsed = parseProgressMap(rawProgressMap);
    if (parsed.ok) {
      const normalizedLayout = normalizeLayout(parsed.value, bmsAnalysis);
      if (normalizedLayout.ok) {
        layout = normalizedLayout;
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
  if (params.isRejected) {
    return buildRejectedProgressMap(params.rawProgressMap, params.versionId, params.bmsAnalysis);
  }

  if (!params.rawProgressMap.trim()) {
    return {
      ok: true,
      progress: params.fallbackProgress,
      progressMap: null,
      progressMapJson: null
    };
  }

  return normalizeClientProgressMap(params.rawProgressMap, params.versionId, params.bmsAnalysis);
}
