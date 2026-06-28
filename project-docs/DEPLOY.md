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

現時点では `worker/wrangler.toml` は未作成のため、Workerのデプロイ手順は未確定とする。

## 秘密情報

APIキー、トークン、ハッシュ用secretなどの秘密情報はソースコードに直書きしない。

Cloudflare Worker 実装時は Cloudflare secrets を使う。

## 確認手順

- GitHub Pages の公開元が `main` ブランチの `/docs` になっていることを確認する。
- https://monsta-bms.github.io/wipbmschart/ を開き、静的UIが表示されることを確認する。
- リポジトリ名と公開URLが新しい内容になっていることを確認する。
