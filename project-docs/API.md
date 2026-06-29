# API仕様

## 概要

Phase 10-A改では追加仕様込みでD1 schema / migrationを再設計した。

WorkerのAPIはPhase 9のスタブ応答のままで、D1読み取り、D1書き込み、R2保存、BMSメタデータ読取、zip検査、IP/UAレート制限、Turnstile、フロント接続はまだ実装しない。

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

## D1 schema

Phase 10-A改で以下のテーブルへ再設計する。

- `songs`: 元曲単位
- `charts`: 差分単位
- `versions`: 分岐・履歴単位
- `delete_requests`: 投稿者による削除申請
- `post_logs`: 投稿試行ログ
- `bans`: IPハッシュ、UAハッシュ、ファイルSHA256のBAN
- `admin_logs`: 管理人操作ログ・運用ログ

schemaファイル:

- `worker/migrations/0001_initial.sql`
- `schema/d1.sql`

設計方針:

- `display_version` はDB保存せず、APIレスポンス時に生成する。
- `version_number` は整数で保存する。
- `parent_version_id` と `branch_path` で分岐ツリーを表す。
- `charts` と `versions` は `is_hidden` で論理非表示にする。
- versionのDL不可は `download_blocked` と `download_block_reason` で管理する。
- 外部キー制約を使う。
- cascade削除は使わず、基本はhiddenによる論理削除とする。
- よく使う検索条件にはindexを貼る。

## 既存エンドポイント

### GET /api/health

Workerが動いているか確認する。

レスポンス例:

```json
{
  "status": "ok",
  "service": "bms-wip-charts-worker",
  "phase": "phase-9"
}
```

### GET /api/charts

投稿一覧を取得する。

Phase 10-A改ではD1読み取り未実装のため、まだスタブ応答のまま。

実装時はchart単位で100件ごとにページングし、versionツリーを `branch_path` 順で返す。version単位ではページを分断しない。

想定クエリ:

```text
GET /api/charts?page=1&q=keyword
```

検索結果は該当versionだけではなく、該当chart全体を返す。

### POST /api/charts

新規song/chart/versionを投稿する。

Phase 10-A改ではD1書き込み、R2保存、BMSメタデータ読取、zip検査は未実装。

実装時は以下を作成する。

- `songs`
- `charts`
- root `versions` (`version_number=1`, `branch_path='root'`)
- `post_logs`

### POST /api/charts/:chartId/versions

既存chartへ追記投稿する。

Phase 10-A改ではD1書き込み、R2保存、zip検査は未実装。

実装時は以下を行う。

- 追記先chart/versionの存在確認
- BMSタイトル・アーティストの正規化比較
- `TITLE_ARTIST_MISMATCH` の返却
- `parent_version_id` 設定
- 自動分岐名生成
- `branch_path` 生成
- `display_version` をレスポンス時に生成

同じbase versionから複数投稿があっても、`VERSION_CONFLICT` で拒否しない。

### GET /api/files/:fileId

投稿ファイルを取得する。

実装時は `versions.download_blocked=0` かつ `versions.is_hidden=0` のファイルだけDL可能にする。

`progress=100` のversion自体はDL可能とする。

### POST /api/admin/hide-version

管理人が指定versionを非表示にする。

実装時は以下を更新する。

- `versions.is_hidden=1`
- `versions.hidden_reason`
- `versions.hidden_at`
- `versions.download_blocked=1`
- `versions.download_block_reason='admin_hidden'`
- `versions.download_blocked_at`
- `admin_logs`

### POST /api/admin/ban

管理人がIPハッシュ、UAハッシュ、ファイルSHA256をBANする。

実装時は `bans` に保存する。

## 追加設計エンドポイント

Phase 10-A改では設計のみ行い、Worker実装は後続Phaseで行う。

### GET /api/table

難易度表用の一覧を取得する。

対象:

- `versions.progress=100`
- `versions.download_blocked=0`
- `versions.is_hidden=0`
- 対応するchart/songが非表示でない

返却候補:

- `title`
- `subtitle`
- `artist`
- `subartist`
- `chart_name`
- `display_version`
- `level`
- `md5`
- `is_rejected`
- `dl_link`
- `completed_at`

想定クエリ:

```text
GET /api/table
GET /api/table?level=12
GET /api/table?sort=completed_at
```

### GET /api/table/search?q=...

難易度表を検索する。

MVPではLIKE検索でよい。高度な検索やFTSは後回しとする。

### POST /api/versions/:versionId/withdraw

投稿者がversionを取り下げる。

必要:

- 管理パスワード

条件:

- `progress=100` のversionは取り下げ不可。
- 取り下げ後も追記は可能。
- version自体は削除しない。

更新内容:

- `download_blocked=1`
- `download_block_reason='withdrawn'`
- `withdrawn_at`
- `download_blocked_at`
- `updated_at`

### POST /api/versions/:versionId/delete-request

投稿者がversionの削除申請を行う。

必要:

- 管理パスワード
- 任意メッセージ

更新内容:

- `delete_requests` 作成
- `versions.download_blocked=1`
- `versions.download_block_reason='delete_requested'`
- `versions.delete_requested_at`
- `versions.download_blocked_at`
- `versions.updated_at`

### GET /api/admin/delete-requests

管理人が削除申請一覧を確認する。

想定クエリ:

```text
GET /api/admin/delete-requests?status=pending
```

### POST /api/admin/delete-requests/:requestId/approve

管理人が削除申請を承認する。

実装時は完全削除ではなく、原則として非表示またはDLブロックとして処理する。

### POST /api/admin/delete-requests/:requestId/reject

管理人が削除申請を却下する。

却下時にDLブロックを戻すかどうかは、対象versionの現在状態を確認して判断する。

## display_version生成方針

DBには `display_version` を保存しない。

レスポンス時に以下から生成する。

- `version_number`
- `branch_label`
- `branch_path`

例:

| branch_path | version_number | branch_label | display_version |
| --- | ---: | --- | --- |
| `root` | 1 | `` | `ver1.0` |
| `root/a` | 2 | `a` | `ver2.0-a` |
| `root/b` | 2 | `b` | `ver2.0-b` |
| `root/a/1` | 3 | `a1` | `ver3.0-a1` |

## 主なエラー

| code | HTTP status | 内容 |
| --- | --- | --- |
| `CORS_ORIGIN_NOT_ALLOWED` | 403 | `ALLOWED_ORIGIN` とリクエストOriginが一致しない。 |
| `METHOD_NOT_ALLOWED` | 405 | 許可されていないHTTPメソッド。 |
| `NOT_FOUND` | 404 | 対応するAPIがない。 |
| `INVALID_CHART_ID` | 400 | `chartId` が空または不正。 |
| `INVALID_VERSION_ID` | 400 | `versionId` が空または不正。 |
| `TITLE_ARTIST_MISMATCH` | 400 | 追記先chartとアップロード譜面の曲情報が一致しない。 |
| `INVALID_PASSWORD` | 401 | 管理パスワードが一致しない。 |
| `WITHDRAW_NOT_ALLOWED` | 400 | 完成versionなど、取り下げ不可のversion。 |
| `DELETE_REQUEST_ALREADY_EXISTS` | 409 | 未処理の削除申請が既にある。 |
| `ADMIN_AUTH_REQUIRED` | 401 | 管理APIの認証が不足または不一致。 |
| `CONFIG_MISSING` | 500 | 必須secretが未設定。 |
| `INTERNAL_ERROR` | 500 | 未処理例外。 |
