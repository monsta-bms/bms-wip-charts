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

const metadataKeys = new Map<string, keyof BmsMetadata>([
  ["TITLE", "title"],
  ["SUBTITLE", "subtitle"],
  ["ARTIST", "artist"],
  ["SUBARTIST", "subartist"],
  ["PLAYLEVEL", "level"]
]);

const playNoteChannelRanges = [
  [11, 19],
  [21, 29],
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

function isPlayNoteChannel(channel: string): boolean {
  if (!/^\d{2}$/.test(channel)) {
    return false;
  }

  const numericChannel = Number(channel);
  return playNoteChannelRanges.some(([min, max]) => numericChannel >= min && numericChannel <= max);
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

export function analyzeBmsText(text: string): BmsAnalysis {
  const warnings: BmsAnalysisWarning[] = [];
  const measureCounts = new Map<number, number>();
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

    // MVPではLNOBJ/LNTYPEの厳密な始点終点判定は行わず、配置オブジェクトを開始ノートとして数える。
    let lineNotes = 0;
    for (let index = 0; index + 1 < data.length; index += 2) {
      const objectId = data.slice(index, index + 2);
      if (objectId.toUpperCase() !== "00") {
        lineNotes += 1;
      }
    }

    if (lineNotes === 0) {
      continue;
    }

    const measure = Number(measureText);
    measureCounts.set(measure, (measureCounts.get(measure) ?? 0) + lineNotes);
    playNotes += lineNotes;
  }

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
