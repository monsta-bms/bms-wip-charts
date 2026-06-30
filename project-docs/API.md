# API仕様

## 概要

Phase 10-Cでは `GET /api/charts` をD1実データ読み取りに変更した。

まだ実装しないもの:

- `POST /api/charts`
- `POST /api/charts/:chartId/versions`
- R2保存
- zip検査
- BMSメタデータ読取
- 取り下げAPI
- 削除申請API
- 難易度表API
- フロント接続

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

Phase 10-A改で以下のテーブルへ再設計済み。

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

## 実装済みエンドポイント

### GET /api/health

Workerが動いているか確認する。

レスポンス例:

```json
{
  "status": "ok",
  "service": "bms-wip-charts-worker",
  "phase": "phase-10-c"
}
```

### GET /api/charts

D1から投稿一覧を取得する。

返却単位:

- chart単位でページングする。
- 各chartに `song` / `chart` / `versions` を含める。
- `charts.is_hidden=1` のchartは通常一覧に出さない。
- `versions.is_hidden=1` のversionは通常一覧に出さない。
- versionsは `branch_path` 昇順で返す。
- `displayVersion` はDB保存値ではなくAPI側で生成する。
- `progress=100` のversionは `completed: true` を返す。
- `downloadBlocked` と `downloadBlockReason` を返す。
- 取り下げ、削除申請、非表示状態を判定できる状態フィールドを返す。

クエリ:

| name | default | 内容 |
| --- | ---: | --- |
| `page` | `1` | 1始まりのページ番号。 |
| `pageSize` | `100` | chart件数。最大 `200`。 |
| `q` | 空 | 検索語。Phase 10-Cでは受け取るだけで、絞り込みはまだ未実装。 |

空DB時のレスポンス例:

```json
{
  "charts": [],
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "hasNext": false
  }
}
```

レスポンス例:

```json
{
  "charts": [
    {
      "song": {
        "id": "song_test_1",
        "title": "Test Song",
        "subtitle": "",
        "artist": "Test Artist",
        "subartist": "",
        "createdAt": "2026-06-30 00:00:00",
        "updatedAt": "2026-06-30 00:00:00"
      },
      "chart": {
        "id": "chart_test_another",
        "name": "[ANOTHER]",
        "hidden": false,
        "hiddenReason": null,
        "createdAt": "2026-06-30 00:00:00",
        "updatedAt": "2026-06-30 00:00:00"
      },
      "versions": [
        {
          "id": "version_test_root",
          "parentVersionId": null,
          "versionNumber": 1,
          "branchLabel": "",
          "branchPath": "root",
          "displayVersion": "ver1.0",
          "author": "tester",
          "authorsJson": null,
          "progress": 30,
          "completed": false,
          "completedAt": null,
          "withdrawn": false,
          "withdrawnAt": null,
          "deleteRequested": false,
          "deleteRequestedAt": null,
          "hidden": false,
          "hiddenReason": null,
          "hiddenAt": null,
          "downloadBlocked": false,
          "downloadBlockReason": null,
          "downloadBlockedAt": null,
          "comment": "root version",
          "difficulty": "★1",
          "level": "1",
          "title": "Test Song",
          "subtitle": "",
          "artist": "Test Artist",
          "subartist": "",
          "md5": "11111111111111111111111111111111",
          "isRejected": false,
          "file": {
            "id": "file_test_root",
            "name": "root.bms",
            "size": 1024,
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "downloadUrl": "/api/files/file_test_root"
          },
          "createdAt": "2026-06-30 00:00:00",
          "updatedAt": "2026-06-30 00:00:00"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "hasNext": false
  }
}
```

D1読み取りに失敗した場合:

```json
{
  "code": "D1_QUERY_FAILED",
  "message": "投稿一覧の取得に失敗しました。",
  "detail": "D1 read failed in charts-list-d1-read: ..."
}
```

## スタブのままのエンドポイント

### POST /api/charts

新規song/chart/versionを投稿する。

Phase 10-CではD1書き込み、R2保存、BMSメタデータ読取、zip検査は未実装。

実装時は以下を作成する。

- `songs`
- `charts`
- root `versions` (`version_number=1`, `branch_path='root'`)
- `post_logs`

### POST /api/charts/:chartId/versions

既存chartへ追記投稿する。

Phase 10-CではD1書き込み、R2保存、zip検査は未実装。

実装時は以下を行う。

- 追記先chart/versionの存在確認
- BMSタイトル・アーティストの正規化比較
- `TITLE_ARTIST_MISMATCH` の返却
- `parent_version_id` 設定
- 自動分岐名生成
- `branch_path` 生成
- `displayVersion` をレスポンス時に生成

同じbase versionから複数投稿があっても、`VERSION_CONFLICT` で拒否しない。

### GET /api/files/:fileId

投稿ファイルを取得する。

Phase 10-CではR2からの実ファイル取得は未実装。

実装時は `versions.download_blocked=0` かつ `versions.is_hidden=0` のファイルだけDL可能にする。

`progress=100` のversion自体はDL可能とする。

### POST /api/admin/hide-version

管理人が指定versionを非表示にする。

Phase 10-Cではスタブ応答のまま。

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

Phase 10-Cではスタブ応答のまま。

実装時は `bans` に保存する。

## 追加設計エンドポイント

Phase 10-Cでは設計のみ行い、Worker実装は後続Phaseで行う。

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

### POST /api/admin/delete-requests/:requestId/approve

管理人が削除申請を承認する。

実装時は完全削除ではなく、原則として非表示またはDLブロックとして処理する。

### POST /api/admin/delete-requests/:requestId/reject

管理人が削除申請を却下する。

却下時にDLブロックを戻すかどうかは、対象versionの現在状態を確認して判断する。

## displayVersion生成方針

DBには `displayVersion` / `display_version` を保存しない。

レスポンス時に以下から生成する。

- `version_number`
- `branch_label`
- `branch_path`

例:

| branch_path | version_number | branch_label | displayVersion |
| --- | ---: | --- | --- |
| `root` | 1 | `` | `ver1.0` |
| `root/a` | 2 | `a` | `ver2.0-a` |
| `root/b` | 2 | `b` | `ver2.0-b` |
| `root/a/1` | 3 | `a1` | `ver3.0-a1` |

## 主なエラー

| code | HTTP status | 内容 |
| --- | ---: | --- |
| `CORS_ORIGIN_NOT_ALLOWED` | 403 | `ALLOWED_ORIGIN` とリクエストOriginが一致しない。 |
| `METHOD_NOT_ALLOWED` | 405 | 許可されていないHTTPメソッド。 |
| `NOT_FOUND` | 404 | 対応するAPIがない。 |
| `INVALID_QUERY_PARAM` | 400 | `page` / `pageSize` が不正。 |
| `D1_QUERY_FAILED` | 500 | D1から投稿一覧を取得できなかった。 |
| `INVALID_CHART_ID` | 400 | `chartId` が空または不正。 |
| `INVALID_VERSION_ID` | 400 | `versionId` が空または不正。 |
| `TITLE_ARTIST_MISMATCH` | 400 | 追記先chartとアップロード譜面の曲情報が一致しない。 |
| `INVALID_PASSWORD` | 401 | 管理パスワードが一致しない。 |
| `WITHDRAW_NOT_ALLOWED` | 400 | 完成versionなど、取り下げ不可のversion。 |
| `DELETE_REQUEST_ALREADY_EXISTS` | 409 | 未処理の削除申請が既にある。 |
| `ADMIN_AUTH_REQUIRED` | 401 | 管理APIの認証が不足または不一致。 |
| `CONFIG_MISSING` | 500 | 必須secretが未設定。 |
| `INTERNAL_ERROR` | 500 | 未処理例外。 |
