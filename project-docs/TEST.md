# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、D1 migration、BMS解析、仕様ドキュメントを確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## 今回確認するもの

PROG-02 Worker側BMS解析:

- 単体 `.bms` / `.bme` / `.bml` 投稿時にWorker側でBMS解析が実行されること
- `POST /api/charts` 成功レスポンスに `analysis` が含まれること
- `versions.play_notes` にプレイノート総数が保存されること
- `versions.first_note_measure` に最初のプレイノート小節が保存されること
- `versions.last_note_measure` に最後のプレイノート小節が保存されること
- `versions.target_measure_count` に対象小節数が保存されること
- `versions.measure_notes_json` に小節ごとのノート数JSONが保存されること
- `GET /api/charts` のversionレスポンスに `playNotes`, `firstNoteMeasure`, `lastNoteMeasure`, `targetMeasureCount`, `measureNotes` が返ること
- 途中の非プレイノート小節が `playNotes: 0` として `measureNotes.measures` に含まれること
- BGM/BPM/STOP/BGA/メタ情報がプレイノート数に含まれないこと
- LNの扱いがMVP方針 `count_start_only` になっていること
- ZIP投稿ではBMS解析値が `null` になること
- プレイノートがないBMSでは `BMS_NO_PLAY_NOTES` warning が返ること
- 解析に失敗しても投稿自体を失敗させず、`BMS_ANALYSIS_FAILED` warning と `post_logs.detail` に残す設計であること

FORM-03 UI:

- 投稿フォームが `譜面ファイル` / `楽曲情報` / `差分情報` / `進捗・管理` / `コメント` の意味単位に分かれていること
- 楽曲情報と差分情報が分かれていること
- 差分情報の中で、`想定難易度` → `仮差分名` → `差分作者` の順になっていること
- 仮差分名欄が大きなtextarea風ではなく、1行入力相当になっていること
- スマホ幅でも横スクロールせず表示されること

DIF-01 想定難易度UI:

- 想定難易度欄がシンボルタブ + 数字チップUIであること
- シンボルタブは `★` / `★★` / `sl` / `st` / `手入力` が表示されること
- シンボル切替時に想定難易度ブロックの枠の高さが変わらないこと
- 数字が常に1〜25表示されること
- PC表示で数字チップが1行10個になること
- `difficulty` と `level` が正しく送信されること
- 一覧では `difficulty` のみ表示され、`level` と重複表示されないこと

既存投稿処理:

- 既存の投稿処理が壊れていないこと
- 没譜面チェック時の進捗度100固定が壊れていないこと
- 管理パスワード保存が壊れていないこと
- 投稿成功後に `GET /api/charts` を再取得して一覧が更新されること
- APIエラーの `code`, `message`, `detail` が画面上部に表示されること
- 送信中に投稿ボタンがdisabledになり、二重送信を防げること

PROG-01 進捗グラフ設計:

- `worker/migrations/0003_progress_graph_fields.sql` が存在すること
- `schema/d1.sql` にPROG-01追加カラムが反映されていること
- `project-docs/SPEC.md` に進捗グラフ仕様が記載されていること
- `project-docs/API.md` に進捗グラフ関連レスポンス仕様が記載されていること
- `project-docs/DEPLOY.md` に0003 migration適用手順が記載されていること
- `measure_notes_json` の仕様が明記されていること
- `progress_map_json` の仕様が明記されていること
- progressは塗られた小節のunionで計算される仕様になっていること
- 没譜面は全塗り扱いになる仕様になっていること
- 進捗画像は譜面ファイルとは別R2 keyで保存される仕様になっていること
- `file_deleted_at` 後も進捗画像が残る仕様になっていること
- `is_hidden` と `collapsed_by_completion` が別扱いになっていること
- お気に入りはlocalStorage保存として定義されていること

## 今回確認しないもの

- フロント側進捗グラフUIの実装
- Canvas/SVG描画
- R2への進捗画像保存処理
- 初回投稿APIの `progress_map_json` 対応
- ZIP内部のBMS解析
- `POST /api/charts/:chartId/versions`
- 追記投稿
- 取り下げ
- 削除申請
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理

## PROG-02 テスト用BMSファイル

PowerShellで作成する。

```powershell
@"
#PLAYER 1
#TITLE Test Chart
#ARTIST Test Artist
#BPM 120
#00111:0102
#00211:0000
#00311:01000002
#00301:01010101
#00303:120
"@ | Set-Content -Encoding UTF8 .\prog02-analysis-test.bms
```

期待される解析結果:

- `#00111:0102` は2ノート
- `#00211:0000` は0ノート
- `#00311:01000002` は2ノート
- `#00301:01010101` はBGMなのでカウントしない
- `#00303:120` はBPMなのでカウントしない
- `playNotes=4`
- `firstNoteMeasure=1`
- `lastNoteMeasure=3`
- `targetMeasureCount=3`
- `measureNotes.measures` は `1, 2, 3` を含み、小節2は `playNotes: 0`

期待される `measureNotes`:

```json
{
  "schemaVersion": 1,
  "firstMeasure": 1,
  "lastMeasure": 3,
  "targetMeasureCount": 3,
  "playNotes": 4,
  "lnPolicy": "count_start_only",
  "measures": [
    { "measure": 1, "playNotes": 2 },
    { "measure": 2, "playNotes": 0 },
    { "measure": 3, "playNotes": 2 }
  ]
}
```

## PROG-02 curl.exe確認

ローカルWorkerを起動する。

```bash
cd worker
npx wrangler dev
```

別ターミナルで投稿する。

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\prog02-analysis-test.bms;type=text/plain" `
  -F "title=Test Chart" `
  -F "subtitle=" `
  -F "artist=Test Artist" `
  -F "subartist=" `
  -F "chartName=PROG-02 Test" `
  -F "difficulty=★12" `
  -F "level=12" `
  -F "author=tester" `
  -F "progress=50" `
  -F "comment=PROG-02 analysis test" `
  -F "isRejected=false" `
  -F "password=test-password"
```

期待レスポンス:

- HTTP 201
- `analysis.playNotes` が `4`
- `analysis.firstNoteMeasure` が `1`
- `analysis.lastNoteMeasure` が `3`
- `analysis.targetMeasureCount` が `3`
- `analysis.measureNotes.measures[1]` が `{ "measure": 2, "playNotes": 0 }`
- `warnings` は空配列、またはメタデータ等の非致命的警告のみ

同じファイルを再投稿した場合は既存仕様通り `DUPLICATE_FILE` になるため、再確認時はファイル内容を少し変えるかD1/R2を初期化する。

## PROG-02 GET /api/charts確認

```powershell
curl.exe "http://localhost:8787/api/charts?page=1&pageSize=100"
```

期待レスポンス:

- `charts[0].versions[0].playNotes` が `4`
- `charts[0].versions[0].firstNoteMeasure` が `1`
- `charts[0].versions[0].lastNoteMeasure` が `3`
- `charts[0].versions[0].targetMeasureCount` が `3`
- `charts[0].versions[0].measureNotes` がJSON objectとして返る
- `measureNotes.lnPolicy` が `count_start_only`

## PROG-02 DB確認SQL

D1に保存された解析値を確認する。

```sql
SELECT
  id,
  play_notes,
  first_note_measure,
  last_note_measure,
  target_measure_count,
  measure_notes_json
FROM versions
ORDER BY created_at DESC
LIMIT 1;
```

期待結果:

- `play_notes = 4`
- `first_note_measure = 1`
- `last_note_measure = 3`
- `target_measure_count = 3`
- `measure_notes_json` に `"playNotes":4` と `"measure":2,"playNotes":0` 相当の内容が含まれる

## PROG-02 ノートなしBMS確認

```powershell
@"
#PLAYER 1
#TITLE No Notes
#ARTIST Test Artist
#BPM 120
#00101:01010101
#00103:120
"@ | Set-Content -Encoding UTF8 .\prog02-no-notes.bms
```

投稿後の期待結果:

- 投稿自体は成功する
- `analysis.playNotes` は `0`
- `analysis.firstNoteMeasure` は `null`
- `analysis.lastNoteMeasure` は `null`
- `analysis.targetMeasureCount` は `0`
- `analysis.measureNotes.measures` は空配列
- `warnings` に `BMS_NO_PLAY_NOTES` が含まれる

## PROG-02 ZIP投稿確認

ZIP投稿時の期待結果:

- 投稿自体は既存仕様通り受け付ける
- ZIP内部解析は未実装
- `analysis` は `null`
- DB上の `play_notes`, `first_note_measure`, `last_note_measure`, `target_measure_count`, `measure_notes_json` は `null`

## PROG-01 D1 migration確認

### Wranglerで確認する場合

ローカルD1に適用する。

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
```

remote D1に適用する。

```bash
cd worker
npx wrangler d1 migrations list wip-bms-charts-db
npx wrangler d1 migrations apply wip-bms-charts-db
```

追加カラム確認SQL:

```sql
SELECT name FROM pragma_table_info('versions')
WHERE name IN (
  'play_notes',
  'first_note_measure',
  'last_note_measure',
  'target_measure_count',
  'measure_notes_json',
  'progress_map_json',
  'progress_image_key',
  'progress_image_mime',
  'progress_image_size',
  'progress_image_sha256',
  'progress_image_created_at',
  'collapsed_by_completion',
  'collapsed_reason',
  'collapsed_at',
  'collapsed_by_version_id'
)
ORDER BY name;
```

期待結果:

- 上記15カラムが返る。
- 既存の `versions` 行は物理削除されない。

追加index確認SQL:

```sql
SELECT name FROM sqlite_master
WHERE type='index'
  AND name IN (
    'idx_versions_measure_range',
    'idx_versions_progress_image_key',
    'idx_versions_collapsed_completion',
    'idx_versions_collapsed_by_version'
  )
ORDER BY name;
```

期待結果:

- 上記4 indexが返る。

### Dashboardから確認する場合

1. Cloudflare Dashboardを開く。
2. Workers & Pages から D1 を開く。
3. database `wip-bms-charts-db` を選択する。
4. Console または Query 画面を開く。
5. `worker/migrations/0003_progress_graph_fields.sql` の内容を実行する。
6. `PRAGMA table_info(versions);` で追加カラムを確認する。
7. `sqlite_master` で追加indexを確認する。

Dashboard実行時はmigration履歴には記録されないため、以後Wrangler migrationsで管理する場合はDashboard実行とWrangler実行を混在させない。

## GitHub Pages表示確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 投稿フォームが `譜面ファイル` / `楽曲情報` / `差分情報` / `進捗・管理` / `コメント` の順に分かれていることを確認する。
3. 差分情報内の導線が `想定難易度` → `仮差分名` → `差分作者` の順であることを確認する。
4. 初期表示時に上部エラー欄や各入力欄が赤エラーだらけになっていないことを確認する。
5. 通常フォームに `level` 入力欄がないことを確認する。
6. 投稿一覧に本番Workerの `GET /api/charts` の結果が表示されることを確認する。
7. 一覧の想定難易度が `difficulty` のみで表示され、`★12 / 12` や `st5 / 5` のような `level` 併記にならないことを確認する。

## DIF-01 想定難易度UI確認

1. 初期表示で `★` タブが選択状態、数字は未選択、プレビューが `未選択` であることを確認する。
2. `★` タブで数字が1〜25すべて表示され、disabledがないことを確認する。
3. PC幅で数字チップが `1〜10`, `11〜20`, `21〜25` の3行に分かれることを確認する。
4. `★★` タブに切り替え、1〜7が選択可能で8〜25がdisabledになることを確認する。
5. `sl` タブに切り替え、1〜12が選択可能で13〜25がdisabledになることを確認する。
6. `st` タブに切り替え、1〜15が選択可能で16〜25がdisabledになることを確認する。
7. `★25` を選択した後に `★★` へ切り替え、プレビューが `★★7` になることを確認する。
8. 手入力に切り替えても想定難易度ブロックの外枠高さが変わらないことを確認する。
9. `overjoy` を入力し、プレビューが `overjoy` になることを確認する。
10. `100` や `st100` のように数字が3桁以上になる入力が拒否される、または3桁目が入力できないことを確認する。

## BMSメタデータ自動読取確認

1. GitHub Pages画面を開く。
2. `prog02-analysis-test.bms` を選択する。
3. `#TITLE` と `#ARTIST` が曲名/アーティスト欄へ自動入力されることを確認する。
4. 曲名/アーティスト欄は手修正できることを確認する。

## 没譜面チェック確認

1. 没譜面チェックをONにする。
2. 進捗度欄が `100` 表示になることを確認する。
3. 進捗度欄が編集不可に見えることを確認する。
4. 没譜面チェックをOFFにする。
5. 進捗度欄が編集可能に戻ることを確認する。

API側でも `isRejected=true` の場合は `progress=100` に強制されるため、ブラウザ側の表示は補助扱いとする。

## GitHub Pagesから初回投稿確認

1. GitHub Pages画面を開く。
2. `prog02-analysis-test.bms` を選択する。
3. 曲名とアーティストが自動入力されることを確認する。
4. 差分情報セクションで想定難易度、仮差分名、差分作者を入力する。
5. 進捗・管理セクションで進捗度、管理パスワード、必要なら没譜面やパスワード保存を設定する。
6. コメントを入力する。
7. 「投稿する」を押す。
8. 送信中は投稿ボタンがdisabledになることを確認する。
9. 投稿成功後、一覧が再取得され、新しい投稿が表示されることを確認する。
10. 一覧の想定難易度が `★12` と表示され、`★12 / 12` にならないことを確認する。

## 管理パスワード保存確認

1. 管理パスワードを入力する。
2. 「パスワードを保存」をONにする。
3. 投稿する、またはチェック状態を変更する。
4. ページを再読み込みする。
5. 管理パスワード欄に保存値が復元されることを確認する。
6. 「パスワードを保存」をOFFにするとlocalStorageから削除されることを確認する。

## APIエラー表示確認

意図的に重複ファイルを投稿するなどしてAPIエラーを発生させる。

期待表示例:

```text
code: DUPLICATE_FILE
message: 同じファイルは投稿できません。
detail: A version with the same file_sha256 already exists.
```
