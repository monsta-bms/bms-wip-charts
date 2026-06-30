export type BmsMetadata = {
  title?: string;
  subtitle?: string;
  artist?: string;
  subartist?: string;
  level?: string;
  encoding?: string;
};

const metadataKeys = new Map<string, keyof BmsMetadata>([
  ["TITLE", "title"],
  ["SUBTITLE", "subtitle"],
  ["ARTIST", "artist"],
  ["SUBARTIST", "subartist"],
  ["PLAYLEVEL", "level"]
]);

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

export function parseBmsMetadata(buffer: ArrayBuffer): BmsMetadata {
  const bytes = new Uint8Array(buffer);
  const candidates = ["utf-8", "shift_jis"]
    .map((encoding) => {
      const text = decodeBytes(bytes, encoding);
      if (text === null) {
        return null;
      }

      const metadata = parseMetadataText(text, encoding);
      return {
        metadata,
        score: scoreMetadata(metadata, text)
      };
    })
    .filter((candidate): candidate is { metadata: BmsMetadata; score: number } => candidate !== null);

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.metadata ?? {};
}
