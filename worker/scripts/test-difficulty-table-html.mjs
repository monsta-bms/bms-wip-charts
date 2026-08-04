import assert from "node:assert/strict";
import { createServer } from "node:http";
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

const [difficultyTables, difficultyTableHtml, display] = await Promise.all([
  importBundled("src/routes/difficultyTables.ts"),
  importBundled("src/utils/difficultyTableHtml.ts"),
  importBundled("src/utils/difficultyTableDisplay.ts")
]);

const starTable = {
  id: "rc-star",
  name: "リサイクルセンター RC★",
  symbol: "RC★",
  levelOrder: [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "他"
  ]
};

function makeModel(index, overrides = {}) {
  const suffix = index.toString(16).padStart(32, "0").slice(-32);
  return {
    versionId: `browser_${index}`,
    md5: suffix,
    level: index % 2 === 0 ? "2" : "1",
    levelLabel: `RC★${index % 2 === 0 ? "2" : "1"}`,
    originalDifficulty: index % 2 === 0 ? "sl2" : "★1",
    storedTitle: `Stored ${index}`,
    storedArtist: `Stored Artist ${index}`,
    displayTitle: `長い曲名 ${index} Faraway Sky [ANOTHER]`,
    displayArtist: `Artist ${index} / Subartist with a long label`,
    sourceTitle: null,
    sourceSubtitle: null,
    sourceArtist: null,
    sourceSubartist: null,
    chartName: "[ANOTHER]",
    versionLabel: "1-1",
    authors: ["monsta", "potechang"],
    authorsText: "monsta、potechang",
    postComment: index === 1 ? "改行を含むコメントです。\n" + "very-long-token-".repeat(18) : "",
    comment: index === 1 ? "元難易度：★1\n改行を含むコメントです。" : "元難易度：sl2",
    originUrl: "https://example.com/original",
    downloadUrl: `http://127.0.0.1:4178/api/files/browser_${index}`,
    completedAt: "2026-07-24 09:00:00",
    updatedAt: "2026-07-24 09:36:00",
    ...overrides
  };
}

function buildBrowserFixture(theme) {
  const request = new Request(`http://127.0.0.1:4178/difficulty-tables/rc-star?theme=${theme}`);
  return difficultyTableHtml.buildDifficultyTableHtml({
    request,
    table: starTable,
    theme: difficultyTableHtml.getDifficultyTableHtmlTheme(request),
    models: [makeModel(1), makeModel(3), makeModel(2)]
  });
}

if (process.argv.includes("--serve")) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:4178");
    if (url.pathname !== "/difficulty-tables/rc-star") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    const body = buildBrowserFixture(url.searchParams.get("theme") ?? "default");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body))
    });
    response.end(body);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(4178, "127.0.0.1", resolveListen);
  });
  console.log("difficulty table browser fixture: http://127.0.0.1:4178/difficulty-tables/rc-star");
  await new Promise((resolveClose) => {
    const close = () => server.close(resolveClose);
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
  process.exit(0);
}

let passed = 0;
let sequence = 0;
let env;

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
      PASSWORD_HASH_SECRET: "isolated-difficulty-html-password",
      ABUSE_HASH_SECRET: "isolated-difficulty-html-abuse",
      WITHDRAWAL_IDEMPOTENCY_SECRET: "isolated-difficulty-html-withdrawal"
    }
  }]
});

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

async function createChart(chartName = "[TEST]") {
  sequence += 1;
  const suffix = String(sequence).padStart(4, "0");
  const songId = `html_song_${suffix}`;
  const chartId = `html_chart_${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO songs (id, title, artist, normalized_title, normalized_artist)
      VALUES (?, ?, ?, ?, ?)
    `).bind(songId, `Song ${suffix}`, `Artist ${suffix}`, `song ${suffix}`, `artist ${suffix}`),
    env.DB.prepare(`
      INSERT INTO charts (id, song_id, chart_name, normalized_chart_name)
      VALUES (?, ?, ?, ?)
    `).bind(chartId, songId, chartName, chartName.normalize("NFKC").toLowerCase())
  ]);
  return { chartId, chartName };
}

async function insertVersion(options = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(5, "0");
  const chart = options.chart ?? await createChart(options.chartName ?? "[TEST]");
  const id = options.id ?? `html_version_${suffix}`;
  const parentVersionId = options.parentVersionId ?? null;
  const branchPath = options.branchPath ?? (parentVersionId ? `root/${suffix}` : "root");
  const fileId = options.fileId ?? `html_file_${suffix}`;
  await env.DB.prepare(`
    INSERT INTO versions (
      id, chart_id, parent_version_id, version_number, branch_path,
      author, progress, comment, difficulty, level,
      title, subtitle, artist, subartist, md5, origin_url,
      file_id, file_name, file_size, file_sha256, r2_key, password_hash,
      download_blocked, withdrawal_download_blocked, is_hidden, collapsed_by_completion,
      chart_name, created_at, updated_at, completed_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, 'chart.bms', 1, ?, ?, 'hash',
      0, 0, ?, ?,
      ?, ?, ?, ?
    )
  `).bind(
    id,
    chart.chartId,
    parentVersionId,
    options.versionNumber ?? (parentVersionId ? 2 : 1),
    branchPath,
    options.author ?? "HTML Tester",
    options.progress ?? 100,
    options.comment ?? "",
    options.difficulty ?? "★1",
    options.level ?? "1",
    options.title ?? `Stored Title ${suffix}`,
    options.subtitle ?? "",
    options.artist ?? `Stored Artist ${suffix}`,
    options.subartist ?? "",
    options.md5 ?? suffix.padStart(32, "0"),
    options.originUrl ?? null,
    fileId,
    `sha_${suffix}`,
    `difficulty/${suffix}.bms`,
    options.hidden ? 1 : 0,
    options.collapsed ? 1 : 0,
    options.chartName ?? chart.chartName,
    options.createdAt ?? "2026-07-24 08:00:00",
    options.updatedAt ?? "2026-07-24 08:00:00",
    options.completedAt === undefined ? "2026-07-24 08:00:00" : options.completedAt
  ).run();
  return { id, chart, fileId };
}

async function insertMetadata(versionId, values) {
  await env.DB.prepare(`
    INSERT INTO version_source_metadata (
      version_id, source_title, source_subtitle, source_artist, source_subartist,
      encoding, status, error_code, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'utf-8', ?, ?, ?)
  `).bind(
    versionId,
    values.sourceTitle ?? null,
    values.sourceSubtitle ?? null,
    values.sourceArtist ?? null,
    values.sourceSubartist ?? null,
    values.status,
    values.errorCode ?? null,
    values.updatedAt ?? "2026-07-24 09:36:00"
  ).run();
}

async function seedFixtures() {
  const chainChart = await createChart("[Nebula]");
  const parent = await insertVersion({
    id: "html_parent",
    chart: chainChart,
    author: "monsta",
    progress: 40,
    completedAt: null,
    hidden: true,
    md5: null
  });
  const featured = await insertVersion({
    id: "html_featured",
    chart: chainChart,
    parentVersionId: parent.id,
    branchPath: "root/a",
    author: "potechang",
    difficulty: "★2",
    title: "Stored Featured",
    artist: "Stored Artist",
    chartName: "[Nebula]",
    comment: "line 1\r\nline 2 🎵",
    md5: "ABCDEFABCDEFABCDEFABCDEFABCDEFAB",
    originUrl: "https://example.com/original?download=1#fragment",
    updatedAt: "2026-07-24 09:30:00",
    completedAt: "2026-07-24 09:20:00"
  });
  await insertMetadata(featured.id, {
    status: "succeeded",
    sourceTitle: "Faraway Sky",
    sourceSubtitle: "(All I C Is U)",
    sourceArtist: "BACO / Sobrem",
    sourceSubartist: "obj:potechang",
    updatedAt: "2026-07-24 09:36:00"
  });

  const fallback = await insertVersion({
    id: "html_fallback",
    difficulty: "★1",
    title: "Unavailable Stored",
    artist: "Unavailable Artist",
    comment: "",
    md5: "10000000000000000000000000000001",
    updatedAt: "2026-07-24 08:20:00"
  });
  await insertMetadata(fallback.id, {
    status: "unavailable",
    errorCode: "SOURCE_FILE_DELETED",
    updatedAt: "2026-07-24 08:25:00"
  });

  await insertVersion({
    id: "html_unsafe_origin",
    difficulty: "★2",
    title: "Unsafe Origin",
    originUrl: "javascript:alert(1)",
    md5: "20000000000000000000000000000002",
    updatedAt: "2026-07-24 08:10:00"
  });

  const malicious = await insertVersion({
    id: "html_malicious",
    difficulty: "★3",
    title: `\"><script>alert(1)</script>`,
    subtitle: "' autofocus onfocus='alert(1)",
    artist: `\"><script>alert(2)</script>`,
    subartist: "data:text/html,<svg onload=alert(1)>",
    author: "</summary><script>alert(3)</script>",
    chartName: `\"><img src=x onerror=alert(4)>`,
    comment: "</summary><script>alert(5)</script>\n" + "very-long-token-".repeat(80),
    originUrl: "data:text/html,<script>alert(6)</script>",
    md5: "30000000000000000000000000000003",
    updatedAt: "2026-07-24 08:05:00"
  });

  const doubleStar = await insertVersion({
    id: "html_double",
    difficulty: "st7",
    title: "Double Star",
    md5: "40000000000000000000000000000004",
    updatedAt: "2026-07-24 08:00:00"
  });
  const rejected = await insertVersion({
    id: "html_rejected",
    difficulty: "★★2",
    title: "Published Rejected Chart",
    md5: "50000000000000000000000000000005",
    completedAt: null,
    updatedAt: "2026-07-24 08:30:00"
  });
  await env.DB.prepare("UPDATE versions SET is_rejected = 1 WHERE id = ?").bind(rejected.id).run();
  return { featured, fallback, malicious, doubleStar, rejected };
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
        if (sql.includes("WITH RECURSIVE selected")) metrics.ancestryRows += count;
        else if (sql.includes("FROM versions")) metrics.targetRows += count;
        return result;
      },
      first(columnName) {
        return columnName === undefined ? statement.first() : statement.first(columnName);
      },
      run() { return statement.run(); },
      raw(options) { return statement.raw(options); }
    };
  }
  const database = {
    prepare(sql) {
      metrics.d1Queries += 1;
      return wrapStatement(baseEnv.DB.prepare(sql), sql);
    },
    batch(statements) { return baseEnv.DB.batch(statements); },
    exec(sql) { return baseEnv.DB.exec(sql); },
    withSession(constraint) { return baseEnv.DB.withSession(constraint); },
    dump() { return baseEnv.DB.dump(); }
  };
  const files = new Proxy(baseEnv.FILES, {
    get(target, property) {
      if (property === "get") return (...args) => { metrics.r2Get += 1; return target.get(...args); };
      if (property === "put") return (...args) => { metrics.r2Put += 1; return target.put(...args); };
      if (property === "delete") return (...args) => { metrics.r2Delete += 1; return target.delete(...args); };
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { env: { ...baseEnv, DB: database, FILES: files }, metrics };
}

async function route(path, options = {}, routeEnv = env) {
  const request = new Request(`http://localhost${path}`, options);
  return difficultyTables.handleDifficultyTableRoute(request, routeEnv, new URL(request.url).pathname);
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function assertNoExecutableInjection(body) {
  assert.equal(countMatches(body, /<script(?:\s|>)/giu), 0);
  assert.equal(countMatches(body, /<[^>]+\son[a-z]+\s*=/giu), 0);
}

async function runTests(fixtures) {
  const instrumented = instrumentEnvironment(env);
  const responseStartedAt = performance.now();
  const starResponse = await route("/difficulty-tables/rc-star?theme=default", {}, instrumented.env);
  const starBody = await starResponse.text();
  const responseDurationMs = performance.now() - responseStartedAt;
  const doubleResponse = await route("/difficulty-tables/rc-double-star");
  const doubleBody = await doubleResponse.text();

  await check("1 RC star GET returns human HTML", () => {
    assert.equal(starResponse.status, 200);
    assert.equal(starResponse.headers.get("Content-Type"), "text/html; charset=utf-8");
  });
  await check("2 RC double-star GET returns human HTML", () => {
    assert.equal(doubleResponse.status, 200);
    assert.match(doubleBody, /リサイクルセンター RC★★/u);
  });
  await check("3 HEAD returns no body", async () => {
    const response = await route("/difficulty-tables/rc-star", { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  });
  await check("4 OPTIONS keeps the public route behavior", async () => {
    const response = await route("/difficulty-tables/rc-star", { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  });
  await check("5 POST remains method not allowed", async () => {
    const response = await route("/difficulty-tables/rc-star", { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD, OPTIONS");
  });
  await check("6 invalid table id remains a safe 400", async () => {
    const response = await route("/difficulty-tables/not-a-table");
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_DIFFICULTY_TABLE");
  });
  for (const [number, theme] of [[7, "white"], [8, "default"], [9, "dark"]]) {
    await check(`${number} theme ${theme} is selected`, async () => {
      const response = await route(`/difficulty-tables/rc-star?theme=${theme}`);
      assert.match(await response.text(), new RegExp(`<html lang="ja" data-theme="${theme}">`, "u"));
    });
  }
  await check("10 invalid theme falls back to default", async () => {
    const response = await route("/difficulty-tables/rc-star?theme=neon");
    assert.match(await response.text(), /<html lang="ja" data-theme="default">/u);
  });
  await check("11 bmstable meta keeps an absolute header URL", () => {
    assert.match(starBody, /<meta name="bmstable" content="http:\/\/localhost\/api\/difficulty-tables\/rc-star\/header\.json">/u);
  });
  await check("12 header JSON link is present", () => {
    assert.match(starBody, /href="http:\/\/localhost\/api\/difficulty-tables\/rc-star\/header\.json">header\.json/u);
  });
  await check("13 data JSON link is present", () => {
    assert.match(starBody, /href="http:\/\/localhost\/api\/difficulty-tables\/rc-star\/data\.json">data\.json/u);
  });
  await check("14 HTML cache is 60 seconds", () => {
    assert.equal(starResponse.headers.get("Cache-Control"), "public, max-age=60, must-revalidate");
  });
  await check("15 HTML response has a SHA-256 ETag", () => {
    assert.match(starResponse.headers.get("ETag"), /^"[0-9a-f]{64}"$/u);
  });
  await check("16 If-None-Match returns 304", async () => {
    const response = await route("/difficulty-tables/rc-star?theme=default", {
      headers: { "If-None-Match": starResponse.headers.get("ETag") }
    });
    assert.equal(response.status, 304);
    assert.equal(await response.text(), "");
  });
  await check("17 Content-Length is the UTF-8 byte length", () => {
    assert.equal(Number(starResponse.headers.get("Content-Length")), Buffer.byteLength(starBody));
  });
  await check("18 nosniff remains enabled", () => {
    assert.equal(starResponse.headers.get("X-Content-Type-Options"), "nosniff");
  });

  await check("19 page title uses the table name", () => {
    assert.match(starBody, /<title>リサイクルセンター RC★<\/title>/u);
    assert.match(starBody, /<h1>リサイクルセンター RC★<\/h1>/u);
  });
  await check("20 explanation defines RC conversion and link roles", () => {
    for (const value of ["完成版", "RC難易度へ変換", "元難易度", "BMS-IR", "原曲・本体ページ", "譜面ファイル"]) {
      assert.ok(starBody.includes(value), value);
    }
  });
  await check("21 total count reflects the selected table", () => {
    assert.match(starBody, /<strong>全4譜面<\/strong>/u);
  });
  await check("22 latest update is data-derived and formatted in JST", () => {
    assert.ok(starBody.includes("最終更新：2026/07/24 18:36"));
  });
  await check("23 RC switch preserves the selected theme", () => {
    assert.match(starBody, /href="\/difficulty-tables\/rc-double-star\?theme=default"/u);
    assert.match(starBody, /href="\/difficulty-tables\/rc-star\?theme=default" aria-current="page"/u);
  });
  await check("24 theme UI is absent while theme query support remains", () => {
    assert.ok(!starBody.includes('aria-label="表示テーマの切替"'));
    assert.ok(!starBody.includes('href="/difficulty-tables/rc-star?theme=white"'));
    assert.ok(!starBody.includes('href="/difficulty-tables/rc-star?theme=dark"'));
  });
  await check("RC star has one public-site home link", () => {
    assert.equal(countMatches(starBody, /class="home-link"/gu), 1);
    assert.match(starBody, /href="https:\/\/monsta-bms\.github\.io\/bms-wip-charts\/">/u);
  });
  await check("RC double-star has one public-site home link", () => {
    assert.equal(countMatches(doubleBody, /class="home-link"/gu), 1);
    assert.ok(doubleBody.includes("← リサイクルセンターへ戻る"));
  });
  await check("public-site home link stays in the same tab", () => {
    const homeLink = starBody.match(/<a class="home-link"[^>]+>/u)?.[0] ?? "";
    assert.ok(homeLink);
    assert.ok(!homeLink.includes("target="));
  });
  await check("public-site home link has a 44px target and separate group", () => {
    assert.match(starBody, /\.home-link \{[\s\S]*min-height: 44px;/u);
    assert.match(starBody, /class="home-link-group"/u);
    assert.match(starBody, /class="switches"/u);
  });
  await check("25 level sections follow header level order", () => {
    const level1 = starBody.indexOf('id="level-1-heading"');
    const level2 = starBody.indexOf('id="level-2-heading"');
    const level3 = starBody.indexOf('id="level-3-heading"');
    assert.ok(level1 >= 0 && level1 < level2 && level2 < level3);
  });
  await check("26 zero-count levels are omitted", () => {
    assert.ok(!starBody.includes('id="level-0-heading"'));
    assert.ok(!starBody.includes('id="level-4-heading"'));
  });
  await check("27 each rendered level has its own count", () => {
    assert.ok(starBody.includes("RC★1（1譜面）"));
    assert.ok(starBody.includes("RC★2（2譜面）"));
    assert.ok(starBody.includes("RC★3（1譜面）"));
  });
  await check("28 all seven columns are present in fixed order", () => {
    const headers = [...starBody.matchAll(/<th[^>]*>([^<]+)<\/th>/gu)].slice(0, 7).map((match) => match[1]);
    assert.deepEqual(headers, ["難易度", "曲名", "アーティスト", "作者一覧", "コメント", "曲", "DL"]);
  });
  await check("29 empty selection produces a complete empty state without a table", async () => {
    const emptyEnv = {
      ...env,
      DB: { prepare: () => ({ all: async () => ({ results: [] }) }) }
    };
    const response = await route("/difficulty-tables/rc-star", {}, emptyEnv);
    const body = await response.text();
    assert.ok(body.includes("現在、この難易度に掲載されている譜面はありません。"));
    assert.equal(countMatches(body, /<table\b/gu), 0);
    assert.ok(body.includes("header.json") && body.includes("data.json"));
  });
  await check("30 unavailable metadata falls back to stored display fields", () => {
    assert.ok(starBody.includes("Unavailable Stored [TEST]"));
    assert.ok(starBody.includes("Unavailable Artist"));
    assert.ok(!starBody.includes("SOURCE_FILE_DELETED"));
  });

  await check("31 valid MD5 turns the entire display title into BMS-IR link", () => {
    assert.match(starBody, /href="https:\/\/bms-ir\.org\/new\/song\?songmd5=abcdefabcdefabcdefabcdefabcdefab"[^>]*>Faraway Sky \(All I C Is U\) \[Nebula\]<\/a>/u);
  });
  await check("32 uppercase MD5 is lowercased in BMS-IR URL", () => {
    assert.ok(starBody.includes("songmd5=abcdefabcdefabcdefabcdefabcdefab"));
    assert.ok(!starBody.includes("songmd5=ABCDEF"));
  });
  await check("33 invalid MD5 remains plain text in the pure serializer", () => {
    const request = new Request("http://localhost/difficulty-tables/rc-star");
    const body = difficultyTableHtml.buildDifficultyTableHtml({
      request,
      table: starTable,
      theme: "default",
      models: [makeModel(9, { md5: "not-a-valid-md5", displayTitle: "Invalid MD5" })]
    });
    assert.ok(body.includes(">Invalid MD5</td>"));
    assert.ok(!body.includes("bms-ir.org"));
  });
  await check("34 BMS-IR link has target, rel, and fixed title", () => {
    assert.match(starBody, /href="https:\/\/bms-ir\.org[^>]+target="_blank" rel="noopener noreferrer" title="BMS-IRで譜面情報を開く"/u);
  });
  await check("35 曲 link uses the validated origin URL", () => {
    assert.match(starBody, /href="https:\/\/example\.com\/original\?download&#61;1" target="_blank" rel="noopener noreferrer"[^>]*>曲<\/a>/u);
  });
  await check("36 missing origin is rendered as non-link", () => {
    const fallbackRow = starBody.match(/<tr class="chart-row" role="row">[\s\S]*?Unavailable Stored[\s\S]*?<\/tr>/u)?.[0] ?? "";
    assert.ok(fallbackRow.includes('aria-label="情報なし">—</span>'));
    assert.ok(!fallbackRow.includes(">曲</a>"));
  });
  await check("37 javascript origin is rejected", () => {
    assert.ok(!starBody.includes('href="javascript:'));
  });
  await check("38 data origin is rejected", () => {
    assert.ok(!starBody.includes('href="data:'));
  });
  await check("39 DL uses the Worker file API", () => {
    assert.match(starBody, new RegExp(`href="http://localhost/api/files/${fixtures.featured.fileId}"`, "u"));
  });
  await check("40 R2 key and internal fields are absent", () => {
    for (const forbidden of ["difficulty/", "r2_key", "password_hash", "source_metadata_status"]) {
      assert.ok(!starBody.includes(forbidden), forbidden);
    }
  });
  await check("41 title, origin, and DL resolve to distinct URLs", () => {
    assert.ok(starBody.includes("https://bms-ir.org/new/song?songmd5="));
    assert.ok(starBody.includes("https://example.com/original?download&#61;1"));
    assert.ok(starBody.includes(`/api/files/${fixtures.featured.fileId}`));
  });
  await check("42 all three link roles have accessible names", () => {
    assert.ok(starBody.includes("Faraway Sky (All I C Is U) [Nebula]をBMS-IRで開く"));
    assert.ok(starBody.includes("Faraway Sky (All I C Is U) [Nebula]の原曲・本体配布ページを開く"));
    assert.ok(starBody.includes("Faraway Sky (All I C Is U) [Nebula]の譜面ファイルをダウンロード"));
  });

  await check("43 original difficulty is always visible", () => {
    assert.ok(starBody.includes("元: ★1"));
    assert.ok(starBody.includes("元: ★2"));
  });
  await check("44 no post comment means no details in that row", () => {
    const fallbackRow = starBody.match(/<tr class="chart-row" role="row">[\s\S]*?Unavailable Stored[\s\S]*?<\/tr>/u)?.[0] ?? "";
    assert.ok(!fallbackRow.includes("<details"));
  });
  await check("45 post comment adds native details", () => {
    assert.match(starBody, /<details class="row-comment"><summary aria-label="コメントを見る">💬<\/summary>/u);
  });
  await check("46 details uses native keyboard-operable summary without inline handlers", () => {
    assert.match(starBody, /<details[^>]*><summary aria-label="コメントを見る">💬<\/summary>/u);
    assert.ok(!starBody.includes("onclick="));
  });
  await check("47 comment newlines are preserved structurally", () => {
    assert.ok(starBody.includes("line 1\nline 2 🎵"));
    assert.match(starBody, /\.comment-body[\s\S]*white-space: pre-wrap/u);
  });
  await check("48 HTML tags in comments remain escaped text", () => {
    assert.ok(starBody.includes("&lt;/summary&gt;&lt;script&gt;alert(5)&lt;/script&gt;"));
  });
  await check("49 long comments have bounded wrapping CSS", () => {
    assert.match(starBody, /\.comment-body[\s\S]*overflow-wrap: anywhere/u);
  });
  await check("50 emoji remains intact", () => {
    assert.ok(starBody.includes("🎵"));
  });
  await check("51 quotes remain text and do not form attributes", () => {
    assert.ok(starBody.includes("&#39; autofocus onfocus&#61;&#39;alert(1)"));
  });

  await check("52 malicious title is escaped", () => {
    assert.ok(starBody.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  });
  await check("53 malicious artist is escaped", () => {
    assert.ok(starBody.includes("&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"));
  });
  await check("54 malicious author is escaped", () => {
    assert.ok(starBody.includes("&lt;/summary&gt;&lt;script&gt;alert(3)&lt;/script&gt;"));
  });
  await check("55 malicious comment is escaped", () => {
    assert.ok(starBody.includes("&lt;/summary&gt;&lt;script&gt;alert(5)&lt;/script&gt;"));
  });
  await check("56 malicious chart name is escaped inside display title", () => {
    assert.ok(starBody.includes("&quot;&gt;&lt;img src&#61;x onerror&#61;alert(4)&gt;"));
  });
  await check("57 accessible labels cannot be attribute-injected", () => {
    assertNoExecutableInjection(starBody);
    assert.ok(!starBody.includes('aria-label=""><script'));
  });
  await check("58 title attributes remain fixed and cannot be injected", () => {
    const titles = [...starBody.matchAll(/\stitle="([^"]*)"/gu)].map((match) => match[1]);
    assert.ok(titles.length > 0);
    assert.ok(titles.every((value) => value === "BMS-IRで譜面情報を開く"));
  });
  await check("59 no executable script element is generated", () => {
    assert.equal(countMatches(starBody, /<script(?:\s|>)/giu), 0);
  });
  await check("60 no inline event attribute is generated", () => {
    assert.equal(countMatches(starBody, /<[^>]+\son[a-z]+\s*=/giu), 0);
  });

  await check("61 every non-empty level has one section, table, and thead", () => {
    assert.equal(countMatches(starBody, /<section class="level-section"/gu), 3);
    assert.equal(countMatches(starBody, /<table class="difficulty-table"/gu), 3);
    assert.equal(countMatches(starBody, /<thead role="rowgroup">/gu), 3);
  });
  await check("62 every level table has exactly seven column headers", () => {
    const tables = [...starBody.matchAll(/<table class="difficulty-table"[\s\S]*?<\/table>/gu)].map((match) => match[0]);
    assert.equal(tables.length, 3);
    assert.ok(tables.every((tableBody) => countMatches(tableBody, /<th role="columnheader"/gu) === 7));
  });
  await check("63 every selected model is emitted once as a chart row", () => {
    assert.equal(countMatches(starBody, /<tr class="chart-row" role="row">/gu), 4);
    assert.equal(countMatches(starBody, /<td role="cell" class="cell-title"/gu), 4);
  });
  await check("64 level headings use safe ids shared by aria-labelledby", () => {
    for (const level of ["1", "2", "3"]) {
      assert.ok(starBody.includes(`<section class="level-section" aria-labelledby="level-${level}-heading">`));
      assert.ok(starBody.includes(`<h2 class="level-heading" id="level-${level}-heading">`));
      assert.ok(starBody.includes(`<table class="difficulty-table" role="table" aria-labelledby="level-${level}-heading">`));
    }
  });
  await check("65 zebra selectors are scoped to chart rows and reset per tbody", () => {
    assert.match(starBody, /\.difficulty-table tbody \.chart-row:nth-child\(odd\) \{ background: var\(--row\); \}/u);
    assert.match(starBody, /\.difficulty-table tbody \.chart-row:nth-child\(even\) \{ background: var\(--row-alt\); \}/u);
    assert.match(starBody, /\.difficulty-table tbody \.chart-row:hover \{ background: var\(--row-hover\); \}/u);
    const tableBodies = [...starBody.matchAll(/<tbody role="rowgroup">([\s\S]*?)<\/tbody>/gu)].map((match) => match[1]);
    assert.ok(tableBodies.every((body) => body.trimStart().startsWith('<tr class="chart-row" role="row">')));
  });
  await check("66 data cells use horizontal rules without vertical borders", () => {
    const style = starBody.match(/<style>([\s\S]*?)<\/style>/u)?.[1] ?? "";
    assert.match(style, /\.difficulty-table th, \.difficulty-table td \{[\s\S]*border-bottom: 1px solid var\(--border\);/u);
    assert.ok(!style.includes("border-left"));
    assert.ok(!style.includes("border-right"));
  });
  await check("67 desktop rows and level headings use compact spacing", () => {
    assert.match(starBody, /padding: \.4375rem \.5625rem;/u);
    assert.match(starBody, /\.level-heading \{[\s\S]*padding: \.35rem \.65rem;[\s\S]*font-size: 1rem;/u);
  });
  await check("68 曲 and DL are lightweight action links with no button box", () => {
    assert.ok(starBody.includes('class="action-link"'));
    assert.ok(!starBody.includes('class="compact-link"'));
    assert.match(starBody, /\.action-link \{[\s\S]*border: 0;[\s\S]*background: none;/u);
  });
  await check("69 compact comment summary keeps native details and accessible icon", () => {
    assert.match(starBody, /<div class="comment-summary"><span class="original-difficulty">元: ★2<\/span><details class="row-comment"><summary aria-label="コメントを見る">💬<\/summary>/u);
    assert.match(starBody, /\.row-comment summary[\s\S]*min-width: 30px;[\s\S]*min-height: 30px;/u);
    assert.match(starBody, /\.comment-body \{[\s\S]*background: transparent;/u);
  });
  await check("70 mobile keeps actions horizontal with 44px targets", () => {
    assert.match(starBody, /"origin download";/u);
    assert.match(starBody, /\.switch-link, \.action-link, \.row-comment summary \{ min-width: 44px; min-height: 44px; \}/u);
  });
  await check("71 default, white, and dark define distinct zebra palettes", () => {
    assert.equal(countMatches(starBody, /--row:/gu), 2);
    for (const token of ["--row-alt", "--row-hover", "--table-head"]) {
      assert.equal(countMatches(starBody, new RegExp(`${token}:`, "gu")), 3);
    }
    assert.match(starBody, /html\[data-theme="white"\][\s\S]*--row-alt: #f1f2f3;/u);
    assert.match(starBody, /html\[data-theme="dark"\][\s\S]*--row: #191f22;/u);
  });
  await check("72 column balance favors title and keeps action columns narrow", () => {
    assert.match(starBody, /col\.col-title \{ width: 30%; \}/u);
    assert.match(starBody, /col\.col-artist \{ width: 20%; \}/u);
    assert.match(starBody, /col\.col-origin, col\.col-download \{ width: 3\.25rem; \}/u);
  });

  await check("JSON header and data remain byte-identical before and after HTML requests", async () => {
    const headerBefore = await (await route("/api/difficulty-tables/rc-star/header.json")).text();
    const dataBefore = await (await route("/api/difficulty-tables/rc-star/data.json")).text();
    await route("/difficulty-tables/rc-star?theme=dark");
    const headerAfter = await (await route("/api/difficulty-tables/rc-star/header.json")).text();
    const dataAfter = await (await route("/api/difficulty-tables/rc-star/data.json")).text();
    assert.equal(headerAfter, headerBefore);
    assert.equal(dataAfter, dataBefore);
    assert.ok(!dataAfter.includes("postComment"));
  });
  await check("same data and theme produce stable HTML and ETag", async () => {
    const repeat = await route("/difficulty-tables/rc-star?theme=default");
    assert.equal(await repeat.text(), starBody);
    assert.equal(repeat.headers.get("ETag"), starResponse.headers.get("ETag"));
  });
  await check("HTML route performs two D1 queries and no R2 operations", () => {
    assert.equal(instrumented.metrics.d1Queries, 2);
    assert.ok(instrumented.metrics.targetRows >= 5);
    assert.ok(instrumented.metrics.ancestryRows >= 4);
    assert.deepEqual(
      [instrumented.metrics.r2Get, instrumented.metrics.r2Put, instrumented.metrics.r2Delete],
      [0, 0, 0]
    );
  });
  await check("HTML D1 failure returns safe no-store 503 page and fixed log fields", async () => {
    const originalConsoleError = console.error;
    const logs = [];
    console.error = (...values) => logs.push(values);
    try {
      const errorEnv = { ...env, DB: { prepare: () => { throw new Error("private SQL detail"); } } };
      const response = await route("/difficulty-tables/rc-star?theme=dark", {}, errorEnv);
      const body = await response.text();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
      assert.ok(body.includes("難易度表を読み込めませんでした。"));
      assert.ok(!body.includes("private SQL detail"));
      assert.equal(countMatches(body, /class="home-link"/gu), 1);
      assert.match(body, /href="https:\/\/monsta-bms\.github\.io\/bms-wip-charts\/">/u);
      assert.equal(logs.length, 1);
      assert.deepEqual(logs[0], [
        "[difficulty-table-view] failed to build page",
        { code: "DIFFICULTY_TABLE_UNAVAILABLE", tableId: "rc-star" }
      ]);
    } finally {
      console.error = originalConsoleError;
    }
  });
  await check("HTML error HEAD keeps status and headers without a body", async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const errorEnv = { ...env, DB: { prepare: () => { throw new Error("hidden"); } } };
      const response = await route("/difficulty-tables/rc-star", { method: "HEAD" }, errorEnv);
      assert.equal(response.status, 503);
      assert.equal(await response.text(), "");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    } finally {
      console.error = originalConsoleError;
    }
  });
  await check("public rejected chart without completed_at is rendered in RC double-star HTML", () => {
    assert.match(doubleBody, /Published Rejected Chart/u);
  });

  const generationMetrics = [];
  for (const count of [100, 1000]) {
    const models = Array.from({ length: count }, (_, index) => makeModel(index + 1));
    const beforeHeap = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const body = difficultyTableHtml.buildDifficultyTableHtml({
      request: new Request("http://localhost/difficulty-tables/rc-star?theme=default"),
      table: starTable,
      theme: "default",
      models
    });
    const durationMs = performance.now() - startedAt;
    generationMetrics.push({
      rows: count,
      htmlBytes: Buffer.byteLength(body),
      generationMs: Number(durationMs.toFixed(2)),
      heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap
    });
    assert.equal(countMatches(body, /<tr class="chart-row" role="row">/gu), count);
  }

  console.log("performance", JSON.stringify({
    d1Queries: instrumented.metrics.d1Queries,
    targetRows: instrumented.metrics.targetRows,
    ancestryRows: instrumented.metrics.ancestryRows,
    htmlBytes: Buffer.byteLength(starBody),
    responseWithShaEtagMs: Number(responseDurationMs.toFixed(2)),
    etag: starResponse.headers.get("ETag"),
    r2Get: instrumented.metrics.r2Get,
    r2Put: instrumented.metrics.r2Put,
    r2Delete: instrumented.metrics.r2Delete,
    generation: generationMetrics
  }));
}

try {
  await harness.listen();
  env = await harness.getWorker().getEnv();
  await applyMigrations();
  const fixtures = await seedFixtures();
  await runTests(fixtures);
  console.log(`difficulty table HTML isolated tests: ${passed} checks passed`);
} finally {
  await harness.close();
}
