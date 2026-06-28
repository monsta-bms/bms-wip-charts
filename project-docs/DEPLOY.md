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

Phase 9ではCloudflare Workerの雛形を `worker/` 配下に作成する。

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
- `ALLOWED_ORIGIN` を実際のフロントURLに設定する。
- `HASH_SECRET` と `ADMIN_TOKEN` をCloudflare secretsに設定する。
- `/api/health` がJSONで `status: "ok"` を返すことを確認する。
