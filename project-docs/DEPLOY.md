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

バックエンドは今後 Cloudflare Worker として実装する想定。

現時点では Worker本体は未実装で、`worker/wrangler.toml` にはD1/R2 binding設定案のみを置く。

Worker本体の実装開始時に、`worker/wrangler.toml` へ `main = "src/index.ts"` などのエントリポイントを追加する。

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
- Worker binding: `CHART_FILES`
- 保存形式: Standardのみ

`worker/wrangler.toml` の設定:

```toml
[[r2_buckets]]
binding = "CHART_FILES"
bucket_name = "wip-bms-charts-files"
```

R2使用量が8GBを超えた場合は、管理ログに警告を出す仕様とする。

## 秘密情報

APIキー、トークン、ハッシュ用secretなどの秘密情報はソースコードに直書きしない。

Cloudflare Worker 実装時は Cloudflare secrets を使う。

想定secret:

- `HASH_SECRET`
- `ADMIN_TOKEN`

設定例:

```bash
wrangler secret put HASH_SECRET
wrangler secret put ADMIN_TOKEN
```

## 確認手順

- GitHub Pages の公開元が `main` ブランチの `/docs` になっていることを確認する。
- https://monsta-bms.github.io/wipbmschart/ を開き、静的UIが表示されることを確認する。
- `worker/wrangler.toml` にD1 binding `DB` とR2 binding `CHART_FILES` が設定されていることを確認する。
- Cloudflare側でD1 database `wip-bms-charts-db` とR2 bucket `wip-bms-charts-files` が存在することを確認する。
- secrets が必要になった段階で、Cloudflare secrets に設定し、ソースコードに直書きしていないことを確認する。
