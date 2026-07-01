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
- `schema/d1.sql`

作成されるテーブル:

- `songs`
- `charts`
- `versions`
- `delete_requests`
- `post_logs`
- `bans`
- `admin_logs`

### Wranglerで適用する場合

```bash
cd worker
npx wrangler d1 migrations list wip-bms-charts-db
npx wrangler d1 migrations apply wip-bms-charts-db
```

ローカル確認:

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

### DashboardからSQL実行する場合

1. Cloudflare Dashboardを開く。
2. Workers & Pages から D1 を開く。
3. database `wip-bms-charts-db` を選択する。
4. Console または Query 画面を開く。
5. `schema/d1.sql` の内容を貼り付ける。
6. SQLを実行する。
7. `songs`, `charts`, `versions`, `delete_requests`, `post_logs`, `bans`, `admin_logs` が作成されたことを確認する。

Dashboard実行時はmigration履歴には記録されないため、以後Wrangler migrationsで管理する場合はDashboard実行とWrangler実行を混在させない。

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

## 確認手順

- GitHub Pages の公開元が `main` ブランチの `/docs` になっていることを確認する。
- `https://monsta-bms.github.io/bms-wip-charts/` を開く。
- ブラウザ画面に本番Workerの `GET /api/charts` の結果が表示されることを確認する。
- 投稿フォームから `.bms`, `.bme`, `.bml`, `.zip` のいずれかを投稿する。
- 投稿成功後に一覧が自動更新されることを確認する。
- DLリンクが `https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/files/...` を指すことを確認する。
- CORSエラーが出る場合は、`ALLOWED_ORIGINS` に `https://monsta-bms.github.io` が含まれていることを確認する。
- `HASH_SECRET` と `ADMIN_TOKEN` がCloudflare secretsに設定されていることを確認する。
