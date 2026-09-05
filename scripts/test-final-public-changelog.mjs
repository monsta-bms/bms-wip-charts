import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "docs", "changelog.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "site-copy", "site-copy-manifest.json"), "utf8"));
const articles = [...html.matchAll(/<article\b[^>]*\bdata-copy-entry="([A-Z0-9_]+)"[^>]*>([\s\S]*?)<\/article>/gu)]
  .map((match) => ({ id: match[1], html: match[2] }));
const manifestEntries = manifest.changelogEntries ?? [];

assert.equal(articles.length, 25, "公開changelogは25 entryであること");
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
for (const term of ["投稿", "追記", "進捗マップ", "ミニビュー", "投稿一覧", "検索", "期間", "ページ送り", "お気に入り", "難易度表", "投稿管理", "取り下げ", "削除申請", "安全", "テーマ", "ガイド", "文章", "不具合", "初期化", "投稿者コメント", "版へコメント", "ここをドラッグ"]) {
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

const launch = articles.find((entry) => entry.id === "CHANGELOG_20260802")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
for (const phrase of ["正式公開を開始しました", "公開終了の予定はありません", "投稿データを初期化", "ガイド", "操作欄が消える不具合", "投稿、追記、一覧、難易度表"]) {
  assert.ok(launch.includes(phrase), `正式公開entryに「${phrase}」が含まれること`);
}

const latest = articles.find((entry) => entry.id === "CHANGELOG_20260905")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
for (const phrase of [
  "RC★・RC★★のタイトル表示を修正しました",
  "RC★とRC★★のHTMLページにおいて、前版の差分名が引き継がれる不具合を修正しました",
  "曲名と掲載版自身の差分名"
]) assert.ok(latest.includes(phrase), `最新entryに「${phrase}」を掲載すること`);
const filterAndAuthorUpdate = articles.find((entry) => entry.id === "CHANGELOG_20260813")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
for (const phrase of [
  "一覧の絞り込みと難易度表の作者表示を改善しました",
  "完成版のない譜面",
  "派生版がまだない制作途中の起点譜面",
  "投稿フォームで入力された作者名だけ",
  "譜面ファイル内の補助表記が重複して表示されない"
]) assert.ok(filterAndAuthorUpdate.includes(phrase), `2026-08-13 entryに「${phrase}」を掲載すること`);
const mineMiniView = articles.find((entry) => entry.id === "CHANGELOG_20260810")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
for (const phrase of [
  "地雷を含む譜面のミニビューを修正しました",
  "1P側の地雷を含む7key譜面",
  "地雷を通常ノートやLNと区別",
  "専用の色でミニビューへ表示"
]) assert.ok(mineMiniView.includes(phrase), `2026-08-10 entryに「${phrase}」を掲載すること`);
const appendProgress = articles.find((entry) => entry.id === "CHANGELOG_20260809")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
for (const phrase of [
  "追記投稿の入力と進捗色を修正しました",
  "ファイルをドロップしたあと、差分情報以降の入力欄が開かない不具合を修正",
  "制作途中・完成版を直接選べるようにし",
  "追記色をオレンジ、青、赤、紫の順",
  "今回手動で塗った箇所の色を保ち",
  "手動塗りが100%に達した場合"
]) assert.ok(appendProgress.includes(phrase), `2026-08-09 entryに「${phrase}」を掲載すること`);
const publicUiTouchup = articles.find((entry) => entry.id === "CHANGELOG_20260807")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
for (const phrase of [
  "コメント・進捗・一覧表示を整えました",
  "投稿者コメントを読みやすさを保ちつつ落ち着いた表示",
  "進捗率の色を投稿状態と揃え",
  "投稿一覧ではコメントを広く、操作をコンパクトに表示"
]) assert.ok(publicUiTouchup.includes(phrase), `2026-08-07 entryに「${phrase}」を掲載すること`);
const formUsability = articles.find((entry) => entry.id === "CHANGELOG_20260805")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
for (const phrase of [
  "投稿フォームと一覧の操作性を改善",
  "進捗マップの小節・時間・ノーツ情報を、カーソルの近くへ表示するよう修正しました。",
  "投稿状態の選択ボタンに左余白を加え、枠へ重ならないよう調整しました。",
  "投稿フォームを入力内容ごとの段階に整理し、必要な項目を追いやすくしました。",
  "トップページの投稿カードと投稿一覧を圧縮し、コメント・進捗・操作を保ったまま多くの投稿を見渡せるようにしました。"
]) assert.ok(formUsability.includes(phrase), `2026-08-05 entryに「${phrase}」を掲載すること`);
const difficultyTableUpdate = articles.find((entry) => entry.id === "CHANGELOG_20260804")?.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") || "";
assert.ok(difficultyTableUpdate.includes("RC★／RC★★の難易度表に完成版と没譜面が正しく掲載されるよう修正しました。"), "2026-08-04 entryに難易度表修正を掲載すること");
for (const removed of [
  "完成済み没譜面を明示して投稿できるようにしました。",
  "管理者が過去versionの投稿状態を修正できるようにしました。",
  "状態が不自然なversionを管理画面で確認できるようにしました。"
]) assert.equal(difficultyTableUpdate.includes(removed), false, `2026-08-04 entryから「${removed}」を除くこと`);

process.stdout.write(`FINAL_PUBLIC_CHANGELOG_TESTS passed entries=${articles.length} oldest=${dates.at(-1)} newest=${dates[0]}\n`);
