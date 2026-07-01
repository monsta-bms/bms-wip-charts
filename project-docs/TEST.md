# テスト手順

## Phase 10-FEの対象

Phase 10-FEでは、GitHub Pages の静的フロント画面が本番Worker APIへ接続できることを確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

今回確認するもの:

- GitHub Pages画面から `GET /api/charts` を呼び、一覧を表示できること
- 投稿フォームから `multipart/form-data` で `POST /api/charts` へ送信できること
- 初回投稿フォームに見える `level` 入力欄がないこと
- 投稿成功後に `GET /api/charts` を再取得して一覧が更新されること
- 一覧の想定難易度が `difficulty` のみで表示され、`★11 / 12` のような併記にならないこと
- `difficulty` から内部値 `level` が可能な範囲で保存されること
- APIエラーの `code`, `message`, `detail` が画面上部に表示されること
- 送信中に投稿ボタンがdisabledになり、二重送信を防げること
- 管理パスワードをlocalStorageへ保存できること
- `isRejected=true` の場合、画面上でも `progress=100` 扱いに見えること
- DLリンクが本番Worker URLへ向いていること
- CORSで `https://monsta-bms.github.io` が許可されていること

今回確認しないもの:

- DB migration
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

## Worker deploy前の確認

`worker/wrangler.toml` の `[vars]` に以下が入っていることを確認する。

```toml
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

D1/R2 bindingが設定済みであることを確認する。

```toml
[[d1_databases]]
binding = "DB"
database_name = "wip-bms-charts-db"

[[r2_buckets]]
binding = "FILES"
bucket_name = "wip-bms-charts-files"
```

必要なCloudflare secrets:

- `HASH_SECRET`
- `ADMIN_TOKEN`

設定例:

```bash
cd worker
npx wrangler secret put HASH_SECRET
npx wrangler secret put ADMIN_TOKEN
```

## Worker deploy

```bash
cd worker
npm install
npm run typecheck
npm run deploy
```

`worker/src/routes/charts.ts` を変更しているため、level自動抽出を本番反映するにはWorker deployが必要。

## API単体確認

```bash
curl.exe "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/health"
curl.exe "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/charts?page=1&pageSize=100"
```

CORS preflight確認例:

```bash
curl.exe -i -X OPTIONS "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/charts" ^
  -H "Origin: https://monsta-bms.github.io" ^
  -H "Access-Control-Request-Method: POST" ^
  -H "Access-Control-Request-Headers: Content-Type"
```

期待する主なヘッダー:

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://monsta-bms.github.io
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
```

## GitHub Pages表示確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 初回投稿フォームに「想定難易度」はあり、「level」の見える入力欄がないことを確認する。
3. 投稿一覧に本番Workerの `GET /api/charts` の結果が表示されることを確認する。
4. 一覧の想定難易度が `difficulty` のみで表示されることを確認する。
5. `★11 / 12` や `st5 / 5` のような `level` 併記が表示されないことを確認する。
6. データが0件の場合は「投稿はまだありません。」が表示されることを確認する。
7. ブラウザの開発者ツールでCORSエラーが出ていないことを確認する。

## テスト用BMSファイル作成例

PowerShell例:

```powershell
@"
#PLAYER 1
#TITLE Test Song Difficulty Display
#ARTIST Test Artist
#PLAYLEVEL 3
#BPM 120
#00111:01
"@ | Set-Content -Encoding UTF8 .\difficulty-display-test.bms
```

## GitHub Pagesから初回投稿確認

1. GitHub Pages画面を開く。
2. `difficulty-display-test.bms` を選択する。
3. `#TITLE` と `#ARTIST` が曲名/アーティスト欄へ自動入力されることを確認する。
4. 差分名、想定難易度、差分作者、進捗度、コメント、管理パスワードを入力する。
5. 想定難易度に `★12` を入力する。
6. 「投稿する」を押す。
7. 送信中は投稿ボタンがdisabledになることを確認する。
8. 投稿成功後、一覧が再取得され、新しい投稿が表示されることを確認する。
9. 一覧の想定難易度が `★12` と表示され、`★12 / 12` にならないことを確認する。
10. DLリンクが `https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/files/...` を指すことを確認する。

## level内部値確認

`difficulty` から `level` が抽出されることをAPIまたはD1で確認する。

確認例:

| difficulty | 期待するlevel |
| --- | --- |
| `★12` | `12` |
| `st5` | `5` |
| `sl8` | `8` |
| `12` | `12` |

D1確認例:

```bash
cd worker
npx wrangler d1 execute wip-bms-charts-db --command "SELECT difficulty, level FROM versions WHERE title LIKE '%Difficulty Display%' ORDER BY created_at DESC LIMIT 5;"
```

抽出できない `difficulty` の場合、`level` は空または `NULL` でよい。

## isRejected=true確認

1. 没譜面チェックをONにする。
2. 進捗度欄が `100` 表示になり、編集不可に見えることを確認する。
3. 投稿する。
4. 一覧で `100%` と没譜面バッジが表示されることを確認する。

API側でも `progress=100` に強制されるため、ブラウザ側の表示は補助扱いとする。

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

## CORSエラー時の確認

画面上で通信に失敗し、ブラウザコンソールにCORSエラーが出る場合は以下を確認する。

- `worker/wrangler.toml` に `ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"` があること
- `npm run deploy` 済みであること
- GitHub Pages URLではなくOrigin `https://monsta-bms.github.io` を許可していること

## テストデータ削除

必要に応じてD1とR2のテストデータを削除する。

D1は外部キーがあるため、versionから順に削除する。

```sql
DELETE FROM post_logs WHERE detail LIKE '%Initial chart version created.%' OR error_code IS NOT NULL;
DELETE FROM versions WHERE title LIKE '%Difficulty Display%';
DELETE FROM charts WHERE chart_name IN ('[REJECTED]', '[NORMAL]', '[INVALID]');
DELETE FROM songs WHERE title LIKE '%Difficulty Display%';
```

R2は `charts/{chartId}/versions/root/` 配下のテストファイルをDashboardから削除する。
