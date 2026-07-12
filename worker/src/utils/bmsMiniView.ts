import type { BmsAnalysis } from "./bms";

export const MINI_VIEW_PAYLOAD_MAX_BYTES = 32 * 1024;
export const MINI_VIEW_RESOLUTION = 2048;

const MINI_VIEW_MAX_EVENTS = 50_000;
const LANE_COUNT = 8;
const BITSET_BYTES = Math.ceil(MINI_VIEW_RESOLUTION / 8);
const CONTROL_FLOW_PATTERN = /^#(?:RANDOM|SETRANDOM|ENDRANDOM|IF|ELSEIF|ELSE|ENDIF|SWITCH|SETSWITCH|CASE|SKIP|DEF|ENDSW)\b/i;
const MINE_CHANNEL_PATTERN = /^[DE][1-9]$/i;
const SECOND_PLAYER_CHANNEL_PATTERN = /^(?:2[1-9]|6[1-9])$/;

const NORMAL_LANES = new Map<string, number>([
  ["16", 0],
  ["11", 1],
  ["12", 2],
  ["13", 3],
  ["14", 4],
  ["15", 5],
  ["18", 6],
  ["19", 7]
]);

const LONG_LANES = new Map<string, number>([
  ["56", 0],
  ["51", 1],
  ["52", 2],
  ["53", 3],
  ["54", 4],
  ["55", 5],
  ["58", 6],
  ["59", 7]
]);

export const MINI_VIEW_LANE_ORDER = [
  "scratch",
  "key1",
  "key2",
  "key3",
  "key4",
  "key5",
  "key6",
  "key7"
] as const;

export type BmsMiniViewWarningCode =
  | "MINIVIEW_UNSUPPORTED_MODE"
  | "MINIVIEW_RANDOM_UNSUPPORTED"
  | "MINIVIEW_LNTYPE2_UNSUPPORTED"
  | "MINIVIEW_MALFORMED_LN"
  | "MINIVIEW_TOO_COMPLEX"
  | "MINIVIEW_GENERATION_FAILED";

export type BmsMiniViewPayload = {
  schemaVersion: 1;
  mode: "7key-sp";
  resolution: number;
  laneOrder: string[];
  startMeasure: number;
  endMeasure: number;
  noteCount: number;
  tapCount: number;
  longNoteCount: number;
  tapBits: string[];
  longActiveBits: string[];
  longStartBits: string[];
  longEndBits: string[];
  measureBits: string;
  measurePositions?: number[];
};

export type StoredBmsMiniView = {
  schemaVersion: 1;
  status: "ready" | "unsupported";
  mode: "7key-sp" | null;
  reasonCode?: BmsMiniViewWarningCode;
  payload?: BmsMiniViewPayload;
};

export type BmsMiniViewAnalysisResult = {
  miniView: StoredBmsMiniView;
  warning: {
    code: BmsMiniViewWarningCode;
    message: string;
    detail?: string;
  } | null;
};

type RawLaneEvent = {
  lane: number;
  measure: number;
  fraction: number;
  objectId: string;
  position?: number;
};

type LongInterval = {
  lane: number;
  start: number;
  end: number;
};

function unsupported(code: BmsMiniViewWarningCode, message: string, detail?: string): BmsMiniViewAnalysisResult {
  return {
    miniView: {
      schemaVersion: 1,
      status: "unsupported",
      mode: null,
      reasonCode: code
    },
    warning: { code, message, detail }
  };
}

function hasNonZeroObject(data: string): boolean {
  const pairCount = Math.floor(data.length / 2);
  for (let index = 0; index < pairCount; index += 1) {
    if (data.slice(index * 2, index * 2 + 2).toUpperCase() !== "00") {
      return true;
    }
  }
  return false;
}

function splitObjects(data: string): Array<{ objectId: string; fraction: number }> | null {
  const normalized = data.trim();
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9A-Za-z]+$/.test(normalized)) {
    return null;
  }

  const pairCount = normalized.length / 2;
  const result: Array<{ objectId: string; fraction: number }> = [];
  for (let index = 0; index < pairCount; index += 1) {
    const objectId = normalized.slice(index * 2, index * 2 + 2).toUpperCase();
    if (objectId !== "00") {
      result.push({ objectId, fraction: index / pairCount });
    }
  }
  return result;
}

function getExtension(fileName: string): string {
  const baseName = String(fileName || "").split(/[\\/]/).pop() ?? "";
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex >= 0 ? baseName.slice(dotIndex).toLowerCase() : "";
}

function getMeasureLength(measure: number, measureLengths: Map<number, number>): number {
  const value = measureLengths.get(measure);
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 1;
}

function buildMeasureStarts(maxMeasure: number, measureLengths: Map<number, number>): number[] {
  const starts: number[] = [];
  let position = 0;
  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    starts[measure] = position;
    position += getMeasureLength(measure, measureLengths);
  }
  return starts;
}

function compareEvents(a: RawLaneEvent, b: RawLaneEvent): number {
  return Number(a.position) - Number(b.position) || a.lane - b.lane || a.objectId.localeCompare(b.objectId);
}

function setBit(bits: Uint8Array, index: number): void {
  if (index < 0 || index >= MINI_VIEW_RESOLUTION) {
    return;
  }
  bits[index >> 3] |= 1 << (index & 7);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function quantizePosition(position: number, start: number, end: number): number {
  const ratio = end > start ? (position - start) / (end - start) : 0;
  return Math.max(0, Math.min(MINI_VIEW_RESOLUTION - 1, Math.round(ratio * (MINI_VIEW_RESOLUTION - 1))));
}

function buildPayload(
  taps: RawLaneEvent[],
  longNotes: LongInterval[],
  measureStarts: number[],
  analysis: BmsAnalysis
): BmsMiniViewPayload | null {
  const startMeasure = analysis.displayFirstMeasure;
  const endMeasure = analysis.displayLastMeasure;
  if (startMeasure === null || endMeasure === null || endMeasure < startMeasure) {
    return null;
  }

  const startPosition = measureStarts[startMeasure];
  const endPosition = measureStarts[endMeasure + 1];
  if (!Number.isFinite(startPosition) || !Number.isFinite(endPosition) || endPosition <= startPosition) {
    return null;
  }

  const tapBits = Array.from({ length: LANE_COUNT }, () => new Uint8Array(BITSET_BYTES));
  const longActiveBits = Array.from({ length: LANE_COUNT }, () => new Uint8Array(BITSET_BYTES));
  const longStartBits = Array.from({ length: LANE_COUNT }, () => new Uint8Array(BITSET_BYTES));
  const longEndBits = Array.from({ length: LANE_COUNT }, () => new Uint8Array(BITSET_BYTES));
  const activeDiffs = Array.from({ length: LANE_COUNT }, () => new Int32Array(MINI_VIEW_RESOLUTION + 1));
  const measureBits = new Uint8Array(BITSET_BYTES);

  for (const tap of taps) {
    setBit(tapBits[tap.lane], quantizePosition(Number(tap.position), startPosition, endPosition));
  }

  for (const longNote of longNotes) {
    const startIndex = quantizePosition(longNote.start, startPosition, endPosition);
    const endIndex = Math.max(startIndex, quantizePosition(longNote.end, startPosition, endPosition));
    setBit(longStartBits[longNote.lane], startIndex);
    setBit(longEndBits[longNote.lane], endIndex);
    activeDiffs[longNote.lane][startIndex] += 1;
    if (endIndex + 1 < activeDiffs[longNote.lane].length) {
      activeDiffs[longNote.lane][endIndex + 1] -= 1;
    }
  }

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    let active = 0;
    for (let index = 0; index < MINI_VIEW_RESOLUTION; index += 1) {
      active += activeDiffs[lane][index];
      if (active > 0) {
        setBit(longActiveBits[lane], index);
      }
    }
  }

  const measurePositions: number[] = [];
  for (let measure = startMeasure; measure <= endMeasure + 1; measure += 1) {
    const position = measureStarts[measure];
    if (Number.isFinite(position)) {
      const quantizedPosition = quantizePosition(position, startPosition, endPosition);
      measurePositions.push(quantizedPosition);
      setBit(measureBits, quantizedPosition);
    }
  }

  return {
    schemaVersion: 1,
    mode: "7key-sp",
    resolution: MINI_VIEW_RESOLUTION,
    laneOrder: [...MINI_VIEW_LANE_ORDER],
    startMeasure,
    endMeasure,
    noteCount: taps.length + longNotes.length,
    tapCount: taps.length,
    longNoteCount: longNotes.length,
    tapBits: tapBits.map(bytesToBase64),
    longActiveBits: longActiveBits.map(bytesToBase64),
    longStartBits: longStartBits.map(bytesToBase64),
    longEndBits: longEndBits.map(bytesToBase64),
    measureBits: bytesToBase64(measureBits),
    measurePositions
  };
}

export function analyzeBmsMiniView(
  text: string,
  sourceFileName: string,
  analysis: BmsAnalysis
): BmsMiniViewAnalysisResult {
  try {
    const lines = text.split(/\r?\n/);
    if (lines.some((rawLine) => CONTROL_FLOW_PATTERN.test(rawLine.replace(/^\uFEFF/, "").trim()))) {
      return unsupported("MINIVIEW_RANDOM_UNSUPPORTED", "Chart miniview does not support BMS control-flow directives.");
    }

    const normalEvents: RawLaneEvent[] = [];
    const longEvents: RawLaneEvent[] = [];
    const measureLengths = new Map<number, number>();
    const lnObjects = new Set<string>();
    const seenPlayableLines = new Set<string>();
    let usesExtendedKeys = false;
    let player = 1;

    for (const rawLine of lines) {
      const line = rawLine.replace(/^\uFEFF/, "").trim();
      const playerMatch = line.match(/^#PLAYER\s+(\d+)$/i);
      if (playerMatch) {
        player = Number(playerMatch[1]);
        if (player !== 1) {
          return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview supports 7key single play only.");
        }
        continue;
      }
      const lnTypeMatch = line.match(/^#LNTYPE\s+(\d+)$/i);
      if (lnTypeMatch) {
        if (Number(lnTypeMatch[1]) === 2) {
          return unsupported("MINIVIEW_LNTYPE2_UNSUPPORTED", "Chart miniview does not support LNTYPE 2.");
        }
        if (Number(lnTypeMatch[1]) !== 1) {
          return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview found an unsupported LNTYPE value.");
        }
        continue;
      }
      const lnObjectMatch = line.match(/^#LNOBJ\s+([0-9A-Za-z]{2})$/i);
      if (lnObjectMatch) {
        const value = lnObjectMatch[1].toUpperCase();
        if (value !== "00") {
          lnObjects.add(value);
        }
        continue;
      }

      const dataMatch = line.match(/^#(\d{3})([0-9A-Za-z]{2}):(.+)$/);
      if (!dataMatch) {
        continue;
      }

      const measure = Number(dataMatch[1]);
      const channel = dataMatch[2].toUpperCase();
      const data = dataMatch[3].trim();
      if (channel === "02") {
        const length = Number.parseFloat(data);
        if (Number.isFinite(length) && length > 0) {
          measureLengths.set(measure, length);
        }
        continue;
      }
      if (!hasNonZeroObject(data)) {
        continue;
      }
      if (MINE_CHANNEL_PATTERN.test(channel)) {
        return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview does not support mine channels.", `channel=${channel}`);
      }
      if (SECOND_PLAYER_CHANNEL_PATTERN.test(channel)) {
        return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview supports 7key single play only.");
      }
      if (["17", "27", "57", "67"].includes(channel)) {
        return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview found a special playable channel.", `channel=${channel}`);
      }

      const lane = NORMAL_LANES.get(channel) ?? LONG_LANES.get(channel);
      if (lane === undefined) {
        continue;
      }

      const lineKey = `${measure}:${channel}`;
      if (seenPlayableLines.has(lineKey)) {
        return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview does not support duplicated playable channel lines.", lineKey);
      }
      seenPlayableLines.add(lineKey);

      const objects = splitObjects(data);
      if (!objects) {
        return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview found malformed playable channel data.", lineKey);
      }
      for (const object of objects) {
        const event = { lane, measure, fraction: object.fraction, objectId: object.objectId };
        if (NORMAL_LANES.has(channel)) {
          normalEvents.push(event);
        } else {
          longEvents.push(event);
        }
        if (["18", "19", "58", "59"].includes(channel)) {
          usesExtendedKeys = true;
        }
      }
      if (normalEvents.length + longEvents.length > MINI_VIEW_MAX_EVENTS) {
        return unsupported("MINIVIEW_TOO_COMPLEX", "Chart miniview event count exceeds the safe limit.");
      }
    }

    const extension = getExtension(sourceFileName);
    if (extension === ".pms" || (extension !== ".bme" && !usesExtendedKeys)) {
      return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart key mode cannot be identified safely as 7key single play.");
    }
    if (analysis.displayFirstMeasure === null || analysis.displayLastMeasure === null) {
      return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview requires playable notes.");
    }

    const maxMeasure = Math.max(
      analysis.displayLastMeasure,
      ...normalEvents.map((event) => event.measure),
      ...longEvents.map((event) => event.measure)
    );
    const measureStarts = buildMeasureStarts(maxMeasure, measureLengths);
    const positionEvent = (event: RawLaneEvent): RawLaneEvent => ({
      ...event,
      position: measureStarts[event.measure] + event.fraction * getMeasureLength(event.measure, measureLengths)
    });
    const positionedNormal = normalEvents.map(positionEvent).sort(compareEvents);
    const positionedLong = longEvents.map(positionEvent).sort(compareEvents);
    const taps: RawLaneEvent[] = [];
    const longNotes: LongInterval[] = [];

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const laneNormal = positionedNormal.filter((event) => event.lane === lane);
      const consumed = new Set<RawLaneEvent>();
      let previous: RawLaneEvent | null = null;
      for (const event of laneNormal) {
        if (lnObjects.has(event.objectId)) {
          if (!previous || Number(previous.position) >= Number(event.position)) {
            return unsupported("MINIVIEW_MALFORMED_LN", "LNOBJ has no valid preceding note.", `lane=${lane}`);
          }
          consumed.add(previous);
          consumed.add(event);
          longNotes.push({ lane, start: Number(previous.position), end: Number(event.position) });
          previous = null;
        } else {
          previous = event;
        }
      }
      taps.push(...laneNormal.filter((event) => !consumed.has(event) && !lnObjects.has(event.objectId)));

      const laneLong = positionedLong.filter((event) => event.lane === lane);
      if (laneLong.length % 2 !== 0) {
        return unsupported("MINIVIEW_MALFORMED_LN", "Long-note channel has an unclosed interval.", `lane=${lane}`);
      }
      for (let index = 0; index < laneLong.length; index += 2) {
        const start = Number(laneLong[index].position);
        const end = Number(laneLong[index + 1].position);
        if (!(end > start)) {
          return unsupported("MINIVIEW_MALFORMED_LN", "Long-note interval has an invalid endpoint.", `lane=${lane}`);
        }
        longNotes.push({ lane, start, end });
      }
    }

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const laneIntervals = longNotes.filter((item) => item.lane === lane).sort((a, b) => a.start - b.start || a.end - b.end);
      for (let index = 1; index < laneIntervals.length; index += 1) {
        if (laneIntervals[index].start <= laneIntervals[index - 1].end) {
          return unsupported("MINIVIEW_MALFORMED_LN", "Long-note intervals overlap.", `lane=${lane}`);
        }
      }
      const laneTaps = taps.filter((event) => event.lane === lane).sort(compareEvents);
      for (let index = 1; index < laneTaps.length; index += 1) {
        if (Number(laneTaps[index].position) === Number(laneTaps[index - 1].position)) {
          return unsupported("MINIVIEW_GENERATION_FAILED", "Duplicate notes share the same lane position.", `lane=${lane}`);
        }
      }
      if (laneTaps.some((tap) => laneIntervals.some((interval) => Number(tap.position) >= interval.start && Number(tap.position) <= interval.end))) {
        return unsupported("MINIVIEW_MALFORMED_LN", "A normal note overlaps a long-note interval.", `lane=${lane}`);
      }
    }

    const payload = buildPayload(taps, longNotes, measureStarts, analysis);
    if (!payload) {
      return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview could not build a display range.");
    }
    const miniView: StoredBmsMiniView = {
      schemaVersion: 1,
      status: "ready",
      mode: "7key-sp",
      payload
    };
    const byteLength = new TextEncoder().encode(JSON.stringify(miniView)).byteLength;
    if (byteLength > MINI_VIEW_PAYLOAD_MAX_BYTES) {
      return unsupported("MINIVIEW_TOO_COMPLEX", "Chart miniview payload exceeds 32 KiB.", `bytes=${byteLength}`);
    }

    return { miniView, warning: null };
  } catch (error) {
    return unsupported(
      "MINIVIEW_GENERATION_FAILED",
      "Chart miniview generation failed.",
      error instanceof Error ? error.message : String(error)
    );
  }
}
