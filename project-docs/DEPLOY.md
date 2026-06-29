# デプロイ手順

## 対象

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/wipbmschart/

## GitHub Pages

静的UIは `docs/` 配下を公開対象とする。

GitHub Pages の設定:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

設定後、以下のURLで公開される想定とする。

https://monsta-bms.github.io/wipbmschart/

## Cloudflare Worker

Worker本体:

- `worker/src/index.ts`

主な設定:

- TypeScript
- CORS対応
- `ALLOWED_ORIGIN` 環境変数
- D1 binding `DB`
- R2 binding `FILES`
- secrets `HASH_SECRET`, `ADMIN_TOKEN`

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

Phase 10-A改で以下を追加仕様込みで再設計した。

- `worker/migrations/0001_initial.sql`
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

### 旧schemaを既に適用済みだった場合のリセット

Phase 10-A改は本番データなし前提で `0001_initial.sql` を上書き再設計している。

既にMVP版の旧schemaをD1へ適用済みで、保存すべきデータがない場合は、以下のどちらかでリセットする。

#### 推奨: D1 databaseを作り直す

まだ本番データがない場合、最も安全で分かりやすい方法。

1. Cloudflare Dashboardで既存D1 databaseを削除する。
2. 同名 `wip-bms-charts-db` でD1 databaseを作り直す。
3. 新しい `database_id` を確認する。
4. `worker/wrangler.toml` の `database_id` を新しい値に更新する。
5. `worker/migrations/0001_initial.sql` を適用する。

この方法では `database_id` が変わるため、`wrangler.toml` の更新を忘れない。

#### 既存databaseを使い続ける場合

DashboardのQuery画面で、外部キー参照の子テーブルから順に削除する。

```sql
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS delete_requests;
DROP TABLE IF EXISTS post_logs;
DROP TABLE IF EXISTS bans;
DROP TABLE IF EXISTS admin_logs;
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS charts;
DROP TABLE IF EXISTS songs;
DROP TABLE IF EXISTS d1_migrations;
PRAGMA foreign_keys = ON;
```

その後、`schema/d1.sql` をDashboardで実行するか、Wrangler migrationを再適用する。

`d1_migrations` を削除するとWranglerの適用履歴も消えるため、Dashboard実行とWrangler実行を混在させないこと。

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

`ALLOWED_ORIGIN` は通常のCloudflare Worker環境変数として扱う。

公開URLが確定したら、`worker/wrangler.toml` の `[vars]` またはCloudflare Dashboardで実際のフロントURLに更新する。

例:

```toml
[vars]
ALLOWED_ORIGIN = "https://example.com"
```

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

管理APIのスタブ確認には `ADMIN_TOKEN` secret またはローカル用のsecret設定が必要。

## デプロイ手順

公開URLと `ALLOWED_ORIGIN` が確定してから実行する。

```bash
cd worker
npm install
npm run typecheck
npm run deploy
```

## 確認手順

- GitHub Pages の公開元が `main` ブランチの `/docs` になっていることを確認する。
- `worker/wrangler.toml` にD1 binding `DB` とR2 binding `FILES` が設定されていることを確認する。
- Cloudflare側でD1 database `wip-bms-charts-db` とR2 bucket `wip-bms-charts-files` が存在することを確認する。
- D1に `0001_initial.sql` を適用し、7つのテーブルが存在することを確認する。
- `ALLOWED_ORIGIN` を実際のフロントURLに設定する。
- `HASH_SECRET` と `ADMIN_TOKEN` をCloudflare secretsに設定する。
- `/api/health` がJSONで `status: "ok"` を返すことを確認する。
