# API仕様

## 概要

GitHub Pages の静的フロント画面を本番Worker APIへ接続している。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

実装済み:

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts` 初回投稿
- `POST /api/charts/:chartId/versions` 追記投稿
- `GET /api/files/:fileId`
- `GET /api/progress-images/:versionId`
- progressMap保存と一覧サムネイル表示
- 進捗PNGのFormData添付、R2保存、`versions.progress_image_*` 保存
- 完成到達後の中間version折り畳み/展開表示

未実装:

- 取り下げAPI
- 削除申請API
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理
- ZIP内部のBMS解析
- 一覧サムネイルのR2画像への完全切替

## 共通仕様

### CORS

CORSは `ALLOWED_ORIGINS` で許可Originを制御する。

```toml
[vars]
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

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

既存の `versions` 進捗関連カラム:

| column | 内容 |
| --- | --- |
| `play_notes` | BMS解析で算出したプレイノート総数。 |
| `first_note_measure` | 進捗対象の開始小節。 |
| `last_note_measure` | 進捗対象の終了小節。 |
| `target_measure_count` | 進捗対象小節数。 |
| `measure_notes_json` | 小節ごとのプレイノート数JSON。 |
| `progress_map_json` | 標準化ブロック単位の進捗塗りJSON。 |
| `progress_image_key` | 進捗画像PNGのR2 key。 |
| `progress_image_mime` | 進捗画像のMIME。MVPでは `image/png`。 |
| `progress_image_size` | 進捗画像のbyte size。 |
| `progress_image_sha256` | 進捗画像PNGのSHA256。 |
| `progress_image_created_at` | 進捗画像を保存した日時。 |
| `collapsed_by_completion` | 完成到達後に通常一覧で折り畳むか。 |
| `collapsed_reason` | 折り畳み理由。 |
| `collapsed_at` | 折り畳みにした日時。 |
| `collapsed_by_version_id` | 折り畳み原因になった完成version ID。 |

## progressMap / progressImage

`progressMap` が正データで、進捗PNGは表示・履歴確認用の派生データとして扱う。

- `progressMap` はD1の `versions.progress_map_json` に保存する。
- `progressImage` は `progressMap` からフロント側Canvasで生成したPNG Blob。
- `progressImage` は譜面ファイル本体とは別のR2 objectとして保存する。
- 譜面ファイル本体が将来 `file_deleted_at` により削除されても、進捗画像は履歴確認用として残す。
- 一覧の既存サムネイルは引き続き `progressMap` から描画してよい。R2画像への完全切替は後続フェーズで行う。

R2 key:

```text
charts/{chartId}/versions/{versionId}/progress/progress.png
```

## エンドポイント

### GET /api/health

Workerが動いているか確認する。

### GET /api/charts

D1から投稿一覧を取得する。

クエリ:

| name | default | 内容 |
| --- | ---: | --- |
| `page` | `1` | 1始まりのページ番号。 |
| `pageSize` | `100` | chart件数。最大 `200`。 |
| `q` | 空 | 検索語。MVPでは受け取るだけで絞り込みは未実装。 |

versionレスポンスには以下を含める。

- `progressMap`: `progress_map_json` をparseしたJSON、または `null`
- `progressImage`: 進捗画像がある場合のみ以下のobject、ない場合は `null`
- `collapsedByCompletion`, `collapsedReason`, `collapsedAt`, `collapsedByVersionId`
- `downloadBlocked`, `downloadBlockReason`, `downloadBlockedAt`

`progressImage` 例:

```json
{
  "url": "/api/progress-images/version_xxx",
  "mime": "image/png",
  "size": 12345,
  "sha256": "...",
  "createdAt": "2026-07-05T00:00:00.000Z"
}
```

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

送信形式:

- `multipart/form-data`

送信項目:

- `file`
- `title`
- `subtitle`
- `artist`
- `subartist`
- `chartName`
- `difficulty`
- `level` optional/internal
- `author`
- `progress`
- `progressMap` optional JSON string
- `progressImage` optional `image/png` file
- `comment`
- `isRejected`
- `password`

主な仕様:

- 許可拡張子は `.bms`, `.bme`, `.bml`, `.zip` のみ。
- 単体譜面ファイルは2MBまで、zipファイルは5MBまで。
- 音源ファイルのアップロードは禁止する。
- 同一 `file_sha256` は `DUPLICATE_FILE` で拒否する。
- `progressMap` が送られた場合、Worker側でJSONを検証し、塗り済みunionから `progress` を再計算して保存する。
- `progressImage` が送られた場合、Worker側でPNG検証後にR2へ保存し、`versions.progress_image_*` へ保存する。
- `progressImage` が送信されていない場合は従来通り投稿を成功させる。
- `isRejected=true` の場合は、入力された `progress` と送信された `progressMap` に関係なく保存値を `progress=100` に強制する。

成功レスポンスには、保存できた場合のみ `progressImage` objectを含める。

### POST /api/charts/:chartId/versions

既存chartへ追記投稿する。

送信形式:

- `multipart/form-data`

必須項目:

- `file`
- `parentVersionId`
- `author`
- `progressMap`
- `password`

任意項目:

- `difficulty`
- `level`
- `comment`
- `progressImage` optional `image/png` file

主な仕様:

- 許可拡張子、サイズ上限、R2保存、SHA256/MD5計算、単体BMS解析は初回投稿と同じ方針を使う。
- `progressMap` は必須。progressは送信値を信用せず、全layerのunionからWorker側で再計算する。
- `progressImage` が送られた場合、初回投稿と同じR2 key規則で保存する。
- 親versionが `is_rejected=1` の場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。
- 追記投稿で `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。
- 親versionのprogressMap unionと同じ塗り範囲の場合は `PROGRESS_MAP_UNCHANGED` で拒否する。

成功レスポンス例:

```json
{
  "chartId": "chart_xxx",
  "parentVersionId": "version_parent",
  "versionId": "version_new",
  "displayVersion": "ver2.0-a",
  "branchPath": "root/a",
  "progress": 72,
  "fileId": "file_xxx",
  "progressImage": {
    "url": "/api/progress-images/version_new",
    "mime": "image/png",
    "size": 12345,
    "sha256": "...",
    "createdAt": "2026-07-05T00:00:00.000Z"
  },
  "message": "created"
}
```

### GET /api/files/:fileId

投稿ファイルをダウンロードする。

- `version.is_hidden=1` または親chart非表示の場合は `FILE_NOT_AVAILABLE`。
- `download_blocked=1` の場合は `FILE_DOWNLOAD_BLOCKED`。
- D1にはあるがR2にない場合は `R2_FILE_NOT_FOUND`。

### GET /api/progress-images/:versionId

進捗画像PNGを取得する。

仕様:

- `versionId` から `versions.progress_image_key` を検索する。
- `progress_image_key` がない場合は `PROGRESS_IMAGE_NOT_FOUND`。
- versionまたは親chartが非表示の場合は `PROGRESS_IMAGE_UNAVAILABLE`。
- `downloadBlocked=true` や `file_deleted_at` は進捗画像取得を妨げない。
- R2 objectが存在しない場合は `PROGRESS_IMAGE_R2_NOT_FOUND`。
- 成功時は `Content-Type: image/png` でPNG本体を返す。
- `Cache-Control` は短めに設定する。MVPでは `public, max-age=300`。

## 主なエラー

| code | HTTP status | 内容 |
| --- | ---: | --- |
| `CORS_ORIGIN_NOT_ALLOWED` | 403 | `ALLOWED_ORIGINS` とリクエストOriginが一致しない。 |
| `METHOD_NOT_ALLOWED` | 405 | 許可されていないHTTPメソッド。 |
| `INVALID_FORM` | 400 | multipart/form-dataや必須項目が不正。 |
| `PASSWORD_REQUIRED` | 400 | 管理パスワードが未入力。 |
| `SERVER_CONFIG_ERROR` | 500 | `HASH_SECRET` などサーバー設定が不足。 |
| `INVALID_PROGRESS` | 400 | `progress` が0〜100の整数ではない。 |
| `INVALID_PROGRESS_MAP` | 400 | `progressMap` がJSONとして不正、または必須構造を満たさない。 |
| `PROGRESS_MAP_OUT_OF_RANGE` | 400 | `progressMap.layers[].ranges` がブロック範囲外を指している。 |
| `PROGRESS_MAP_BLOCK_COUNT_MISMATCH` | 400 | `progressMap.targetBlockCount` と `blocks.length` が一致しない。 |
| `PROGRESS_MAP_UNCHANGED` | 409 | 追記投稿の塗り範囲が親versionと同じ。 |
| `INVALID_PROGRESS_IMAGE` | 400 | `progressImage` がPNGファイルではない、または空。 |
| `PROGRESS_IMAGE_TOO_LARGE` | 400 | `progressImage` が1MBを超えている。 |
| `PROGRESS_IMAGE_UPLOAD_FAILED` | 500 | `progressImage` のR2保存またはDB metadata保存に失敗。 |
| `PROGRESS_IMAGE_NOT_FOUND` | 404 | 指定versionに進捗画像が登録されていない。 |
| `PROGRESS_IMAGE_UNAVAILABLE` | 403 | versionまたはchartが非表示のため進捗画像を表示できない。 |
| `PROGRESS_IMAGE_R2_NOT_FOUND` | 404 | D1 metadataはあるがR2 objectがない。 |
| `INVALID_EXTENSION` | 400 | 許可されていない拡張子。 |
| `FILE_TOO_LARGE` | 400 | ファイルサイズ上限超過。 |
| `DUPLICATE_FILE` | 409 | 同じ `file_sha256` のversionが既にある。 |
| `CHART_ALREADY_EXISTS` | 409 | 初回投稿対象のchartが既にある。 |
| `CHART_NOT_FOUND` | 404 | 追記対象chartが存在しない、または非表示。 |
| `PARENT_VERSION_NOT_FOUND` | 404 | 追記元versionが存在しない、または非表示。 |
| `PARENT_VERSION_CHART_MISMATCH` | 409 | 追記元versionが指定chartに属していない。 |
| `TITLE_ARTIST_MISMATCH` | 409 | 追記ファイルの `#TITLE` / `#ARTIST` が追記先songと一致しない。 |
| `BRANCH_CREATE_FAILED` | 500 | 分岐suffix/branch_pathの作成またはDB unique競合処理に失敗。 |
| `VERSION_INSERT_FAILED` | 500 | 追記versionのD1保存に失敗。 |
| `R2_UPLOAD_FAILED` | 500 | 譜面ファイル本体のR2保存に失敗。 |
| `FILE_NOT_FOUND` | 404 | fileIdに対応するversionがない。 |
| `FILE_NOT_AVAILABLE` | 403 | versionまたはchartが非表示。 |
| `FILE_DOWNLOAD_BLOCKED` | 403 | versionのDLがブロックされている。 |
| `R2_FILE_NOT_FOUND` | 404 | D1 metadataはあるが譜面R2 objectがない。 |
| `R2_DOWNLOAD_FAILED` | 500 | R2からの取得に失敗。 |
| `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` | 400 | 追記投稿では没譜面チェックを指定できない。 |
| `REJECTED_CHART_CANNOT_BE_EXTENDED` | 409 | 没譜面versionから追記投稿しようとした。 |
| `UNKNOWN_ERROR` | 500 | 想定外エラー。 |
| `INTERNAL_ERROR` | 500 | 未処理例外。 |

## 主な警告

警告は投稿を失敗させず、成功レスポンスの `warnings` と `post_logs.detail` に残す。

| code | 内容 |
| --- | --- |
| `BMS_METADATA_PARSE_FAILED` | BMSメタデータの自動読取に失敗した。フォーム入力値を使う。 |
| `BMS_ANALYSIS_FAILED` | BMS小節解析に失敗した。解析カラムは `null` として投稿を継続する。 |
| `BMS_NO_PLAY_NOTES` | プレイノートが見つからなかった。解析値は0件として保存する。 |
| `BMS_UNSUPPORTED_CHANNEL_PATTERN` | 未対応のチャンネル表記があり、その行を解析対象外にした。 |
| `PROGRESS_IMAGE_ATTACH_FAILED` | フロント側PNG生成またはFormData添付に失敗した。投稿自体はprogressImageなしで継続する。 |
