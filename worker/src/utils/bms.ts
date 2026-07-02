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
  schemaVersion: 1;
  firstMeasure: number | null;
  lastMeasure: number | null;
  targetMeasureCount: number;
  playNotes: number;
  lnPolicy: "count_start_only";
  measures: BmsMeasureNote[];
};

export type BmsAnalysis = {
  encoding: string | null;
  playNotes: number;
  firstNoteMeasure: number | null;
  lastNoteMeasure: number | null;
  targetMeasureCount: number;
  measureNotesJson: BmsMeasureNotesJson;
  warnings: BmsAnalysisWarning[];
};

type LongNoteEvent = {
  measure: number;
  channel: string;
  pairIndex: number;
  pairCount: number;
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
  firstMeasure: number | null,
  lastMeasure: number | null,
  measures: BmsMeasureNote[]
): BmsMeasureNotesJson {
  return {
    schemaVersion: 1,
    firstMeasure,
    lastMeasure,
    targetMeasureCount: firstMeasure === null || lastMeasure === null ? 0 : lastMeasure - firstMeasure + 1,
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
  let playNotes = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    const match = line.match(/^#(\d{3})([0-9A-Za-z]{2}):([0-9A-Za-z]*)/);
    if (!match) {
      continue;
    }

    const [, measureText, channel, data] = match;
    if (!/^\d{2}$/.test(channel)) {
      pushWarning(
        warnings,
        "BMS_UNSUPPORTED_CHANNEL_PATTERN",
        "未対応のBMSチャンネル表記があるため、その行はプレイノート数に含めませんでした。",
        `measure=${measureText}; channel=${channel}`
      );
      continue;
    }

    if (!isPlayNoteChannel(channel)) {
      continue;
    }

    const measure = Number(measureText);
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
      targetMeasureCount: 0,
      measureNotesJson: buildMeasureNotesJson(0, null, null, []),
      warnings
    };
  }

  const firstNoteMeasure = Math.min(...noteMeasures);
  const lastNoteMeasure = Math.max(...noteMeasures);
  const measures: BmsMeasureNote[] = [];

  for (let measure = firstNoteMeasure; measure <= lastNoteMeasure; measure += 1) {
    measures.push({
      measure,
      playNotes: measureCounts.get(measure) ?? 0
    });
  }

  const measureNotesJson = buildMeasureNotesJson(playNotes, firstNoteMeasure, lastNoteMeasure, measures);

  return {
    encoding: null,
    playNotes,
    firstNoteMeasure,
    lastNoteMeasure,
    targetMeasureCount: measureNotesJson.targetMeasureCount,
    measureNotesJson,
    warnings
  };
}

export function analyzeBmsBuffer(buffer: ArrayBuffer): BmsAnalysis {
  const decoded = decodeBmsText(buffer);
  const analysis = analyzeBmsText(decoded.text);

  return {
    ...analysis,
    encoding: decoded.encoding
  };
}
