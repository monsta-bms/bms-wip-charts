# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、D1 migration、仕様ドキュメントを確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## 今回確認するもの

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
- BMS解析により `play_notes` を保存できる設計になっていること
- `first_note_measure` / `last_note_measure` / `target_measure_count` を保存できる設計になっていること
- `measure_notes_json` の仕様が明記されていること
- `progress_map_json` の仕様が明記されていること
- progressは塗られた小節のunionで計算される仕様になっていること
- 途中の非プレイノート小節も進捗対象に含まれる仕様になっていること
- 没譜面は全塗り扱いになる仕様になっていること
- 完成ボタンは `progress>=80` で有効化される仕様になっていること
- 完成ボタンで未塗り小節が `completion_fill` として塗られる仕様になっていること
- 進捗画像は譜面ファイルとは別R2 keyで保存される仕様になっていること
- `file_deleted_at` 後も進捗画像が残る仕様になっていること
- `is_hidden` と `collapsed_by_completion` が別扱いになっていること
- `collapsed_by_completion` のversionは展開表示で確認できる仕様になっていること
- お気に入りはlocalStorage保存として定義されていること

## 今回確認しないもの

- Worker側BMS解析の本実装
- フロント側進捗グラフUIの実装
- Canvas/SVG描画
- R2への進捗画像保存処理
- 初回投稿APIの `progress_map_json` 対応
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
- 既存の投稿APIはこのmigrationだけでは挙動変更しない。

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

## PROG-01 JSON仕様確認

### measure_notes_json

仕様に以下が含まれることを確認する。

```json
{
  "schemaVersion": 1,
  "firstMeasure": 12,
  "lastMeasure": 87,
  "targetMeasureCount": 76,
  "playNotes": 1234,
  "lnPolicy": "count_start_only",
  "measures": [
    { "measure": 12, "playNotes": 8 },
    { "measure": 13, "playNotes": 0 }
  ]
}
```

確認項目:

- `firstMeasure` は最初にプレイノートが出る小節。
- `lastMeasure` は最後にプレイノートがある小節。
- `targetMeasureCount` は対象小節数。
- 途中の非プレイノート小節も `playNotes: 0` として含む。
- `lnPolicy` はMVPでは `count_start_only`。
- BGM/BPM/STOP/メタ情報はプレイノート数に含めない。

### progress_map_json

仕様に以下が含まれることを確認する。

```json
{
  "schemaVersion": 1,
  "firstMeasure": 12,
  "lastMeasure": 87,
  "targetMeasureCount": 76,
  "layers": [
    {
      "versionId": "version_xxx",
      "color": "#2f80ed",
      "kind": "normal",
      "ranges": [[12, 18], [22, 25]]
    },
    {
      "versionId": "version_yyy",
      "color": "#27ae60",
      "kind": "followup",
      "ranges": [[18, 24]]
    }
  ],
  "progress": 45
}
```

確認項目:

- 塗りはversionごとのlayerで持つ。
- 追記時は親versionのlayersを引き継ぐ。
- 重ね塗りは可能。
- progressは全layerのunionで算出する。
- 同じ小節が複数layerで塗られていても、進捗計算では1小節として数える。
- `kind` に `normal`, `followup`, `rejected_auto_fill`, `completion_fill` が定義されている。

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

## テスト用BMSファイル作成例

PowerShell例:

```powershell
@"
#PLAYER 1
#TITLE Test Song Difficulty Stable
#ARTIST Test Artist
#PLAYLEVEL 3
#BPM 120
#00111:01
"@ | Set-Content -Encoding UTF8 .\difficulty-stable-test.bms
```

## BMSメタデータ自動読取確認

1. GitHub Pages画面を開く。
2. `difficulty-stable-test.bms` を選択する。
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
2. `difficulty-stable-test.bms` を選択する。
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
