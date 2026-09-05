import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import wrangler from "wrangler";

const { createTestHarness, unstable_splitSqlQuery: splitSqlQuery } = wrangler;
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationFiles = [
  "0001_initial.sql",
  "0002_file_delete_and_rejected_rules.sql",
  "0003_progress_graph_fields.sql",
  "0004_origin_url.sql",
  "0005_version_chart_name.sql",
  "0006_append_policy.sql",
  "0007_version_withdrawals.sql",
  "0008_withdrawal_handling.sql",
  "0009_version_source_metadata.sql",
  "0010_security_hash_key_versions.sql",
  "0011_version_comments.sql"
];

let passed = 0;
let sequence = 0;

async function importBundled(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    absWorkingDir: workerRoot,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    logLevel: "silent"
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const [difficultyTables, display, authorHistory] = await Promise.all([
  importBundled("src/routes/difficultyTables.ts"),
  importBundled("src/utils/difficultyTableDisplay.ts"),
  importBundled("src/utils/versionAuthorHistory.ts")
]);

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const harness = createTestHarness({
  root: workerRoot,
  workers: [{
    configPath: "wrangler.toml",
    vars: { ALLOWED_ORIGINS: "http://localhost" },
    secrets: {
      PASSWORD_HASH_SECRET: "isolated-difficulty-table-password",
      ABUSE_HASH_SECRET: "isolated-difficulty-table-abuse",
      WITHDRAWAL_IDEMPOTENCY_SECRET: "isolated-difficulty-table-withdrawal"
    }
  }]
});

let env;

async function applyMigrations() {
  for (const name of migrationFiles) {
    const sql = (await readFile(resolve(workerRoot, "migrations", name), "utf8"))
      .replace(/\r\n/g, "\n")
      .replace(/^\s*--.*$/gm, "")
      .trim();
    for (const statement of splitSqlQuery(sql)) {
      await env.DB.prepare(statement).run();
    }
  }
}

async function createChart({ hidden = false, chartName = "[TEST]" } = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(4, "0");
  const songId = `song_${suffix}`;
  const chartId = `chart_${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO songs (id, title, artist, normalized_title, normalized_artist)
      VALUES (?, ?, ?, ?, ?)
    `).bind(songId, `Song ${suffix}`, `Artist ${suffix}`, `song ${suffix}`, `artist ${suffix}`),
    env.DB.prepare(`
      INSERT INTO charts (id, song_id, chart_name, normalized_chart_name, is_hidden)
      VALUES (?, ?, ?, ?, ?)
    `).bind(chartId, songId, chartName, chartName.normalize("NFKC").toLowerCase(), hidden ? 1 : 0)
  ]);
  return { songId, chartId, chartName };
}

async function insertVersion(options = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(5, "0");
  const chart = options.chart ?? await createChart({
    hidden: options.chartHidden ?? false,
    chartName: options.chartName ?? "[TEST]"
  });
  const id = options.id ?? `version_${suffix}`;
  const parentVersionId = options.parentVersionId ?? null;
  const versionNumber = options.versionNumber ?? (parentVersionId ? 2 : 1);
  const branchPath = options.branchPath ?? (parentVersionId ? `root/${suffix}` : "root");
  const downloadBlocked = options.downloadBlocked ? 1 : 0;
  const fileId = options.fileId ?? `file_${suffix}`;
  await env.DB.prepare(`
    INSERT INTO versions (
      id, chart_id, parent_version_id, version_number, branch_path,
      author, progress, comment, difficulty, level,
      title, subtitle, artist, subartist, md5, origin_url,
      is_rejected, file_id, file_name, file_size, file_sha256, r2_key, password_hash,
      download_blocked, withdrawal_download_blocked, download_block_reason,
      is_hidden, collapsed_by_completion, chart_name,
      created_at, updated_at, completed_at, file_deleted_at, withdrawn_at, delete_requested_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, 'chart.bms', 1, ?, ?, 'hash',
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).bind(
    id,
    chart.chartId,
    parentVersionId,
    versionNumber,
    branchPath,
    options.author ?? "Tester",
    options.progress ?? 100,
    options.comment ?? "",
    options.difficulty === undefined ? "★1" : options.difficulty,
    options.level ?? "1",
    options.title ?? `Stored Title ${suffix}`,
    options.subtitle ?? "",
    options.artist ?? `Stored Artist ${suffix}`,
    options.subartist ?? "",
    options.md5 === undefined ? suffix.padStart(32, "0") : options.md5,
    options.originUrl ?? null,
    options.rejected ? 1 : 0,
    fileId,
    options.fileSha256 ?? `sha_${suffix}`,
    options.r2Key ?? `difficulty/${suffix}.bms`,
    downloadBlocked,
    options.withdrawalDownloadBlocked ? 1 : 0,
    downloadBlocked ? "admin_blocked" : null,
    options.hidden ? 1 : 0,
    options.collapsed ? 1 : 0,
    options.chartName ?? chart.chartName,
    options.createdAt ?? "2026-07-24 10:00:00",
    options.updatedAt ?? "2026-07-24 10:00:00",
    options.completedAt === undefined ? "2026-07-24 10:00:00" : options.completedAt,
    options.fileDeletedAt ?? null,
    options.withdrawnAt ?? null,
    options.deleteRequestedAt ?? null
  ).run();
  return { id, chart, fileId, md5: options.md5 === undefined ? suffix.padStart(32, "0") : options.md5 };
}

async function insertMetadata(versionId, values) {
  await env.DB.prepare(`
    INSERT INTO version_source_metadata (
      version_id, source_title, source_subtitle, source_artist, source_subartist,
      encoding, status, error_code, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    versionId,
    values.sourceTitle ?? null,
    values.sourceSubtitle ?? null,
    values.sourceArtist ?? null,
    values.sourceSubartist ?? null,
    values.encoding ?? null,
    values.status,
    values.errorCode ?? null,
    values.updatedAt ?? "2026-07-24 11:00:00"
  ).run();
}

function instrumentEnvironment(baseEnv) {
  const metrics = {
    d1Queries: 0,
    targetRows: 0,
    ancestryRows: 0,
    r2Get: 0,
    r2Put: 0,
    r2Delete: 0
  };

  function wrapStatement(statement, sql) {
    return {
      bind(...values) {
        return wrapStatement(statement.bind(...values), sql);
      },
      async all() {
        const result = await statement.all();
        const count = result.results?.length ?? 0;
        if (sql.includes("WITH RECURSIVE selected")) {
          metrics.ancestryRows += count;
        } else if (sql.includes("FROM versions")) {
          metrics.targetRows += count;
        }
        return result;
      },
      first(columnName) {
        return columnName === undefined ? statement.first() : statement.first(columnName);
      },
      run() {
        return statement.run();
      },
      raw(options) {
        return statement.raw(options);
      }
    };
  }

  const database = {
    prepare(sql) {
      metrics.d1Queries += 1;
      return wrapStatement(baseEnv.DB.prepare(sql), sql);
    },
    batch(statements) {
      return baseEnv.DB.batch(statements);
    },
    exec(sql) {
      return baseEnv.DB.exec(sql);
    },
    withSession(constraint) {
      return baseEnv.DB.withSession(constraint);
    },
    dump() {
      return baseEnv.DB.dump();
    }
  };
  const files = new Proxy(baseEnv.FILES, {
    get(target, property) {
      if (property === "get") {
        return (...args) => {
          metrics.r2Get += 1;
          return target.get(...args);
        };
      }
      if (property === "put") {
        return (...args) => {
          metrics.r2Put += 1;
          return target.put(...args);
        };
      }
      if (property === "delete") {
        return (...args) => {
          metrics.r2Delete += 1;
          return target.delete(...args);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { env: { ...baseEnv, DB: database, FILES: files }, metrics };
}

async function requestData(tableId, requestEnv = env) {
  const path = `/api/difficulty-tables/${tableId}/data.json`;
  const request = new Request(`http://localhost${path}`);
  const response = await difficultyTables.handleDifficultyTableRoute(request, requestEnv, path);
  assert.equal(response.status, 200);
  return { response, data: await response.json() };
}

async function expectedSelected(tableId) {
  const result = await env.DB.prepare(`
    SELECT versions.id, versions.md5, versions.difficulty
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.progress = 100
      AND (
        versions.completed_at IS NOT NULL
        OR COALESCE(versions.is_rejected, 0) = 1
      )
      AND COALESCE(versions.is_hidden, 0) = 0
      AND COALESCE(charts.is_hidden, 0) = 0
      AND (
        COALESCE(versions.download_blocked, 0) = 0
        OR versions.download_block_reason = 'superseded_by_completed_descendant'
      )
      AND COALESCE(versions.withdrawal_download_blocked, 0) = 0
      AND versions.file_deleted_at IS NULL
      AND versions.withdrawn_at IS NULL
      AND versions.delete_requested_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM version_withdrawals AS difficulty_withdrawals
        WHERE difficulty_withdrawals.version_id = versions.id
          AND difficulty_withdrawals.status IN ('pending', 'processing', 'tombstoned', 'deleted')
      )
      AND (
        COALESCE(versions.collapsed_by_completion, 0) = 0
        OR versions.collapsed_reason = 'superseded_by_completed_descendant'
      )
      AND versions.md5 IS NOT NULL
      AND length(versions.md5) = 32
    ORDER BY datetime(COALESCE(versions.completed_at, versions.created_at)) DESC,
      datetime(versions.created_at) DESC, versions.id DESC
  `).all();
  const seen = new Set();
  const selected = [];
  for (const row of result.results ?? []) {
    const md5 = row.md5.toLowerCase();
    if (!/^[0-9a-f]{32}$/i.test(md5) || seen.has(md5)) continue;
    seen.add(md5);
    const classification = difficultyTables.classifyDifficulty(row.difficulty);
    if (classification?.tableId === tableId) selected.push(md5);
  }
  return selected;
}

function existingSnapshot(item) {
  return {
    md5: item.md5,
    level: item.level,
    title: item.title,
    artist: item.artist,
    ...(item.url ? { url: item.url } : {}),
    url_diff: item.url_diff,
    name_diff: item.name_diff,
    bms_wip_original_difficulty: item.bms_wip_original_difficulty,
    bms_wip_chart_name: item.bms_wip_chart_name,
    bms_wip_version: item.bms_wip_version,
    bms_wip_author: item.bms_wip_author,
    bms_wip_completed_at: item.bms_wip_completed_at,
    bms_wip_subtitle: item.bms_wip_subtitle,
    bms_wip_subartist: item.bms_wip_subartist
  };
}

async function testPureDisplayFunctions() {
  await check("existing RC star and double-star classification remains unchanged", () => {
    const cases = [
      ["★0", "rc-star", "0"], ["★20", "rc-star", "20"],
      ["★21", "rc-double-star", "1"], ["★25", "rc-double-star", "5"],
      ["★★1", "rc-double-star", "1"], ["★★7", "rc-double-star", "7"],
      ["sl0", "rc-star", "0"], ["SL7", "rc-star", "12"], ["sl12", "rc-star", "19"],
      ["st0", "rc-star", "20"], ["st1", "rc-double-star", "1"],
      ["st4", "rc-double-star", "4"], ["st7", "rc-double-star", "5"],
      ["st10", "rc-double-star", "6"], ["st13", "rc-double-star", "7"],
      ["unknown", "rc-star", "他"]
    ];
    for (const [input, tableId, level] of cases) {
      const actual = difficultyTables.classifyDifficulty(input);
      assert.equal(actual.tableId, tableId);
      assert.equal(actual.level, level);
    }
    assert.equal(difficultyTables.classifyDifficulty(null), null);
    assert.equal(difficultyTables.classifyDifficulty("  "), null);
  });

  const titleCases = [
    [{ title: "Song", chartName: "[ANOTHER]" }, "Song [ANOTHER]"],
    [{ title: "Song [ANOTHER]", chartName: "[ANOTHER]" }, "Song [ANOTHER]"],
    [{ title: "Song （Remix）", chartName: "--INSANE--" }, "Song （Remix） --INSANE--"],
    [{ title: "3.14 (TT mix)", chartName: "(yumether)" }, "3.14 (TT mix) (yumether)"],
    [{ title: "Another World", chartName: "ANOTHER" }, "Another World ANOTHER"],
    [{ title: "  Song\n  Name ", chartName: "" }, "Song Name"],
    [{ title: "Song （ＡＮＯＴＨＥＲ）", chartName: "[another]" }, "Song （ＡＮＯＴＨＥＲ）"],
    [{ title: "妹 [地力]", chartName: "[地力]" }, "妹 [地力]"]
  ];
  await check("selected-version title composition, whitespace, NFKC duplicate, and chart-token rules", () => {
    for (const [input, expected] of titleCases) {
      assert.equal(display.buildDifficultyTableDisplayTitle(input), expected);
    }
  });

  const artistCases = [
    [{ artist: "BACO / Sobrem", subartist: "obj:potechang" }, ["BACO / Sobrem", ["potechang"]]],
    [{ artist: "not Project Nirvana / obj:monsta", subartist: "" }, ["not Project Nirvana", ["monsta"]]],
    [{ artist: "Artist", subartist: "Notes:potechang" }, ["Artist", ["potechang"]]],
    [{ artist: "Artist A", subartist: "Artist B" }, ["Artist A / Artist B", []]],
    [{ artist: "Artist A", subartist: "Artist A" }, ["Artist A", []]],
    [{ artist: "obj@", subartist: "" }, ["", []]],
    [{ artist: "objective / chart maker", subartist: "" }, ["objective / chart maker", []]],
    [{ artist: "Original / Authors・OBJ：chart maker", subartist: "charter;helper" }, ["Original / Authors", ["chart maker", "helper"]]]
  ];
  await check("artist composition preserves original artists and extracts bounded markers", () => {
    for (const [input, expected] of artistCases) {
      const actual = display.buildDifficultyTableDisplayArtist(input);
      assert.deepEqual([actual.displayArtist, actual.markerAuthors], expected);
    }
  });

  await check("form author history uses exact duplicate removal without splitting or case folding", () => {
    assert.deepEqual(
      display.buildDifficultyTableAuthors(
        [" monsta ", "monsta", "A & B", "Author", "author", "Ａ"]
      ),
      ["monsta", "A & B", "Author", "author", "Ａ"]
    );
  });

  const comments = [
    ["st7", "", "元難易度：st7"],
    ["sl7", "短文", "元難易度：sl7\n短文"],
    ["★1", "line 1\r\nline 2  \n\n", "元難易度：★1\nline 1\nline 2"],
    ["★2", "<b>tag</b>", "元難易度：★2\n<b>tag</b>"],
    ["★3", "\"quote\"", "元難易度：★3\n\"quote\""],
    ["★4", "絵文字🎵", "元難易度：★4\n絵文字🎵"],
    ["★5", "長文".repeat(500), `元難易度：★5\n${"長文".repeat(500)}`],
    ["5", "same", "元難易度：5\nsame"],
    ["sl12", null, "元難易度：sl12"],
    ["st13", undefined, "元難易度：st13"],
    ["★20", "star", "元難易度：★20\nstar"],
    ["★★7", "double", "元難易度：★★7\ndouble"]
  ];
  await check("comment composition covers empty, multiline, HTML, quotes, emoji, long, sl/st/star inputs", () => {
    for (const [difficulty, comment, expected] of comments) {
      assert.equal(display.buildDifficultyTableComment(difficulty, comment), expected);
    }
  });

  await check("view model keeps the selected-version title while using succeeded source artist fields", () => {
    const model = display.buildDifficultyTableViewModel({
      versionId: "v",
      md5: "0".repeat(32),
      level: "12",
      levelLabel: "RC★12",
      originalDifficulty: "sl7",
      storedTitle: "Stored",
      storedSubtitle: "Stored Sub",
      storedArtist: "Stored Artist",
      storedSubartist: "Stored Subartist",
      sourceMetadataStatus: "succeeded",
      sourceTitle: "Source",
      sourceSubtitle: null,
      sourceArtist: "Source Artist",
      sourceSubartist: "obj:marker",
      chartName: "[Chart]",
      versionLabel: "1-1",
      chainAuthors: ["author"],
      postComment: "comment",
      originUrl: null,
      downloadUrl: "https://example.test/api/files/f",
      completedAt: "2026-07-24 10:00:00",
      versionUpdatedAt: "2026-07-24 10:00:00",
      sourceMetadataUpdatedAt: "2026-07-24 11:00:00"
    });
    assert.equal(model.displayTitle, "Stored [Chart]");
    assert.equal(model.displayArtist, "Source Artist");
    assert.deepEqual(model.authors, ["author"]);
    assert.equal(model.updatedAt, "2026-07-24 11:00:00");
    assert.equal(model.levelLabel, "RC★12");
  });
}

async function seedIntegrationFixtures() {
  const chainChart = await createChart({ chartName: "[Nebula]" });
  const root = await insertVersion({
    id: "chain_root",
    chart: chainChart,
    versionNumber: 1,
    branchPath: "root",
    author: "monsta",
    progress: 50,
    hidden: true,
    completedAt: null,
    md5: null
  });
  const child = await insertVersion({
    id: "chain_child",
    chart: chainChart,
    parentVersionId: root.id,
    versionNumber: 2,
    branchPath: "root/a",
    author: "monsta",
    progress: 50,
    collapsed: true,
    completedAt: null,
    md5: null
  });
  const grandchild = await insertVersion({
    id: "chain_grandchild",
    chart: chainChart,
    parentVersionId: child.id,
    versionNumber: 3,
    branchPath: "root/a/a",
    author: "potechang",
    progress: 50,
    completedAt: null,
    md5: null
  });
  const featuredMd5 = "10000000000000000000000000000001";
  const featured = await insertVersion({
    id: "featured",
    chart: chainChart,
    parentVersionId: grandchild.id,
    versionNumber: 4,
    branchPath: "root/a/a/a",
    author: "俺",
    difficulty: "sl7",
    title: "Stored Song",
    subtitle: "Stored Subtitle",
    artist: "Stored Artist",
    subartist: "Stored Subartist",
    chartName: "[Nebula]",
    comment: "制作途中の配置を整理しました。  \n\n",
    md5: featuredMd5,
    originUrl: "https://example.com/song#fragment",
    completedAt: "2026-07-24 12:30:00",
    createdAt: "2026-07-24 12:00:00",
    updatedAt: "2026-07-24 12:30:00"
  });
  await insertMetadata(featured.id, {
    status: "succeeded",
    sourceTitle: "Faraway Sky",
    sourceSubtitle: "(All I C Is U)",
    sourceArtist: "BACO / Sobrem",
    sourceSubartist: "obj:potechang / chart:obj2",
    encoding: "utf-8",
    updatedAt: "2026-07-24 12:40:00"
  });

  const duplicateMd5 = "20000000000000000000000000000002";
  const duplicateNew = await insertVersion({
    id: "duplicate_new",
    difficulty: "★2",
    title: "Duplicate Winner",
    md5: duplicateMd5,
    completedAt: "2026-07-24 13:00:00",
    createdAt: "2026-07-24 13:00:00"
  });
  await insertVersion({
    id: "duplicate_old",
    difficulty: "st7",
    title: "Duplicate Loser",
    md5: duplicateMd5,
    completedAt: "2026-07-24 11:00:00",
    createdAt: "2026-07-24 11:00:00"
  });

  const doubleStar = await insertVersion({
    id: "double_star",
    difficulty: "st9",
    md5: "30000000000000000000000000000003",
    completedAt: "2026-07-24 12:00:00"
  });
  const unavailable = await insertVersion({
    id: "unavailable",
    difficulty: "★3",
    title: "Unavailable Stored",
    artist: "Unavailable Artist",
    md5: "40000000000000000000000000000004",
    completedAt: "2026-07-24 11:50:00"
  });
  await insertMetadata(unavailable.id, {
    status: "unavailable",
    errorCode: "SOURCE_FILE_DELETED"
  });
  const failed = await insertVersion({
    id: "failed",
    difficulty: "★4",
    title: "Failed Stored",
    md5: "50000000000000000000000000000005",
    completedAt: "2026-07-24 11:40:00"
  });
  await insertMetadata(failed.id, {
    status: "failed",
    errorCode: "BMS_METADATA_PARSE_FAILED"
  });
  const partial = await insertVersion({
    id: "partial",
    difficulty: "★5",
    title: "Partial Stored",
    subtitle: "Fallback Subtitle",
    artist: "Fallback Artist",
    subartist: "Fallback Subartist",
    md5: "60000000000000000000000000000006",
    completedAt: "2026-07-24 11:30:00"
  });
  await insertMetadata(partial.id, {
    status: "succeeded",
    sourceTitle: "Partial Source",
    sourceArtist: "Source Artist"
  });

  await check("RC author list ignores BMS marker authors and uses only form author history", () => {
    const baseInput = {
      versionId: "v",
      md5: "0".repeat(32),
      level: "2",
      levelLabel: "RC★★2",
      originalDifficulty: "★22",
      storedTitle: "Stored",
      storedSubtitle: "",
      storedArtist: "Stored Artist",
      storedSubartist: "",
      sourceMetadataStatus: "succeeded",
      sourceTitle: "Source",
      sourceSubtitle: null,
      sourceArtist: "Source Artist",
      chartName: "[Chart]",
      versionLabel: "1-1",
      postComment: null,
      originUrl: null,
      downloadUrl: "https://example.test/api/files/f",
      completedAt: "2026-08-13 12:00:00",
      versionUpdatedAt: "2026-08-13 12:00:00",
      sourceMetadataUpdatedAt: "2026-08-13 12:00:00"
    };
    const cases = [
      {
        chainAuthors: ["mukyu--", "餅派"],
        sourceSubartist: "obj:mukyu-- vs 餅派",
        expected: "mukyu--、餅派"
      },
      {
        chainAuthors: ["矢口", "餅派"],
        sourceSubartist: "obj:矢口vs餅派",
        expected: "矢口、餅派"
      }
    ];
    for (const fixture of cases) {
      const model = display.buildDifficultyTableViewModel({
        ...baseInput,
        chainAuthors: fixture.chainAuthors,
        sourceSubartist: fixture.sourceSubartist
      });
      assert.equal(model.authorsText, fixture.expected);
      assert.ok(!model.authorsText.includes("vs"));
    }
  });

  const rejectedStar = await insertVersion({
    rejected: true,
    completedAt: null,
    difficulty: "★6",
    title: "Published Rejected Star",
    md5: "78000000000000000000000000000007",
    createdAt: "2026-07-24 13:10:00"
  });
  const rejectedDouble = await insertVersion({
    rejected: true,
    completedAt: null,
    difficulty: "★★3",
    title: "Published Rejected Double Star",
    md5: "82000000000000000000000000000008",
    createdAt: "2026-07-24 13:05:00"
  });

  const excluded = [];
  excluded.push(await insertVersion({ progress: 99, md5: "70000000000000000000000000000007" }));
  excluded.push(await insertVersion({ completedAt: null, md5: "69000000000000000000000000000006" }));
  excluded.push(await insertVersion({ hidden: true, md5: "71000000000000000000000000000007" }));
  excluded.push(await insertVersion({ chartHidden: true, md5: "72000000000000000000000000000007" }));
  excluded.push(await insertVersion({ downloadBlocked: true, md5: "73000000000000000000000000000007" }));
  excluded.push(await insertVersion({ withdrawalDownloadBlocked: true, md5: "74000000000000000000000000000007" }));
  excluded.push(await insertVersion({ fileDeletedAt: "2026-07-24 09:00:00", md5: "75000000000000000000000000000007" }));
  excluded.push(await insertVersion({ withdrawnAt: "2026-07-24 09:00:00", md5: "76000000000000000000000000000007" }));
  excluded.push(await insertVersion({ deleteRequestedAt: "2026-07-24 09:00:00", md5: "77000000000000000000000000000007" }));
  excluded.push(await insertVersion({ rejected: true, completedAt: null, hidden: true, md5: "83000000000000000000000000000008" }));
  excluded.push(await insertVersion({ collapsed: true, md5: "79000000000000000000000000000007" }));
  excluded.push(await insertVersion({ md5: "not-hex-but-length-is-32-xxxxxxxx", difficulty: "★1" }));
  excluded.push(await insertVersion({ md5: "short", difficulty: "★1" }));
  excluded.push(await insertVersion({ md5: "80000000000000000000000000000008", difficulty: null }));
  const withdrawalExcluded = await insertVersion({ md5: "81000000000000000000000000000008" });
  await env.DB.prepare(`
    INSERT INTO version_withdrawals (
      id, version_id, chart_id, idempotency_key_hash,
      requester_ip_hash, requester_ua_hash, request_mode, status,
      requested_at, scheduled_at, handling_mode
    ) VALUES ('withdrawal_excluded', ?, ?, 'hash', 'ip-hash', 'ua-hash',
      'deferred', 'pending', '2026-07-24 10:00:00',
      '2026-07-31 10:00:00', 'grace_auto_delete')
  `).bind(withdrawalExcluded.id, withdrawalExcluded.chart.chartId).run();
  excluded.push(withdrawalExcluded);

  return {
    featured,
    duplicateNew,
    doubleStar,
    unavailable,
    failed,
    partial,
    rejectedStar,
    rejectedDouble,
    excluded
  };
}

async function testAuthorHistorySql() {
  await check("author history reads hidden and collapsed parents in root-to-current order", async () => {
    const rows = await authorHistory.selectVersionAuthorHistory(env.DB, ["featured"]);
    const map = authorHistory.buildVersionAuthorHistoryMap(["featured"], rows);
    assert.deepEqual(map.get("featured"), ["monsta", "potechang", "俺"]);
    assert.equal(rows.length, 4);
  });

  await check("missing parents retain all ancestry rows that were found", () => {
    const rows = [
      { selected_version_id: "missing", version_id: "current", parent_version_id: "gone", author: "Current", depth: 0 }
    ];
    assert.deepEqual(authorHistory.buildVersionAuthorHistoryMap(["missing"], rows).get("missing"), ["Current"]);
  });

  await check("cycle detection stops without repeating an already visited version", async () => {
    const chart = await createChart({ chartName: "[CYCLE]" });
    await insertVersion({
      id: "cycle_a", chart, branchPath: "cycle/a", author: "A", progress: 50, completedAt: null, md5: null
    });
    await insertVersion({
      id: "cycle_b", chart, branchPath: "cycle/b", author: "B", progress: 50, completedAt: null, md5: null
    });
    await env.DB.prepare("UPDATE versions SET version_number = 2, parent_version_id = 'cycle_b' WHERE id = 'cycle_a'").run();
    await env.DB.prepare("UPDATE versions SET version_number = 2, parent_version_id = 'cycle_a' WHERE id = 'cycle_b'").run();
    const rows = await authorHistory.selectVersionAuthorHistory(env.DB, ["cycle_a"]);
    assert.equal(rows.length, 2);
    assert.deepEqual(authorHistory.buildVersionAuthorHistoryMap(["cycle_a"], rows).get("cycle_a"), ["B", "A"]);
  });

  await check("depth 64 keeps the full chain and depth 65 is capped to 64 versions", async () => {
    const chart = await createChart({ chartName: "[DEEP]" });
    let parentVersionId = null;
    let depth64VersionId = null;
    for (let index = 1; index <= 65; index += 1) {
      const id = `deep_${String(index).padStart(2, "0")}`;
      await insertVersion({
        id,
        chart,
        parentVersionId,
        versionNumber: index,
        branchPath: `root/${String(index).padStart(2, "0")}`,
        author: `Author ${index}`,
        progress: 50,
        completedAt: null,
        md5: null
      });
      parentVersionId = id;
      if (index === 64) depth64VersionId = id;
    }
    const depth64Rows = await authorHistory.selectVersionAuthorHistory(env.DB, [depth64VersionId]);
    const depth64Authors = authorHistory.buildVersionAuthorHistoryMap([depth64VersionId], depth64Rows).get(depth64VersionId);
    assert.equal(depth64Rows.length, 64);
    assert.equal(depth64Authors[0], "Author 1");
    assert.equal(depth64Authors.at(-1), "Author 64");
    const rows = await authorHistory.selectVersionAuthorHistory(env.DB, [parentVersionId]);
    assert.equal(rows.length, 64);
    const authors = authorHistory.buildVersionAuthorHistoryMap([parentVersionId], rows).get(parentVersionId);
    assert.equal(authors.length, 64);
    assert.equal(authors.at(-1), "Author 65");
    assert.equal(authors[0], "Author 2");
  });

  await check("zero selected versions skip the ancestry D1 query", async () => {
    let prepares = 0;
    const database = {
      prepare() {
        prepares += 1;
        throw new Error("must not query");
      }
    };
    assert.deepEqual(await authorHistory.selectVersionAuthorHistory(database, []), []);
    assert.equal(prepares, 0);
  });
}

async function testRouteIntegration(fixtures) {
  const instrumented = instrumentEnvironment(env);
  const startedAt = performance.now();
  const { response, data: starData } = await requestData("rc-star", instrumented.env);
  const durationMs = performance.now() - startedAt;
  const responseText = JSON.stringify(starData);
  const doubleData = (await requestData("rc-double-star")).data;

  await check("selection MD5 sets, RC counts, duplicate exclusion, and ordering match the current eligibility rule", async () => {
    const expectedStar = await expectedSelected("rc-star");
    const expectedDouble = await expectedSelected("rc-double-star");
    assert.deepEqual(starData.map((item) => item.md5), expectedStar);
    assert.deepEqual(doubleData.map((item) => item.md5), expectedDouble);
    assert.equal(starData.length, expectedStar.length);
    assert.equal(doubleData.length, expectedDouble.length);
    assert.equal(starData.filter((item) => item.md5 === fixtures.duplicateNew.md5).length, 1);
    assert.ok(!doubleData.some((item) => item.md5 === fixtures.duplicateNew.md5));
  });

  await check("public rejected rows without completed_at are listed in both tables", () => {
    const rejectedStar = starData.find((item) => item.md5 === fixtures.rejectedStar.md5);
    const rejectedDouble = doubleData.find((item) => item.md5 === fixtures.rejectedDouble.md5);
    assert.ok(rejectedStar);
    assert.ok(rejectedDouble);
    assert.equal(rejectedStar.bms_wip_completed_at, null);
    assert.equal(rejectedDouble.bms_wip_completed_at, null);
  });

  await check("withdrawal, hidden, collapsed, download-blocked, incomplete, deleted, and invalid MD5 rows remain excluded", () => {
    const published = new Set([...starData, ...doubleData].map((item) => item.md5));
    for (const row of fixtures.excluded) {
      if (row.md5) assert.ok(!published.has(String(row.md5).toLowerCase()));
    }
  });

  const featured = starData.find((item) => item.md5 === fixtures.featured.md5);
  assert.ok(featured);
  await check("standard and existing custom JSON fields keep their exact values", () => {
    assert.deepEqual(existingSnapshot(featured), {
      md5: fixtures.featured.md5,
      level: "12",
      title: "Stored Song",
      artist: "Stored Artist",
      url: "https://example.com/song",
      url_diff: `http://localhost/api/files/${fixtures.featured.fileId}`,
      name_diff: "[Nebula] / 1-1-1",
      bms_wip_original_difficulty: "sl7",
      bms_wip_chart_name: "[Nebula]",
      bms_wip_version: "1-1-1",
      bms_wip_author: "俺",
      bms_wip_completed_at: "2026-07-24 12:30:00",
      bms_wip_subtitle: "Stored Subtitle",
      bms_wip_subartist: "Stored Subartist"
    });
  });

  await check("selected-version title and succeeded source artist build display fields while authors use only form history", () => {
    assert.equal(featured.bms_wip_display_title, "Stored Song [Nebula]");
    assert.equal(featured.bms_wip_display_artist, "BACO / Sobrem");
    assert.equal(featured.bms_wip_authors, "monsta、potechang、俺");
    assert.equal(featured.comment, "元難易度：sl7\n制作途中の配置を整理しました。");
    assert.equal(featured.bms_wip_source_title, "Faraway Sky");
    assert.equal(featured.bms_wip_source_subtitle, "(All I C Is U)");
    assert.equal(featured.bms_wip_source_artist, "BACO / Sobrem");
    assert.equal(featured.bms_wip_source_subartist, "obj:potechang / chart:obj2");
  });

  await check("partial succeeded metadata does not replace the selected-version display title", () => {
    const item = starData.find((candidate) => candidate.md5 === fixtures.partial.md5);
    assert.ok(item);
    assert.equal(item.title, "Partial Stored");
    assert.equal(item.artist, "Fallback Artist");
    assert.equal(item.bms_wip_display_title, "Partial Stored [TEST]");
    assert.equal(item.bms_wip_display_artist, "Source Artist / Fallback Subartist");
    assert.equal(item.bms_wip_source_title, "Partial Source");
    assert.equal(item.bms_wip_source_artist, "Source Artist");
    assert.ok(!("bms_wip_source_subtitle" in item));
    assert.ok(!("bms_wip_source_subartist" in item));
  });

  await check("missing, failed, unavailable, and SOURCE_FILE_DELETED metadata use stored fallback safely", () => {
    const unavailable = starData.find((item) => item.md5 === fixtures.unavailable.md5);
    const failed = starData.find((item) => item.md5 === fixtures.failed.md5);
    const noMetadata = starData.find((item) => item.md5 === fixtures.duplicateNew.md5);
    assert.equal(unavailable.bms_wip_display_title, "Unavailable Stored [TEST]");
    assert.equal(unavailable.bms_wip_display_artist, "Unavailable Artist");
    assert.equal(failed.bms_wip_display_title, "Failed Stored [TEST]");
    assert.equal(noMetadata.bms_wip_display_title, "Duplicate Winner [TEST]");
    for (const item of [unavailable, failed, noMetadata]) {
      assert.ok(!Object.keys(item).some((key) => key.startsWith("bms_wip_source_")));
    }
  });

  await check("public JSON exposes only approved new fields and no internal or R2 information", () => {
    const forbiddenKeys = [
      "r2_key", "password_hash", "error_code", "encoding", "status",
      "source_metadata_status", "source_metadata_updated_at", "bms_ir_url"
    ];
    for (const item of [...starData, ...doubleData]) {
      for (const key of forbiddenKeys) assert.ok(!(key in item), `${key} leaked`);
      assert.ok("comment" in item);
      assert.ok("bms_wip_display_title" in item);
      assert.ok("bms_wip_display_artist" in item);
      assert.ok("bms_wip_authors" in item);
    }
    assert.ok(!responseText.includes("SOURCE_FILE_DELETED"));
    assert.ok(!responseText.includes("BMS_METADATA_PARSE_FAILED"));
    assert.ok(!responseText.includes("bms-ir.org"));
  });

  await check("route performs two D1 queries, no R2 operations, and returns JSON via normal serialization", () => {
    assert.equal(instrumented.metrics.d1Queries, 2);
    assert.ok(instrumented.metrics.targetRows >= starData.length);
    assert.ok(instrumented.metrics.ancestryRows >= starData.length);
    assert.equal(instrumented.metrics.r2Get, 0);
    assert.equal(instrumented.metrics.r2Put, 0);
    assert.equal(instrumented.metrics.r2Delete, 0);
    assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  });

  const sourceBefore = await env.DB.prepare(`
    SELECT source_title, source_subtitle, source_artist, source_subartist
    FROM version_source_metadata WHERE version_id = 'featured'
  `).first();
  await requestData("rc-star");
  const sourceAfter = await env.DB.prepare(`
    SELECT source_title, source_subtitle, source_artist, source_subartist
    FROM version_source_metadata WHERE version_id = 'featured'
  `).first();
  await check("building data does not update or normalize source metadata in D1", () => {
    assert.deepEqual(sourceAfter, sourceBefore);
  });

  console.log("performance", JSON.stringify({
    d1Queries: instrumented.metrics.d1Queries,
    targetRows: instrumented.metrics.targetRows,
    ancestryRows: instrumented.metrics.ancestryRows,
    jsonBytes: Buffer.byteLength(responseText),
    durationMs: Number(durationMs.toFixed(2)),
    r2Get: instrumented.metrics.r2Get,
    r2Put: instrumented.metrics.r2Put,
    r2Delete: instrumented.metrics.r2Delete
  }));
}

await testPureDisplayFunctions();

try {
  await harness.listen();
  env = await harness.getWorker().getEnv();
  await applyMigrations();
  const fixtures = await seedIntegrationFixtures();
  await testAuthorHistorySql();
  await testRouteIntegration(fixtures);
  console.log(`difficulty table view-model isolated tests: ${passed} checks passed`);
} finally {
  await harness.close();
}
