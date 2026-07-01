# API仕様

## 概要

Phase 10-Fでは没譜面仕様と自動削除準備の最小修正を行った。

実装済み:

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts` 初回投稿のみ
- `GET /api/files/:fileId`

Phase 10-Fで更新したもの:

- `POST /api/charts` で `isRejected=true` の場合、保存する `progress` を100へ強制する。
- `POST /api/charts` の成功レスポンスに `progress`, `isRejected`, `completedAt` を返す。
- `versions.file_deleted_at` と `versions.file_delete_reason` を追加するmigrationを追加した。
- 将来の追記APIと自動削除処理の仕様を追記した。

まだ実装しないもの:

- `POST /api/charts/:chartId/versions`
- 分岐追加
- progress=100到達時の親DL制御
- 取り下げAPI
- 削除申請API
- 難易度表API
- Cron Trigger
- R2自動削除処理
- 高度な権限管理
- 高度なzip内検査
- Turnstile
- フロント接続

## 共通仕様

### Base URL

ローカル確認時は以下を想定する。

```text
http://localhost:8787
```

Workerの公開URLはデプロイ後に確定する。

### CORS

CORSは `ALLOWED_ORIGIN` 環境変数で許可Originを制御する。

`Origin` ヘッダーがあるリクエストで `ALLOWED_ORIGIN` と一致しない場合は、JSONエラーを返す。

ファイルDL成功時も、許可Originの場合はCORSヘッダーを付与する。

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

- `HASH_SECRET`: password_hash、IPハッシュ、UAハッシュの生成に使う。
- `ADMIN_TOKEN`: 管理API用。

秘密情報はソースコードや `wrangler.toml` に直書きしない。

## D1 schema

以下のテーブルへ再設計済み。

- `songs`: 元曲単位
- `charts`: 差分単位
- `versions`: 分岐・履歴単位
- `delete_requests`: 投稿者による削除申請
- `post_logs`: 投稿試行ログ
- `bans`: IPハッシュ、UAハッシュ、ファイルSHA256のBAN
- `admin_logs`: 管理人操作ログ・運用ログ

schema / migrationファイル:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `schema/d1.sql`

Phase 10-Fで `versions` に追加したカラム:

| column | 内容 |
| --- | --- |
| `file_deleted_at` | 将来R2ファイルが自動削除または管理削除された日時。 |
| `file_delete_reason` | 将来R2ファイルを削除した理由。 |

## 実装済みエンドポイント

### GET /api/health

Workerが動いているか確認する。

レスポンス例:

```json
{
  "status": "ok",
  "service": "bms-wip-charts-worker",
  "phase": "phase-10-e"
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
- `is_rejected=1` のversionは `isRejected: true` を返し、UIでは没譜面バッジで区別する。
- `downloadBlocked` と `downloadBlockReason` を返す。

クエリ:

| name | default | 内容 |
| --- | ---: | --- |
| `page` | `1` | 1始まりのページ番号。 |
| `pageSize` | `100` | chart件数。最大 `200`。 |
| `q` | 空 | 検索語。Phase 10-Fでは受け取るだけで、絞り込みはまだ未実装。 |

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

### POST /api/charts

初回投稿を受け付ける。

`multipart/form-data` のみ受け付ける。

主な仕様:

- `file`, `chartName`, `author`, `progress`, `password` は必須。
- `title` / `artist` はBMS本文から読める場合は空でもよい。
- 許可拡張子は `.bms`, `.bme`, `.bml`, `.zip` のみ。
- 単体譜面ファイルは2MBまで。
- zipファイルは5MBまで。
- 音源ファイルのアップロードは禁止する。
- 音源URLが必要な場合は `comment` にURLを貼る。
- BMS/BME/BML単体投稿では `#TITLE` / `#ARTIST` を可能な範囲で読み取る。
- BMS/BME/BML本体のMD5と `file_sha256` を計算する。
- 同一 `file_sha256` は `DUPLICATE_FILE` で拒否する。
- 作成するversionは `ver1.0` 相当。
- `progress=100` の場合は `completed_at` を保存する。
- `isRejected=true` の場合は、入力された `progress` に関係なく保存値を `progress=100` に強制する。
- `isRejected=true` の場合は `completed_at` を保存し、completed扱いにする。
- `isRejected=true` のversionは将来の難易度表掲載対象になり、没譜面バッジで通常の完成譜面と区別する。
- 成功/失敗は可能な範囲で `post_logs` に記録する。

成功レスポンス例:

```json
{
  "songId": "song_...",
  "chartId": "chart_...",
  "versionId": "version_...",
  "fileId": "file_...",
  "displayVersion": "ver1.0",
  "progress": 100,
  "isRejected": true,
  "completed": true,
  "completedAt": "2026-07-01T12:00:00.000Z",
  "file": {
    "name": "sample.bms",
    "size": 1024,
    "sha256": "...",
    "md5": "...",
    "downloadUrl": "/api/files/file_..."
  },
  "metadata": {
    "title": "Test Song",
    "artist": "Test Artist",
    "encoding": "utf-8"
  },
  "warnings": []
}
```

### GET /api/files/:fileId

投稿ファイルをダウンロードする。

処理:

1. `versions.file_id` からversion/file情報を取得する。
2. 親chartの `charts.is_hidden` を確認する。
3. versionの `versions.is_hidden` を確認する。
4. versionの `versions.download_blocked` を確認する。
5. `versions.r2_key` を使ってR2 bucket `FILES` からファイル本体を取得する。
6. 成功時はファイル本体を返す。

成功時の主なヘッダー:

| header | 内容 |
| --- | --- |
| `Content-Type` | `.bms/.bme/.bml` は `text/plain; charset=utf-8`、`.zip` は `application/zip`。 |
| `Content-Disposition` | `attachment`。元ファイル名で保存できるよう `filename` / `filename*` を設定する。 |
| `Content-Length` | D1に保存された `file_size`。 |
| `X-Content-Type-Options` | `nosniff`。 |

エラー:

- fileIdに対応するversionがない場合は `FILE_NOT_FOUND`。
- versionが非表示の場合は `FILE_NOT_AVAILABLE`。
- 親chartが非表示の場合も `FILE_NOT_AVAILABLE`。
- `download_blocked=1` の場合は `FILE_DOWNLOAD_BLOCKED`。
- D1にはあるがR2にない場合は `R2_FILE_NOT_FOUND`。
- R2取得処理が失敗した場合は `R2_DOWNLOAD_FAILED`。

`download_blocked` 時のレスポンス例:

```json
{
  "code": "FILE_DOWNLOAD_BLOCKED",
  "message": "このファイルはダウンロードできません。",
  "detail": "Download is blocked. reason=withdrawn"
}
```

`is_hidden` 時のレスポンス例:

```json
{
  "code": "FILE_NOT_AVAILABLE",
  "message": "このファイルは現在利用できません。",
  "detail": "The version is hidden. reason=test hidden"
}
```

## スタブのままのエンドポイント

### POST /api/charts/:chartId/versions

既存chartへ追記投稿する。Phase 10-Fでは未実装。

将来の本実装では以下のルールを適用する。

- 追記投稿では `isRejected` を指定できない。
- 追記投稿で `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。
- 追記元の親versionが `is_rejected=1` の場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。
- 没譜面versionから追記して通常譜面化することはできない。

想定エラー例:

```json
{
  "code": "REJECTED_CHART_CANNOT_BE_EXTENDED",
  "message": "没譜面から追記投稿はできません。",
  "detail": "The selected parent version is rejected and cannot be extended."
}
```

### POST /api/admin/hide-version

管理人が指定versionを非表示にする。Phase 10-Fではスタブ応答のまま。

### POST /api/admin/ban

管理人がIPハッシュ、UAハッシュ、ファイルSHA256をBANする。Phase 10-Fではスタブ応答のまま。

## 自動削除準備

Phase 10-FではCron TriggerとR2自動削除処理は実装しない。

将来、Cloudflare Workers Cron Triggerで1日1回程度、DL不可から30日経過したversionのR2ファイルを整理する。

MVPの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。管理人承認済みの削除申請を対象にする場合は、将来 `delete_requests.status='approved'` などの条件を追加する。

自動削除成功時に将来更新する値:

- `versions.is_hidden=1`
- `versions.hidden_reason='auto_deleted_after_download_block'`
- `versions.hidden_at`
- `versions.file_deleted_at`
- `versions.file_delete_reason='auto_deleted_after_download_block'`
- `versions.updated_at`

D1のversion行は物理削除しない。

## 追加設計エンドポイント

後続Phaseで実装する。

- `GET /api/table`
- `GET /api/table?level=...`
- `GET /api/table/search?q=...`
- `POST /api/versions/:versionId/withdraw`
- `POST /api/versions/:versionId/delete-request`
- `GET /api/admin/delete-requests`
- `POST /api/admin/delete-requests/:requestId/approve`
- `POST /api/admin/delete-requests/:requestId/reject`

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
| `D1_QUERY_FAILED` | 500 | D1からデータを取得できなかった。 |
| `INVALID_FORM` | 400 | multipart/form-dataや必須項目が不正。 |
| `PASSWORD_REQUIRED` | 400 | 管理パスワードが未入力。 |
| `SERVER_CONFIG_ERROR` | 500 | `HASH_SECRET` などサーバー設定が不足。 |
| `INVALID_PROGRESS` | 400 | `progress` が0〜100の整数ではない。 |
| `INVALID_EXTENSION` | 400 | 許可されていない拡張子。 |
| `FILE_TOO_LARGE` | 400 | ファイルサイズ上限超過。 |
| `DUPLICATE_FILE` | 409 | 同じ `file_sha256` のversionが既にある。 |
| `CHART_ALREADY_EXISTS` | 409 | 初回投稿対象のchartが既にある。 |
| `BMS_METADATA_PARSE_FAILED` | 200 warning | BMSメタデータ読取に失敗したがフォーム値で続行した。 |
| `AUDIO_FILE_NOT_ALLOWED` | 400 | 音源ファイルを検出した。zip内検査の本実装で使用予定。 |
| `ZIP_INSPECTION_FAILED` | 400 | zip検査に失敗した。後続Phaseで使用予定。 |
| `R2_UPLOAD_FAILED` | 500 | R2への保存に失敗。 |
| `DB_INSERT_FAILED` | 500 | D1への保存に失敗。 |
| `INVALID_FILE_ID` | 400 | `fileId` が空または不正。 |
| `FILE_NOT_FOUND` | 404 | fileIdに対応するversionがない。 |
| `FILE_NOT_AVAILABLE` | 403 | versionまたはchartが非表示。 |
| `FILE_DOWNLOAD_BLOCKED` | 403 | versionのDLがブロックされている。 |
| `R2_FILE_NOT_FOUND` | 404 | D1 metadataはあるがR2 objectがない。 |
| `R2_DOWNLOAD_FAILED` | 500 | R2からの取得に失敗。 |
| `INVALID_CHART_ID` | 400 | `chartId` が空または不正。 |
| `INVALID_VERSION_ID` | 400 | `versionId` が空または不正。 |
| `TITLE_ARTIST_MISMATCH` | 400 | 追記先chartとアップロード譜面の曲情報が一致しない。 |
| `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` | 400 | 追記投稿では没譜面チェックを指定できない。 |
| `REJECTED_CHART_CANNOT_BE_EXTENDED` | 409 | 没譜面versionから追記投稿しようとした。 |
| `INVALID_PASSWORD` | 401 | 管理パスワードが一致しない。 |
| `WITHDRAW_NOT_ALLOWED` | 400 | 完成versionなど、取り下げ不可のversion。 |
| `DELETE_REQUEST_ALREADY_EXISTS` | 409 | 未処理の削除申請が既にある。 |
| `ADMIN_AUTH_REQUIRED` | 401 | 管理APIの認証が不足または不一致。 |
| `CONFIG_MISSING` | 500 | 管理APIなどの必須secretが未設定。 |
| `UNKNOWN_ERROR` | 500 | 想定外エラー。 |
| `INTERNAL_ERROR` | 500 | 未処理例外。 |

## 管理ログ用コード

| code | level | 内容 |
| --- | --- | --- |
| `R2_USAGE_EXCEEDED_8GB` | `warning` | R2使用量が8GBを超えた。 |
| `AUTO_FILE_DELETE_SUCCEEDED` | `info` | DL不可から30日経過したR2ファイルの自動削除に成功した。 |
| `AUTO_FILE_DELETE_FAILED` | `error` | DL不可から30日経過したR2ファイルの自動削除に失敗した。 |
