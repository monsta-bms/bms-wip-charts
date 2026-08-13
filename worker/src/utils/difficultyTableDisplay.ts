export type DifficultyTableDisplayTitleInput = {
  title: string | null | undefined;
  subtitle: string | null | undefined;
  chartName: string | null | undefined;
};

export type DifficultyTableDisplayArtistInput = {
  artist: string | null | undefined;
  subartist: string | null | undefined;
};

export type DifficultyTableDisplayArtistResult = {
  displayArtist: string;
  markerAuthors: string[];
};

export type DifficultyTableViewModelInput = {
  versionId: string;
  md5: string;
  level: string;
  levelLabel: string;
  originalDifficulty: string;
  storedTitle: string;
  storedSubtitle: string;
  storedArtist: string;
  storedSubartist: string;
  sourceMetadataStatus: string | null;
  sourceTitle: string | null;
  sourceSubtitle: string | null;
  sourceArtist: string | null;
  sourceSubartist: string | null;
  chartName: string;
  versionLabel: string;
  chainAuthors: string[];
  postComment: string | null;
  originUrl: string | null;
  downloadUrl: string;
  completedAt: string | null;
  versionUpdatedAt: string | null;
  sourceMetadataUpdatedAt: string | null;
};

export type DifficultyTableViewModel = {
  versionId: string;
  md5: string;
  level: string;
  levelLabel: string;
  originalDifficulty: string;
  storedTitle: string;
  storedArtist: string;
  displayTitle: string;
  displayArtist: string;
  sourceTitle: string | null;
  sourceSubtitle: string | null;
  sourceArtist: string | null;
  sourceSubartist: string | null;
  chartName: string;
  versionLabel: string;
  authors: string[];
  authorsText: string;
  postComment: string;
  comment: string;
  originUrl: string | null;
  downloadUrl: string;
  completedAt: string | null;
  updatedAt: string | null;
};

const MARKER_PATTERN = /(^|[\s/・,，])(?:obj(?:\s*[:：.．;；@]\s*|\s+)|(?:notes?|chart(?:er)?)(?:\s*[:：;；]\s*))/giu;
const MARKER_SEPARATOR_PATTERN = /^[\s/・,，]+|[\s/・,，]+$/gu;

export function normalizeDifficultyTableDisplayText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/gu, " ");
}

function comparisonKey(value: string, foldAsciiCase = false): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return foldAsciiCase ? normalized.replace(/[A-Z]/g, (character) => character.toLowerCase()) : normalized;
}

function unwrapToken(value: string): string | null {
  const patterns = [
    /^\[([^\[\]]+)\]$/u,
    /^\(([^()]+)\)$/u,
    /^--(.+)--$/u,
    /^-([^-].*)-$/u,
    /^ー(.+)ー$/u
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const inner = match?.[1]?.trim();
    if (inner) {
      return inner;
    }
  }
  return null;
}

function terminalToken(value: string): string | null {
  const patterns = [
    /\[([^\[\]]+)\]$/u,
    /\(([^()]+)\)$/u,
    /--(.+)--$/u,
    /-([^-].*)-$/u,
    /ー(.+)ー$/u
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const inner = match?.[1]?.trim();
    if (inner) {
      return inner;
    }
  }
  return null;
}

function hasEquivalentTerminalChartToken(value: string, chartName: string): boolean {
  const comparableValue = comparisonKey(value, true);
  const comparableChartName = comparisonKey(chartName, true);
  const chartToken = unwrapToken(comparableChartName) ?? comparableChartName;
  const trailingToken = terminalToken(comparableValue);
  return Boolean(chartToken && trailingToken && comparisonKey(trailingToken, true) === comparisonKey(chartToken, true));
}

export function buildDifficultyTableDisplayTitle(input: DifficultyTableDisplayTitleInput): string {
  const title = normalizeDifficultyTableDisplayText(input.title);
  const subtitle = normalizeDifficultyTableDisplayText(input.subtitle);
  const chartName = normalizeDifficultyTableDisplayText(input.chartName);
  const parts: string[] = [];

  if (title) {
    parts.push(title);
  }
  if (subtitle && (!title || comparisonKey(subtitle) !== comparisonKey(title))) {
    parts.push(subtitle);
  }
  if (
    chartName
    && !parts.some((part) => hasEquivalentTerminalChartToken(part, chartName))
  ) {
    parts.push(chartName);
  }

  return parts.join(" ");
}

function appendUnique(values: string[], candidates: string[]): void {
  const seen = new Set(values);
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
}

function splitArtistMarkers(rawValue: string | null | undefined): {
  displayValue: string;
  markerAuthors: string[];
} {
  const value = normalizeDifficultyTableDisplayText(rawValue);
  const matches = [...value.matchAll(MARKER_PATTERN)];
  if (matches.length === 0) {
    return { displayValue: value, markerAuthors: [] };
  }

  const displayValue = value
    .slice(0, matches[0].index ?? 0)
    .replace(MARKER_SEPARATOR_PATTERN, "")
    .trim();
  const markerAuthors: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const authorStart = (match.index ?? 0) + match[0].length;
    const authorEnd = matches[index + 1]?.index ?? value.length;
    const author = value
      .slice(authorStart, authorEnd)
      .replace(MARKER_SEPARATOR_PATTERN, "")
      .trim();
    appendUnique(markerAuthors, [author]);
  }

  return { displayValue, markerAuthors };
}

export function buildDifficultyTableDisplayArtist(
  input: DifficultyTableDisplayArtistInput
): DifficultyTableDisplayArtistResult {
  const artist = splitArtistMarkers(input.artist);
  const subartist = splitArtistMarkers(input.subartist);
  const displayParts: string[] = [];
  if (artist.displayValue) {
    displayParts.push(artist.displayValue);
  }
  if (
    subartist.displayValue
    && !displayParts.some((value) => comparisonKey(value) === comparisonKey(subartist.displayValue))
  ) {
    displayParts.push(subartist.displayValue);
  }

  const markerAuthors: string[] = [];
  appendUnique(markerAuthors, artist.markerAuthors);
  appendUnique(markerAuthors, subartist.markerAuthors);
  return {
    displayArtist: displayParts.join(" / "),
    markerAuthors
  };
}

export function buildDifficultyTableAuthors(chainAuthors: string[]): string[] {
  const authors: string[] = [];
  appendUnique(authors, chainAuthors);
  return authors;
}

export function buildDifficultyTableComment(
  originalDifficulty: string,
  postComment: string | null | undefined
): string {
  const comment = normalizeDifficultyTablePostComment(postComment);
  return comment
    ? `元難易度：${originalDifficulty}\n${comment}`
    : `元難易度：${originalDifficulty}`;
}

export function normalizeDifficultyTablePostComment(
  postComment: string | null | undefined
): string {
  return (postComment ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n+$/u, "");
}

function nonEmptySourceValue(value: string | null | undefined): string | null {
  return value && value.trim() ? value : null;
}

function effectiveDisplayValue(
  sourceMetadataSucceeded: boolean,
  sourceValue: string | null,
  storedValue: string
): string {
  return sourceMetadataSucceeded && nonEmptySourceValue(sourceValue) !== null
    ? sourceValue ?? ""
    : storedValue;
}

function timestampValue(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function latestDifficultyTableTimestamp(
  first: string | null,
  second: string | null
): string | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  const firstTimestamp = timestampValue(first);
  const secondTimestamp = timestampValue(second);
  if (firstTimestamp !== null && secondTimestamp !== null) {
    return secondTimestamp > firstTimestamp ? second : first;
  }
  return second > first ? second : first;
}

export function buildDifficultyTableViewModel(
  input: DifficultyTableViewModelInput
): DifficultyTableViewModel {
  const sourceMetadataSucceeded = input.sourceMetadataStatus === "succeeded";
  const sourceTitle = sourceMetadataSucceeded ? nonEmptySourceValue(input.sourceTitle) : null;
  const sourceSubtitle = sourceMetadataSucceeded ? nonEmptySourceValue(input.sourceSubtitle) : null;
  const sourceArtist = sourceMetadataSucceeded ? nonEmptySourceValue(input.sourceArtist) : null;
  const sourceSubartist = sourceMetadataSucceeded ? nonEmptySourceValue(input.sourceSubartist) : null;
  const displayTitle = buildDifficultyTableDisplayTitle({
    title: effectiveDisplayValue(sourceMetadataSucceeded, sourceTitle, input.storedTitle),
    subtitle: effectiveDisplayValue(sourceMetadataSucceeded, sourceSubtitle, input.storedSubtitle),
    chartName: input.chartName
  });
  const artist = buildDifficultyTableDisplayArtist({
    artist: effectiveDisplayValue(sourceMetadataSucceeded, sourceArtist, input.storedArtist),
    subartist: effectiveDisplayValue(sourceMetadataSucceeded, sourceSubartist, input.storedSubartist)
  });
  const authors = buildDifficultyTableAuthors(input.chainAuthors);
  const postComment = normalizeDifficultyTablePostComment(input.postComment);

  return {
    versionId: input.versionId,
    md5: input.md5,
    level: input.level,
    levelLabel: input.levelLabel,
    originalDifficulty: input.originalDifficulty,
    storedTitle: input.storedTitle,
    storedArtist: input.storedArtist,
    displayTitle,
    displayArtist: artist.displayArtist,
    sourceTitle,
    sourceSubtitle,
    sourceArtist,
    sourceSubartist,
    chartName: input.chartName,
    versionLabel: input.versionLabel,
    authors,
    authorsText: authors.join("、"),
    postComment,
    comment: buildDifficultyTableComment(input.originalDifficulty, postComment),
    originUrl: input.originUrl,
    downloadUrl: input.downloadUrl,
    completedAt: input.completedAt,
    updatedAt: latestDifficultyTableTimestamp(input.versionUpdatedAt, input.sourceMetadataUpdatedAt)
  };
}
