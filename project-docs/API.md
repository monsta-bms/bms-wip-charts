# API仕様

## 概要

Phase 9ではCloudflare Workerの雛形だけを実装する。

D1書き込み、R2保存、BMSメタデータ読取、zip検査、IP/UAレート制限、Turnstile、フロント接続はまだ実装しない。

## 共通仕様

### Base URL

Workerの公開URLはデプロイ後に確定する。

ローカル確認時は以下を想定する。

```text
http://localhost:8787
```

### CORS

CORSは `ALLOWED_ORIGIN` 環境変数で許可Originを制御する。

`Origin` ヘッダーがあるリクエストで `ALLOWED_ORIGIN` と一致しない場合は、JSONエラーを返す。

### エラーレスポンス

APIエラーは必ず以下のJSON形式で返す。

```json
{
  "code": "ERROR_CODE",
  "message": "ユーザー向けの短い説明",
  "detail": "原因追跡に使える詳細情報"
}
```

### Secrets

以下はCloudflare secretsで設定する。

- `HASH_SECRET`
- `ADMIN_TOKEN`

秘密情報はソースコードや `wrangler.toml` に直書きしない。

## エンドポイント

### GET /api/health

Workerが動いているか確認する。

Phase 9ではbindingやsecretの存在有無もbooleanで返す。

レスポンス例:

```json
{
  "status": "ok",
  "service": "bms-wip-charts-worker",
  "phase": "phase-9",
  "bindings": {
    "db": true,
    "files": true,
    "allowedOrigin": true,
    "hashSecret": true,
    "adminToken": true
  }
}
```

### GET /api/charts

投稿一覧を取得する。

Phase 9ではD1読み取り未実装のため、空配列のダミー応答を返す。

### POST /api/charts

新規曲として初回投稿する。

Phase 9ではD1書き込み、R2保存、BMSメタデータ読取、zip検査は行わず、ダミー応答を返す。

### POST /api/charts/:chartId/versions

既存曲へ追記投稿する。

Phase 9ではD1書き込み、R2保存、zip検査は行わず、ダミー応答を返す。

### GET /api/files/:fileId

投稿ファイルを取得する。

Phase 9ではR2取得未実装のため、JSONのダミー応答を返す。

### POST /api/admin/hide-version

管理人が指定バージョンを非表示にする。

`Authorization: Bearer <ADMIN_TOKEN>` が必要。

Phase 9では実際のD1更新は行わず、ダミー応答を返す。

### POST /api/admin/ban

管理人がIPハッシュまたはUAハッシュをBANする。

`Authorization: Bearer <ADMIN_TOKEN>` が必要。

Phase 9では実際のD1更新は行わず、ダミー応答を返す。

## Phase 9で返す主なエラー

| code | HTTP status | 内容 |
| --- | --- | --- |
| `CORS_ORIGIN_NOT_ALLOWED` | 403 | `ALLOWED_ORIGIN` とリクエストOriginが一致しない。 |
| `METHOD_NOT_ALLOWED` | 405 | 許可されていないHTTPメソッド。 |
| `NOT_FOUND` | 404 | 対応するAPIがない。 |
| `INVALID_CHART_ID` | 400 | `chartId` が空。 |
| `INVALID_FILE_ID` | 400 | `fileId` が空。 |
| `ADMIN_AUTH_REQUIRED` | 401 | 管理APIの認証が不足または不一致。 |
| `CONFIG_MISSING` | 500 | 必須secretが未設定。 |
| `INTERNAL_ERROR` | 500 | 未処理例外。 |
