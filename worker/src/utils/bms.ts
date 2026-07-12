export type BmsMetadata = {
  title?: string;
  subtitle?: string;
  artist?: string;
  subartist?: string;
  level?: string;
  encoding?: string;
};

export type BmsAnalysisWarning = {
  code: "BMS_ANALYSIS_FAILED" | "BMS_NO_PLAY_NOTES" | "BMS_UNSUPPORTED_CHANNEL_PATTERN";
  message: string;
  detail?: string;
};

export type BmsMeasureNote = {
  measure: number;
  playNotes: number;
};

export type BmsMeasureNotesJson = {
  schemaVersion: 2;
  firstPlayableMeasure: number | null;
  lastPlayableMeasure: number | null;
  displayFirstMeasure: number | null;
  displayLastMeasure: number | null;
  targetMeasureCount: number;
  playNotes: number;
  lnPolicy: "count_start_only";
  measures: BmsMeasureNote[];
};

export type BmsStandardBlock = {
  index: number;
  startMeasure: number;
  endMeasure: number;
  startTimeSec: number | null;
  endTimeSec: number | null;
  playNotes: number;
};

export type BmsAnalysis = {
  encoding: string | null;
  playNotes: number;
  firstNoteMeasure: number | null;
  lastNoteMeasure: number | null;
  displayFirstMeasure: number | null;
  displayLastMeasure: number | null;
  targetMeasureCount: number;
  measureNotesJson: BmsMeasureNotesJson;
  standardBlocks: BmsStandardBlock[];
  warnings: BmsAnalysisWarning[];
};

type LongNoteEvent = {
  measure: number;
  channel: string;
  pairIndex: number;
  pairCount: number;
};

type StandardPlayEvent = {
  measure: number;
  channel: string;
  fraction: number;
  standardPosition: number;
  timeSec?: number;
};

type StandardLongNoteEvent = StandardPlayEvent & {
  pairIndex: number;
  pairCount: number;
};

type TimingEvent = {
  kind: "bpm" | "stop";
  measure: number;
  fraction: number;
  value: number;
};

const metadataKeys = new Map<string, keyof BmsMetadata>([
  ["TITLE", "title"],
  ["SUBTITLE", "subtitle"],
  ["ARTIST", "artist"],
  ["SUBARTIST", "subartist"],
  ["PLAYLEVEL", "level"]
]);

const normalPlayNoteChannelRanges = [
  [11, 19],
  [21, 29]
] as const;

const longNoteChannelRanges = [
  [51, 59],
  [61, 69]
] as const;

const timeProgressChannels = new Set(["01", "02", "03", "08", "09"]);
const MAX_STANDARD_BLOCKS = 5000;

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function decodeBytes(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function parseMetadataText(text: string, encoding: string): BmsMetadata {
  const metadata: BmsMetadata = { encoding };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    const match = line.match(/^#([A-Z0-9]+)\s+(.+)$/i);
    if (!match) {
      continue;
    }

    const metadataKey = metadataKeys.get(match[1].toUpperCase());
    if (!metadataKey || metadata[metadataKey]) {
      continue;
    }

    metadata[metadataKey] = match[2].trim();
  }

  return metadata;
}

function scoreMetadata(metadata: BmsMetadata, text: string): number {
  const fieldValues = [
    metadata.title,
    metadata.subtitle,
    metadata.artist,
    metadata.subartist,
    metadata.level
  ].filter((value): value is string => Boolean(value));

  const replacementPenalty = (text.match(/\uFFFD/g) ?? []).length * 20;
  return fieldValues.length * 100 + fieldValues.join("").length - replacementPenalty;
}

function decodeCandidates(bytes: Uint8Array): Array<{ encoding: string; text: string; metadata: BmsMetadata; score: number }> {
  return ["utf-8", "shift_jis"]
    .map((encoding) => {
      const text = decodeBytes(bytes, encoding);
      if (text === null) {
        return null;
      }

      const metadata = parseMetadataText(text, encoding);
      return {
        encoding,
        text,
        metadata,
        score: scoreMetadata(metadata, text)
      };
    })
    .filter((candidate): candidate is { encoding: string; text: string; metadata: BmsMetadata; score: number } => candidate !== null)
    .sort((a, b) => b.score - a.score);
}

export function decodeBmsText(buffer: ArrayBuffer): { text: string; encoding: string } {
  const candidates = decodeCandidates(new Uint8Array(buffer));
  const selected = candidates[0];
  if (!selected) {
    throw new Error("Failed to decode BMS text as UTF-8 or Shift_JIS.");
  }

  return {
    text: selected.text,
    encoding: selected.encoding
  };
}

export function parseBmsMetadata(buffer: ArrayBuffer): BmsMetadata {
  return decodeCandidates(new Uint8Array(buffer))[0]?.metadata ?? {};
}

function isInRanges(channel: string, ranges: readonly (readonly [number, number])[]): boolean {
  if (!/^\d{2}$/.test(channel)) {
    return false;
  }

  const numericChannel = Number(channel);
  return ranges.some(([min, max]) => numericChannel >= min && numericChannel <= max);
}

function isNormalPlayNoteChannel(channel: string): boolean {
  return isInRanges(channel, normalPlayNoteChannelRanges);
}

function isLongNoteChannel(channel: string): boolean {
  return isInRanges(channel, longNoteChannelRanges);
}

function isPlayNoteChannel(channel: string): boolean {
  return isNormalPlayNoteChannel(channel) || isLongNoteChannel(channel);
}

function hasNonZeroDataObject(data: string): boolean {
  const pairCount = Math.floor(data.trim().length / 2);
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    if (data.slice(pairIndex * 2, pairIndex * 2 + 2).toUpperCase() !== "00") {
      return true;
    }
  }

  return false;
}

function isPositiveNumberText(value: string): boolean {
  const numberValue = Number.parseFloat(value.trim());
  return Number.isFinite(numberValue) && numberValue > 0;
}

function isTimeProgressChannel(channel: string): boolean {
  return timeProgressChannels.has(channel) || isPlayNoteChannel(channel);
}

function hasTimeProgressData(channel: string, data: string): boolean {
  if (channel === "02") {
    return isPositiveNumberText(data);
  }

  return isTimeProgressChannel(channel) && hasNonZeroDataObject(data);
}

function pushWarning(
  warnings: BmsAnalysisWarning[],
  code: BmsAnalysisWarning["code"],
  message: string,
  detail?: string
): void {
  if (warnings.some((warning) => warning.code === code && warning.detail === detail)) {
    return;
  }

  warnings.push({ code, message, detail });
}

function buildMeasureNotesJson(
  playNotes: number,
  firstPlayableMeasure: number | null,
  lastPlayableMeasure: number | null,
  displayFirstMeasure: number | null,
  displayLastMeasure: number | null,
  measures: BmsMeasureNote[]
): BmsMeasureNotesJson {
  return {
    schemaVersion: 2,
    firstPlayableMeasure,
    lastPlayableMeasure,
    displayFirstMeasure,
    displayLastMeasure,
    targetMeasureCount: displayFirstMeasure === null || displayLastMeasure === null
      ? 0
      : displayLastMeasure - displayFirstMeasure + 1,
    playNotes,
    lnPolicy: "count_start_only",
    measures
  };
}

function addMeasureNotes(measureCounts: Map<number, number>, measure: number, count: number): void {
  if (count <= 0) {
    return;
  }

  measureCounts.set(measure, (measureCounts.get(measure) ?? 0) + count);
}

function compareLongNoteEvents(a: LongNoteEvent, b: LongNoteEvent): number {
  const aPosition = a.measure + a.pairIndex / Math.max(a.pairCount, 1);
  const bPosition = b.measure + b.pairIndex / Math.max(b.pairCount, 1);
  return aPosition - bPosition || a.channel.localeCompare(b.channel);
}

function countLongNoteStarts(events: LongNoteEvent[], measureCounts: Map<number, number>): number {
  const activeByChannel = new Map<string, boolean>();
  let starts = 0;

  for (const event of [...events].sort(compareLongNoteEvents)) {
    const isActive = activeByChannel.get(event.channel) ?? false;
    if (!isActive) {
      addMeasureNotes(measureCounts, event.measure, 1);
      starts += 1;
    }

    activeByChannel.set(event.channel, !isActive);
  }

  return starts;
}

export function analyzeBmsText(text: string): BmsAnalysis {
  const warnings: BmsAnalysisWarning[] = [];
  const measureCounts = new Map<number, number>();
  const longNoteEvents: LongNoteEvent[] = [];
  const timeProgressMeasures: number[] = [];
  let playNotes = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    const match = line.match(/^#(\d{3})([0-9A-Za-z]{2}):([0-9A-Za-z.]*)/);
    if (!match) {
      continue;
    }

    const [, measureText, rawChannel, data] = match;
    const channel = rawChannel.toUpperCase();
    if (!/^\d{2}$/.test(channel)) {
      pushWarning(
        warnings,
        "BMS_UNSUPPORTED_CHANNEL_PATTERN",
        "未対応のBMSチャンネル表記があるため、その行はプレイノート数に含めませんでした。",
        `measure=${measureText}; channel=${channel}`
      );
      continue;
    }

    const measure = Number(measureText);
    if (hasTimeProgressData(channel, data)) {
      timeProgressMeasures.push(measure);
    }

    if (!isPlayNoteChannel(channel)) {
      continue;
    }

    const pairCount = Math.floor(data.length / 2);
    let lineNotes = 0;

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const objectId = data.slice(pairIndex * 2, pairIndex * 2 + 2);
      if (objectId.toUpperCase() === "00") {
        continue;
      }

      if (isLongNoteChannel(channel)) {
        longNoteEvents.push({ measure, channel, pairIndex, pairCount });
      } else {
        lineNotes += 1;
      }
    }

    addMeasureNotes(measureCounts, measure, lineNotes);
    playNotes += lineNotes;
  }

  playNotes += countLongNoteStarts(longNoteEvents, measureCounts);

  const noteMeasures = [...measureCounts.keys()].filter((measure) => (measureCounts.get(measure) ?? 0) > 0);
  if (noteMeasures.length === 0) {
    pushWarning(
      warnings,
      "BMS_NO_PLAY_NOTES",
      "プレイノートが見つからなかったため、進捗対象小節は空として保存します。"
    );

    return {
      encoding: null,
      playNotes: 0,
      firstNoteMeasure: null,
      lastNoteMeasure: null,
      displayFirstMeasure: null,
      displayLastMeasure: null,
      targetMeasureCount: 0,
      measureNotesJson: buildMeasureNotesJson(0, null, null, null, null, []),
      standardBlocks: [],
      warnings
    };
  }

  const firstNoteMeasure = Math.min(...noteMeasures);
  const lastNoteMeasure = Math.max(...noteMeasures);
  const displayFirstMeasure = firstNoteMeasure;
  const trailingTimeMeasures = timeProgressMeasures.filter((measure) => measure >= displayFirstMeasure);
  const displayLastMeasure = Math.max(lastNoteMeasure, ...trailingTimeMeasures);
  const measures: BmsMeasureNote[] = [];

  for (let measure = displayFirstMeasure; measure <= displayLastMeasure; measure += 1) {
    measures.push({
      measure,
      playNotes: measureCounts.get(measure) ?? 0
    });
  }

  const measureNotesJson = buildMeasureNotesJson(
    playNotes,
    firstNoteMeasure,
    lastNoteMeasure,
    displayFirstMeasure,
    displayLastMeasure,
    measures
  );

  return {
    encoding: null,
    playNotes,
    firstNoteMeasure,
    lastNoteMeasure,
    displayFirstMeasure,
    displayLastMeasure,
    targetMeasureCount: measureNotesJson.targetMeasureCount,
    measureNotesJson,
    standardBlocks: [],
    warnings
  };
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function splitDataObjects(data: string): Array<{ objectId: string; pairIndex: number; pairCount: number }> {
  const cleanData = data.trim();
  const pairCount = Math.floor(cleanData.length / 2);
  const objects: Array<{ objectId: string; pairIndex: number; pairCount: number }> = [];

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const objectId = cleanData.slice(pairIndex * 2, pairIndex * 2 + 2).toUpperCase();
    if (objectId !== "00") {
      objects.push({ objectId, pairIndex, pairCount });
    }
  }

  return objects;
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

function standardPositionFor(
  event: { measure: number; fraction: number },
  measureStarts: number[],
  measureLengths: Map<number, number>
): number {
  return measureStarts[event.measure] + event.fraction * getMeasureLength(event.measure, measureLengths);
}

function measureForPosition(
  position: number,
  measureStarts: number[],
  measureLengths: Map<number, number>,
  maxMeasure: number
): number {
  for (let measure = 0; measure <= maxMeasure; measure += 1) {
    const start = measureStarts[measure];
    const end = start + getMeasureLength(measure, measureLengths);
    if (position >= start && position < end) {
      return measure;
    }
  }

  return maxMeasure;
}

function compareStandardEvents(a: StandardPlayEvent, b: StandardPlayEvent): number {
  return a.standardPosition - b.standardPosition || a.channel.localeCompare(b.channel);
}

function collectStandardLongNoteStarts(events: StandardLongNoteEvent[]): StandardPlayEvent[] {
  const activeByChannel = new Map<string, boolean>();
  const starts: StandardPlayEvent[] = [];

  for (const event of [...events].sort(compareStandardEvents)) {
    const active = activeByChannel.get(event.channel) ?? false;
    if (!active) {
      starts.push(event);
    }
    activeByChannel.set(event.channel, !active);
  }

  return starts;
}

function timingEventPriority(event: TimingEvent | (StandardPlayEvent & { kind: "note" })): number {
  if (event.kind === "bpm") {
    return 0;
  }
  if (event.kind === "stop") {
    return 1;
  }
  return 2;
}

function applyTimingToStandardEvents(
  playEvents: StandardPlayEvent[],
  timingEvents: TimingEvent[],
  maxMeasure: number,
  measureLengths: Map<number, number>,
  initialBpm: number
): void {
  const eventsByMeasure = new Map<number, Array<TimingEvent | (StandardPlayEvent & { kind: "note"; noteRef: StandardPlayEvent })>>();
  const pushEvent = (measure: number, event: TimingEvent | (StandardPlayEvent & { kind: "note"; noteRef: StandardPlayEvent })) => {
    const events = eventsByMeasure.get(measure) ?? [];
    events.push(event);
    eventsByMeasure.set(measure, events);
  };

  for (const event of timingEvents) {
    pushEvent(event.measure, event);
  }
  for (const event of playEvents) {
    pushEvent(event.measure, { ...event, kind: "note", noteRef: event });
  }

  let currentBpm = Number.isFinite(initialBpm) && initialBpm > 0 ? initialBpm : 130;
  let timeSec = 0;

  for (let measure = 0; measure <= maxMeasure; measure += 1) {
    const measureLength = getMeasureLength(measure, measureLengths);
    const events = (eventsByMeasure.get(measure) ?? [])
      .filter((event) => Number.isFinite(event.fraction))
      .sort((a, b) => a.fraction - b.fraction || timingEventPriority(a) - timingEventPriority(b));
    let lastFraction = 0;

    for (const event of events) {
      const fraction = Math.min(Math.max(event.fraction, 0), 1);
      timeSec += Math.max(0, fraction - lastFraction) * measureLength * 4 * 60 / currentBpm;
      lastFraction = Math.max(lastFraction, fraction);

      if (event.kind === "bpm" && event.value > 0) {
        currentBpm = event.value;
      } else if (event.kind === "stop" && event.value > 0) {
        timeSec += (event.value / 192) * 4 * 60 / currentBpm;
      } else if (event.kind === "note") {
        event.noteRef.timeSec = timeSec;
      }
    }

    timeSec += Math.max(0, 1 - lastFraction) * measureLength * 4 * 60 / currentBpm;
  }
}

function estimateTimeForPosition(position: number, playEvents: StandardPlayEvent[]): number | null {
  const timedEvents = playEvents
    .filter((event) => Number.isFinite(event.standardPosition) && Number.isFinite(event.timeSec))
    .sort(compareStandardEvents);
  if (timedEvents.length === 0) {
    return null;
  }

  const first = timedEvents[0];
  const last = timedEvents[timedEvents.length - 1];
  if (position <= first.standardPosition) {
    return first.timeSec ?? null;
  }
  if (position >= last.standardPosition) {
    return last.timeSec ?? null;
  }

  for (let index = 1; index < timedEvents.length; index += 1) {
    const previous = timedEvents[index - 1];
    const next = timedEvents[index];
    if (position <= next.standardPosition) {
      const span = next.standardPosition - previous.standardPosition;
      if (span <= 0) {
        return next.timeSec ?? null;
      }
      const ratio = (position - previous.standardPosition) / span;
      return Number(previous.timeSec) + (Number(next.timeSec) - Number(previous.timeSec)) * ratio;
    }
  }

  return last.timeSec ?? null;
}

function analyzeStandardBlocks(text: string): BmsStandardBlock[] {
  const bpmDefinitions = new Map<string, number>();
  const stopDefinitions = new Map<string, number>();
  const measureLengths = new Map<number, number>();
  const normalEvents: Array<Omit<StandardPlayEvent, "standardPosition">> = [];
  const longEvents: Array<Omit<StandardLongNoteEvent, "standardPosition">> = [];
  const timingEvents: TimingEvent[] = [];
  const timeProgressMeasures: number[] = [];
  let initialBpm = 130;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    const indexedBpm = line.match(/^#BPM([0-9A-Za-z]{2})\s+([0-9.]+)$/i);
    if (indexedBpm) {
      const value = parsePositiveNumber(indexedBpm[2]);
      if (value !== null) bpmDefinitions.set(indexedBpm[1].toUpperCase(), value);
      continue;
    }
    const baseBpm = line.match(/^#BPM\s+([0-9.]+)$/i);
    if (baseBpm) {
      initialBpm = parsePositiveNumber(baseBpm[1]) ?? initialBpm;
      continue;
    }
    const stop = line.match(/^#STOP([0-9A-Za-z]{2})\s+([0-9.]+)$/i);
    if (stop) {
      const value = parsePositiveNumber(stop[2]);
      if (value !== null) stopDefinitions.set(stop[1].toUpperCase(), value);
      continue;
    }

    const dataMatch = line.match(/^#(\d{3})([0-9A-Za-z]{2}):(.+)$/);
    if (!dataMatch) continue;
    const measure = Number(dataMatch[1]);
    const channel = dataMatch[2].toUpperCase();
    const data = dataMatch[3].trim();
    if (!/^\d{2}$/.test(channel)) continue;
    if (hasTimeProgressData(channel, data)) timeProgressMeasures.push(measure);
    if (channel === "02") {
      const length = parsePositiveNumber(data);
      if (length !== null) measureLengths.set(measure, length);
      continue;
    }

    for (const pair of splitDataObjects(data)) {
      const fraction = pair.pairCount > 0 ? pair.pairIndex / pair.pairCount : 0;
      if (channel === "03") {
        const value = Number.parseInt(pair.objectId, 16);
        if (Number.isFinite(value) && value > 0) timingEvents.push({ kind: "bpm", measure, fraction, value });
      } else if (channel === "08") {
        const value = bpmDefinitions.get(pair.objectId);
        if (value !== undefined) timingEvents.push({ kind: "bpm", measure, fraction, value });
      } else if (channel === "09") {
        const value = stopDefinitions.get(pair.objectId);
        if (value !== undefined) timingEvents.push({ kind: "stop", measure, fraction, value });
      } else if (isLongNoteChannel(channel)) {
        longEvents.push({ measure, channel, fraction, pairIndex: pair.pairIndex, pairCount: pair.pairCount });
      } else if (isNormalPlayNoteChannel(channel)) {
        normalEvents.push({ measure, channel, fraction });
      }
    }
  }

  const provisionalMaxMeasure = Math.max(
    0,
    ...timeProgressMeasures,
    ...normalEvents.map((event) => event.measure),
    ...longEvents.map((event) => event.measure)
  );
  const measureStarts = buildMeasureStarts(provisionalMaxMeasure, measureLengths);
  const preparedNormal = normalEvents.map((event) => ({
    ...event,
    standardPosition: standardPositionFor(event, measureStarts, measureLengths)
  }));
  const preparedLong = longEvents.map((event) => ({
    ...event,
    standardPosition: standardPositionFor(event, measureStarts, measureLengths)
  }));
  const playEvents = [...preparedNormal, ...collectStandardLongNoteStarts(preparedLong)].sort(compareStandardEvents);
  if (playEvents.length === 0) {
    return [];
  }

  const firstPlayableMeasure = Math.min(...playEvents.map((event) => event.measure));
  const lastPlayableMeasure = Math.max(...playEvents.map((event) => event.measure));
  const displayLastMeasure = Math.max(
    lastPlayableMeasure,
    ...timeProgressMeasures.filter((measure) => measure >= firstPlayableMeasure)
  );
  const maxMeasure = Math.max(provisionalMaxMeasure, displayLastMeasure);
  const displayMeasureStarts = buildMeasureStarts(maxMeasure, measureLengths);
  const positionedEvents = playEvents.map((event) => ({
    ...event,
    standardPosition: standardPositionFor(event, displayMeasureStarts, measureLengths)
  })).sort(compareStandardEvents);

  applyTimingToStandardEvents(positionedEvents, timingEvents, maxMeasure, measureLengths, initialBpm);
  const firstPosition = displayMeasureStarts[firstPlayableMeasure];
  const endPosition = displayMeasureStarts[displayLastMeasure] + getMeasureLength(displayLastMeasure, measureLengths);
  for (const event of positionedEvents) {
    if (!Number.isFinite(event.timeSec)) {
      event.timeSec = (event.standardPosition - firstPosition) * 2;
    }
  }

  const blockCount = Math.max(1, Math.ceil(endPosition - firstPosition));
  if (!Number.isSafeInteger(blockCount) || blockCount > MAX_STANDARD_BLOCKS) {
    throw new Error(`BMS standard block count exceeds ${MAX_STANDARD_BLOCKS}.`);
  }
  return Array.from({ length: blockCount }, (_, index) => {
    const startPosition = firstPosition + index;
    const blockEndPosition = Math.min(startPosition + 1, endPosition);
    return {
      index,
      startMeasure: measureForPosition(startPosition, displayMeasureStarts, measureLengths, maxMeasure),
      endMeasure: measureForPosition(blockEndPosition - 0.000001, displayMeasureStarts, measureLengths, maxMeasure),
      startTimeSec: estimateTimeForPosition(startPosition, positionedEvents),
      endTimeSec: estimateTimeForPosition(blockEndPosition, positionedEvents),
      playNotes: positionedEvents.filter((event) => event.standardPosition >= startPosition && event.standardPosition < blockEndPosition).length
    };
  });
}

export function analyzeBmsBuffer(buffer: ArrayBuffer): BmsAnalysis {
  const decoded = decodeBmsText(buffer);
  const analysis = analyzeBmsText(decoded.text);

  return {
    ...analysis,
    encoding: decoded.encoding,
    standardBlocks: analyzeStandardBlocks(decoded.text)
  };
}
