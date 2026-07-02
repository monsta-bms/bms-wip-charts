# デプロイ手順

## 対象

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/bms-wip-charts/
- 本番Worker URL: https://bms-wip-charts-worker.monsta3228gsl.workers.dev

## GitHub Pages

静的UIは `docs/` 配下を公開対象とする。

GitHub Pages の設定:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

設定後、以下のURLで公開される想定とする。

https://monsta-bms.github.io/bms-wip-charts/

ブラウザのOriginはパスを含まないため、WorkerのCORSでは `https://monsta-bms.github.io` を許可する。

## フロント設定

`docs/app.js` の `API_BASE_URL` は本番Worker URLを指す。

```js
const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
```

GitHub Pages側は以下を行う。

- ページ表示時に `GET /api/charts` を呼ぶ。
- 投稿フォームから `multipart/form-data` で `POST /api/charts` へ送る。
- 投稿成功後に `GET /api/charts` を再取得する。
- `version.file.downloadUrl` を `API_BASE_URL` と結合してDLリンクを表示する。

## Cloudflare Worker

Worker本体:

- `worker/src/index.ts`

主な設定:

- TypeScript
- CORS対応
- `ALLOWED_ORIGINS` 環境変数
- D1 binding `DB`
- R2 binding `FILES`
- secrets `HASH_SECRET`, `ADMIN_TOKEN`

`worker/wrangler.toml` の `[vars]` では以下を設定する。

```toml
[vars]
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

`ALLOWED_ORIGINS` はカンマ区切りで複数Originを許可できる。後方互換として `ALLOWED_ORIGIN` も読み取るが、今後は `ALLOWED_ORIGINS` を使う。

## Cloudflare D1

作成済みD1 database:

- database_name: `wip-bms-charts-db`
- database_id: `d55ed399-5a31-43a0-89d4-9bd2f32ba3a7`
- Worker binding: `DB`

`worker/wrangler.toml` の設定:

```toml
[[d1_databases]]
binding = "DB"
database_name = "wip-bms-charts-db"
database_id = "d55ed399-5a31-43a0-89d4-9bd2f32ba3a7"
```

### D1 schema / migration

schema / migration:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `worker/migrations/0003_progress_graph_fields.sql`
- `schema/d1.sql`

作成されるテーブル:

- `songs`
- `charts`
- `versions`
- `delete_requests`
- `post_logs`
- `bans`
- `admin_logs`

PROG-01の `0003_progress_graph_fields.sql` は、既存の `versions` テーブルへ進捗グラフ用カラムを追加する。

追加対象:

- BMS解析結果: `play_notes`, `first_note_measure`, `last_note_measure`, `target_measure_count`, `measure_notes_json`
- 進捗塗り情報: `progress_map_json`
- 進捗画像metadata: `progress_image_key`, `progress_image_mime`, `progress_image_size`, `progress_image_sha256`, `progress_image_created_at`
- 完成後折り畳み状態: `collapsed_by_completion`, `collapsed_reason`, `collapsed_at`, `collapsed_by_version_id`

### Wranglerで適用する場合

remote D1へ適用:

```bash
cd worker
npx wrangler d1 migrations list wip-bms-charts-db
npx wrangler d1 migrations apply wip-bms-charts-db
```

ローカルD1へ適用:

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
npx wrangler d1 execute wip-bms-charts-db --local --command "PRAGMA table_info(versions);"
```

0003適用確認SQL例:

```sql
SELECT name FROM pragma_table_info('versions')
WHERE name IN (
  'play_notes',
  'measure_notes_json',
  'progress_map_json',
  'progress_image_key',
  'collapsed_by_completion'
)
ORDER BY name;
```

index確認SQL例:

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

### DashboardからSQL実行する場合

1. Cloudflare Dashboardを開く。
2. Workers & Pages から D1 を開く。
3. database `wip-bms-charts-db` を選択する。
4. Console または Query 画面を開く。
5. `worker/migrations/0003_progress_graph_fields.sql` の内容を貼り付ける。
6. SQLを実行する。
7. `PRAGMA table_info(versions);` でPROG-01の追加カラムを確認する。

Dashboard実行時はmigration履歴には記録されないため、以後Wrangler migrationsで管理する場合はDashboard実行とWrangler実行を混在させない。

`schema/d1.sql` はDashboardで新規DBへまとめて適用するための最新状態ファイルとして扱う。既にmigration適用済みのDBでは、`schema/d1.sql` ではなくmigrationを適用する。

## Cloudflare R2

作成済みR2 bucket:

- bucket_name: `wip-bms-charts-files`
- Worker binding: `FILES`
- 保存形式: Standardのみ

`worker/wrangler.toml` の設定:

```toml
[[r2_buckets]]
binding = "FILES"
bucket_name = "wip-bms-charts-files"
```

R2使用量が8GBを超えた場合は、管理ログに警告を出す仕様とする。

PROG-01の進捗画像は将来R2へ保存する想定だが、今回R2保存処理は実装しない。

将来の進捗画像保存キー例:

```text
charts/{chartId}/versions/{versionId}/progress/progress.png
```

譜面ファイル本体が `file_deleted_at` で削除済みになっても、進捗画像は残す。

## 環境変数

通常のCloudflare Worker環境変数:

- `ALLOWED_ORIGINS`

設定例:

```toml
[vars]
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

GitHub PagesのURLは `https://monsta-bms.github.io/bms-wip-charts/` だが、CORSに設定するOriginは `https://monsta-bms.github.io` である。

## 秘密情報

APIキー、トークン、ハッシュ用secretなどの秘密情報はソースコードに直書きしない。

Cloudflare WorkerではCloudflare secretsを使う。

想定secret:

- `HASH_SECRET`
- `ADMIN_TOKEN`

設定例:

```bash
cd worker
npx wrangler secret put HASH_SECRET
npx wrangler secret put ADMIN_TOKEN
```

## ローカル確認手順

```bash
cd worker
npm install
npm run typecheck
npm run dev
```

別のターミナルで確認する。

```bash
curl http://localhost:8787/api/health
curl http://localhost:8787/api/charts
```

D1 migrationをローカルで確認する場合:

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
```

## デプロイ手順

```bash
cd worker
npm install
npm run typecheck
npm run deploy
```

`wrangler.toml` の `[vars]` を変更した場合も、Workerを再deployする。

PROG-01ではWorker本体の実装を変更しないため、DB migrationだけで仕様準備は完了する。Worker本体が進捗グラフAPIを返すようになるのは後続フェーズとする。

## 確認手順

- GitHub Pages の公開元が `main` ブランチの `/docs` になっていることを確認する。
- `https://monsta-bms.github.io/bms-wip-charts/` を開く。
- ブラウザ画面に本番Workerの `GET /api/charts` の結果が表示されることを確認する。
- 投稿フォームから `.bms`, `.bme`, `.bml`, `.zip` のいずれかを投稿する。
- 投稿成功後に一覧が自動更新されることを確認する。
- DLリンクが `https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/files/...` を指すことを確認する。
- CORSエラーが出る場合は、`ALLOWED_ORIGINS` に `https://monsta-bms.github.io` が含まれていることを確認する。
- `HASH_SECRET` と `ADMIN_TOKEN` がCloudflare secretsに設定されていることを確認する。
