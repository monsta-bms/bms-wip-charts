import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "docs", "changelog.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "site-copy", "site-copy-manifest.json"), "utf8"));
const articles = [...html.matchAll(/<article\b[^>]*\bdata-copy-entry="([A-Z0-9_]+)"[^>]*>([\s\S]*?)<\/article>/gu)]
  .map((match) => ({ id: match[1], html: match[2] }));
const manifestEntries = manifest.changelogEntries ?? [];

assert.equal(articles.length, 17, "公開changelogは17 entryであること");
assert.equal(manifestEntries.length, articles.length, "manifest entry数が一致すること");
assert.equal(new Set(articles.map((entry) => entry.id)).size, articles.length, "ENTRY IDが重複しないこと");
assert.deepEqual(manifestEntries.map((entry) => entry.id), articles.map((entry) => entry.id), "manifestとHTMLのENTRY順が一致すること");

const dates = articles.map((entry) => {
  const time = entry.html.match(/<time\s+datetime="(\d{4}-\d{2}-\d{2})">(\d{4}\/\d{2}\/\d{2})<\/time>/u);
  assert.ok(time, `${entry.id}の日付が正しいこと`);
  assert.equal(time[1], time[2].replaceAll("/", "-"), `${entry.id}のdatetimeが表示日と一致すること`);
  const itemCount = (entry.html.match(/<li>/gu) ?? []).length;
  assert.ok(itemCount >= 2 && itemCount <= 5, `${entry.id}の箇条書きは2～5件であること`);
  return time[1];
});
assert.deepEqual(dates, [...dates].sort().reverse(), "日付が新しい順であること");
const todayJst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
assert.ok(dates.every((date) => date <= todayJst), "未来日付がないこと");

const publicText = html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
for (const term of ["投稿", "追記", "進捗マップ", "ミニビュー", "投稿一覧", "検索", "期間", "ページ送り", "お気に入り", "難易度表", "投稿管理", "取り下げ", "削除申請", "安全", "テーマ", "ガイド", "文章", "不具合", "初期化"]) {
  assert.ok(publicText.includes(term), `主要機能「${term}」が更新履歴に含まれること`);
}
for (const forbidden of [
  ["期間", "限定"].join(""),
  ["1", "か月", "限定"].join(""),
  ["2026", "/09", "/02"].join(""),
  ["2026", "-09", "-02"].join(""),
  ["公開", "終了", "予定"].join(""),
  ["残り", "日数"].join(""),
  ["延長", "予定"].join("")
]) assert.equal(`${html}\n${JSON.stringify(manifest)}`.includes(forbidden), false, `禁止表現「${forbidden}」がないこと`);

for (const internal of [
  ["ADMIN", "_TOKEN"].join(""),
  ["PASSWORD", "_HASH", "_SECRET"].join(""),
  ["deployment", " ID"].join(""),
  ["Worker", " version", " ID"].join("")
]) assert.equal(publicText.includes(internal), false, `内部情報「${internal}」が公開文にないこと`);

const launch = articles[0].html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
for (const phrase of ["正式公開を開始しました", "公開終了の予定はありません", "投稿データを初期化", "ガイド", "操作欄が消える不具合", "投稿、追記、一覧、難易度表"]) {
  assert.ok(launch.includes(phrase), `正式公開entryに「${phrase}」が含まれること`);
}

process.stdout.write(`FINAL_PUBLIC_CHANGELOG_TESTS passed entries=${articles.length} oldest=${dates.at(-1)} newest=${dates[0]}\n`);
