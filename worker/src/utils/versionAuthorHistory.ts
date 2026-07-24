export type VersionAuthorHistoryRow = {
  selected_version_id: string;
  version_id: string;
  parent_version_id: string | null;
  author: string;
  depth: number;
};

const VERSION_AUTHOR_HISTORY_SQL = `
  WITH RECURSIVE selected(version_id) AS (
    SELECT CAST(value AS TEXT)
    FROM json_each(?)
  ),
  ancestry(
    selected_version_id,
    version_id,
    parent_version_id,
    author,
    depth,
    visited
  ) AS (
    SELECT
      selected.version_id,
      versions.id,
      versions.parent_version_id,
      versions.author,
      0,
      '|' || hex(versions.id) || '|'
    FROM selected
    INNER JOIN versions ON versions.id = selected.version_id

    UNION ALL

    SELECT
      ancestry.selected_version_id,
      parent.id,
      parent.parent_version_id,
      parent.author,
      ancestry.depth + 1,
      ancestry.visited || hex(parent.id) || '|'
    FROM ancestry
    INNER JOIN versions AS parent ON parent.id = ancestry.parent_version_id
    WHERE ancestry.depth < 63
      AND instr(ancestry.visited, '|' || hex(parent.id) || '|') = 0
  )
  SELECT
    selected_version_id,
    version_id,
    parent_version_id,
    author,
    depth
  FROM ancestry
  ORDER BY selected_version_id ASC, depth DESC
`;

function uniqueVersionIds(versionIds: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const versionId of versionIds) {
    if (!versionId || seen.has(versionId)) {
      continue;
    }
    seen.add(versionId);
    result.push(versionId);
  }
  return result;
}

export async function selectVersionAuthorHistory(
  database: D1Database,
  versionIds: string[]
): Promise<VersionAuthorHistoryRow[]> {
  const selectedVersionIds = uniqueVersionIds(versionIds);
  if (selectedVersionIds.length === 0) {
    return [];
  }
  const result = await database
    .prepare(VERSION_AUTHOR_HISTORY_SQL)
    .bind(JSON.stringify(selectedVersionIds))
    .all<VersionAuthorHistoryRow>();
  return result.results ?? [];
}

export function buildVersionAuthorHistoryMap(
  versionIds: string[],
  rows: VersionAuthorHistoryRow[]
): Map<string, string[]> {
  const histories = new Map<string, string[]>();
  for (const versionId of uniqueVersionIds(versionIds)) {
    histories.set(versionId, []);
  }

  const sortedRows = [...rows].sort((left, right) => {
    if (left.selected_version_id !== right.selected_version_id) {
      return left.selected_version_id.localeCompare(right.selected_version_id);
    }
    return right.depth - left.depth;
  });
  const seenAuthors = new Map<string, Set<string>>();
  for (const row of sortedRows) {
    const history = histories.get(row.selected_version_id);
    if (!history) {
      continue;
    }
    const author = row.author.trim();
    if (!author) {
      continue;
    }
    const seen = seenAuthors.get(row.selected_version_id) ?? new Set<string>();
    if (seen.has(author)) {
      continue;
    }
    seen.add(author);
    seenAuthors.set(row.selected_version_id, seen);
    history.push(author);
  }
  return histories;
}
