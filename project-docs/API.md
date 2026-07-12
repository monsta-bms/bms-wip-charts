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
- `POST /api/versions/:versionId/withdraw` version取り消し
- `POST /api/versions/:versionId/delete-request` version削除申請
- `GET /api/files/:fileId`
- `GET /api/progress-images/:versionId`
- progressMap保存と一覧サムネイル表示
- 進捗PNGのFormData添付、R2保存、`versions.progress_image_*` 保存
- 完成到達後の中間version折り畳み/展開表示

未実装:

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
| `play_notes` | BMS解析で算出したプレイノート総数。LNはMVPでは開始のみ数える。 |
| `first_note_measure` | 最初にプレイノートが出現した小節。 |
| `last_note_measure` | 最後にプレイノートが出現した小節。 |
| `target_measure_count` | 表示・進捗対象小節数。`displayFirstMeasure` から `displayLastMeasure` までを数える。 |
| `measure_notes_json` | 小節ごとのプレイノート数JSON。schemaVersion 2ではプレイノート範囲と表示範囲を分けて持つ。 |
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

## BMS解析範囲

プレイノート範囲と、進捗マップの表示・進捗対象範囲は別に扱う。

- `first_note_measure` / `last_note_measure` はプレイノートだけで決める。
- `displayFirstMeasure` は最初のプレイノート小節とする。
- `displayLastMeasure` は曲終端基準で決める。
- 曲終端候補には、プレイノート、BGM `01`、小節長 `02`、BPM `03` / `08`、STOP `09` を含める。
- BGAだけの終端は進捗対象を延ばす理由にしない。
- 曲頭側の完全な空白小節は通常表示に含めない。
- `progressMap.blocks` と進捗PNGは `displayFirstMeasure` から `displayLastMeasure` までを元に作る。
- 既存投稿済みデータと既存PNGは自動再生成しない。

`measure_notes_json` schemaVersion 2 例:

```json
{
  "schemaVersion": 2,
  "firstPlayableMeasure": 1,
  "lastPlayableMeasure": 22,
  "displayFirstMeasure": 1,
  "displayLastMeasure": 94,
  "targetMeasureCount": 94,
  "playNotes": 542,
  "lnPolicy": "count_start_only",
  "measures": [
    { "measure": 1, "playNotes": 12 },
    { "measure": 23, "playNotes": 0 },
    { "measure": 94, "playNotes": 0 }
  ]
}
```

## progressMap / progressImage

`progressMap` が正データで、進捗PNGは表示・履歴確認用の派生データとして扱う。

- `progressMap` はD1の `versions.progress_map_json` に保存する。
- `progressMap.blocks` は曲終端基準の表示範囲に揃える。
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
| `q` | 空 | 最大100文字の部分一致検索語。前後空白を除去し、NFKC・小文字化して検索する。`%`と`_`は文字として扱う。 |

検索対象は曲名、サブタイトル、アーティスト、サブアーティスト、差分名、公開中versionの作者とする。検索結果の単位はchartであり、いずれかに一致したchartについて公開中versionをすべて返す。

versionレスポンスには以下を含める。

- `progressMap`: `progress_map_json` をparseしたJSON、または `null`
- `measureNotes`: `measure_notes_json` をparseしたJSON、または `null`
- `playNotes`, `firstNoteMeasure`, `lastNoteMeasure`, `targetMeasureCount`
- `progressImage`: 進捗画像がある場合のみ以下のobject、ない場合は `null`
- `collapsedByCompletion`, `collapsedReason`, `collapsedAt`, `collapsedByVersionId`
- `downloadBlocked`, `downloadBlockReason`, `downloadBlockedAt`
- `createdAt`: version投稿日時。D1のUTC時刻を返す。
- `within24Hours`: 一覧表示用の参考判定。最終判定は管理API実行時に再計算する。
- `hasChildVersions`, `hasDescendants`: 公開中の直接子versionが1件以上あるか。`is_hidden=1`の子は除外する。
- `childVersionCount`, `visibleChildVersionCount`: 公開中の直接子version数。既存`childVersionCount`もこの意味とする。
- `totalChildVersionCount`: DB上の全直接子version数。`is_hidden=1`も含む。

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
    "total": 0,
    "hasNext": false
  },
  "query": {
    "q": ""
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
- 単体BMS/BME/BMLでは、Worker側解析でプレイノート範囲と曲終端基準の表示範囲を保存する。
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
- `file_deleted_at IS NOT NULL`の場合はR2へアクセスせず、HTTP 410 `FILE_DELETED`。
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


## 投稿者によるversion管理

### POST /api/versions/:versionId/withdraw

投稿時の管理パスワードを検証し、対象versionを取り消す。ルート名は互換性のため `withdraw` を維持する。

送信形式:

- `Content-Type: application/json`

request body:

```json
{
  "password": "投稿時の管理パスワード"
}
```

成功レスポンス:

```json
{
  "ok": true,
  "versionId": "version_xxx",
  "action": "withdraw",
  "outcome": "download_blocked",
  "within24Hours": false,
  "hasDescendants": true,
  "visibleChildVersionCount": 1,
  "totalChildVersionCount": 2,
  "effectiveAt": "2026-07-11T00:00:00.000Z"
}
```

`outcome`:

- `immediate_hidden`: API実行時点で投稿から24時間以内かつ公開中の直接子なし。`is_hidden=1`, `hidden_reason='canceled_within_24h'`, `hidden_at`, `withdrawn_at`, `download_blocked=1`を設定する。
- `download_blocked`: 公開中の直接子がある、または24時間経過済み。`withdrawn_at`, `download_blocked=1`, `download_blocked_at`を設定し、未ブロック時だけ理由を`withdrawn`にする。
- いずれもD1行、R2譜面ファイル、progressImageは削除しない。
- `download_blocked`は追記拒否条件ではなく、非表示でなければ追記可能。

### POST /api/versions/:versionId/delete-request

投稿時の管理パスワードを検証し、24時間ルールに基づいて即時論理削除または削除申請を行う。

request body:

```json
{
  "password": "投稿時の管理パスワード",
  "reason": "任意。500文字以内"
}
```

成功レスポンス:

```json
{
  "ok": true,
  "versionId": "version_xxx",
  "action": "delete_request",
  "outcome": "delete_requested",
  "within24Hours": false,
  "hasDescendants": true,
  "visibleChildVersionCount": 1,
  "totalChildVersionCount": 2,
  "effectiveAt": "2026-07-11T00:00:00.000Z"
}
```

`outcome`:

- `immediate_hidden`: API実行時点で投稿から24時間以内かつ公開中の直接子なし。`is_hidden=1`, `hidden_reason='deleted_within_24h'`, `hidden_at`, `download_blocked=1`を設定し、pending申請は作らない。
- `delete_requested`: 公開中の直接子がある、または24時間経過済み。`delete_requests`へ`status='pending'`を追加し、`versions.delete_requested_at`, `download_blocked=1`, `download_blocked_at`を設定する。
- request bodyの`reason`はDBの`delete_requests.message`へ保存する。
- `delete_requests.created_at`を申請日時として扱う。
- 管理承認前はD1/R2を物理削除せず、progressImageも保持する。
- 削除申請後も対象versionが非表示でなければ追記可能。

共通判定:

- 24時間判定はWorkerがD1上で`created_at >= datetime('now', '-24 hours')`を実行する。
- `visibleChildVersionCount`は`parent_version_id`が対象version IDと一致し、`COALESCE(is_hidden, 0)=0`の直接子数とする。即時非表示可否はこの値で判定する。
- `totalChildVersionCount`は`parent_version_id`が一致する全直接子数とし、監査・参考表示に使う。
- 削除申請中、取り消し済み、DL不可、没譜面、中間履歴でも`is_hidden=0`なら公開中の子としてブロック条件に含める。
- 一覧表示の参考値と異なる場合も、APIレスポンスの`outcome`を正とする。
- `immediate_hidden`は論理削除であり、R2オブジェクトの物理削除や`file_deleted_at`更新は行わない。

認証と試行制限:

- passwordは既存投稿と同じHASH_SECRET付きSHA-256方式で検証する。
- 同一IP/UAハッシュについて、10分以内に5回以上 `INVALID_PASSWORD` が記録された場合はHTTP 429 `RATE_LIMITED` を返す。
- password、password_hash、HASH_SECRET、生IP、生UAはログに出さない。

主なエラー:

| code | HTTP | 内容 |
| --- | ---: | --- |
| `VERSION_NOT_FOUND` | 404 | versionが存在しない、または非表示。 |
| `PASSWORD_REQUIRED` | 400 | passwordが空。 |
| `INVALID_PASSWORD` | 401 | 管理パスワード不一致。 |
| `VERSION_ALREADY_WITHDRAWN` | 409 | 取り消し済み。 |
| `DELETE_REQUEST_ALREADY_EXISTS` | 409 | pending削除申請が存在する。 |
| `INVALID_DELETE_REQUEST_REASON` | 400 | reasonの型または長さが不正。 |
| `WITHDRAW_FAILED` | 500 | 取り消し処理失敗。 |
| `DELETE_REQUEST_FAILED` | 500 | 削除申請処理失敗。 |
| `SERVER_CONFIG_ERROR` | 500 | HASH_SECRET未設定。 |
| `RATE_LIMITED` | 429 | 短時間のパスワード試行上限超過。 |
| `INVALID_REQUEST` | 400 | Content-TypeまたはJSON形式が不正。 |

成功・失敗は `post_logs` の `withdraw_version` / `request_delete` として記録する。detailには`outcome`, `within24Hours`, `hasDescendants`, `visibleChildVersionCount`, `totalChildVersionCount`, `versionId`, `chartId`, `hasReason`, `reasonLength`を記録し、passwordと理由本文は記録しない。R2削除と復旧はこのフェーズでは行わない。

## 管理者向け削除申請API

全APIで以下のheaderを必須にする。

```http
Authorization: Bearer <ADMIN_TOKEN>
```

ADMIN_TOKENはCloudflare secretで設定し、request URLやJSON bodyには含めない。

### GET /api/admin/delete-requests

pending削除申請を古い順に取得する。

query parameters:

| name | default | 内容 |
| --- | ---: | --- |
| `status` | `pending` | ADMIN-DELETE-01では`pending`のみ対応。 |
| `page` | `1` | 1始まりのページ番号。 |
| `pageSize` | `50` | 1ページ件数。最大100。 |

成功レスポンス:

```json
{
  "ok": true,
  "items": [
    {
      "requestId": "delete_request_xxx",
      "status": "pending",
      "message": "申請理由",
      "createdAt": "2026-07-11 12:00:00",
      "versionId": "version_xxx",
      "chartId": "chart_xxx",
      "songTitle": "曲名",
      "chartName": "差分名",
      "versionLabel": "1-2-1",
      "branchPath": "root/a/b/a",
      "author": "author",
      "progress": 59,
      "versionCreatedAt": "2026-07-10 12:00:00",
      "withdrawn": false,
      "isHidden": false,
      "hiddenReason": null,
      "downloadBlocked": true,
      "downloadBlockReason": "delete_requested",
      "childVersionCount": 0,
      "visibleChildVersionCount": 0,
      "totalChildVersionCount": 1,
      "canApprove": true
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 1
}
```

`childVersionCount`と`visibleChildVersionCount`は公開中の直接子数、`totalChildVersionCount`は非表示を含む全直接子数とする。`password_hash`, R2 key, requester hash、ADMIN_TOKEN、HASH_SECRETは返さない。`isHidden=true`でもpending申請が存在する場合は現在状態として返す。

### POST /api/admin/delete-requests/:requestId/approve

pending削除申請を承認し、末端versionを論理非表示にする。

request body:

```json
{
  "adminNote": "任意。1000文字以内"
}
```

成功レスポンス:

```json
{
  "ok": true,
  "requestId": "delete_request_xxx",
  "versionId": "version_xxx",
  "status": "approved",
  "outcome": "version_hidden"
}
```

更新内容:

- `delete_requests.status='approved'`, `handled_at`, `handled_by='admin'`, `admin_note`を設定する。
- `versions.is_hidden=1`, `hidden_at`, `hidden_reason='delete_request_approved'`, `download_blocked=1`, `updated_at`を設定する。
- 既に非表示の場合は既存の`hidden_reason`を保持し、`outcome='already_hidden'`を返す。
- 公開中の直接子がある場合だけ409 `DELETE_REQUEST_HAS_DESCENDANTS`とし、申請とversionを変更しない。全直接子が`is_hidden=1`なら承認できる。
- D1 version行、R2譜面ファイル、progressImageを物理削除せず、`file_deleted_at`も設定しない。

### POST /api/admin/delete-requests/:requestId/reject

pending削除申請を却下する。

request body:

```json
{
  "adminNote": "必須。1000文字以内"
}
```

成功レスポンス:

```json
{
  "ok": true,
  "requestId": "delete_request_xxx",
  "versionId": "version_xxx",
  "status": "rejected",
  "outcome": "request_rejected",
  "downloadRestored": true
}
```

更新内容:

- `delete_requests.status='rejected'`, `handled_at`, `handled_by='admin'`, `admin_note`を設定する。
- 同じversionに別のpending申請がなければ`versions.delete_requested_at`を解除する。
- `download_block_reason='delete_requested'`の場合だけ`download_blocked`, reason, blocked_atを解除する。
- 他理由のDL制限、`is_hidden`, `hidden_reason`, `withdrawn_at`は変更しない。

管理APIエラー:

| code | HTTP | 内容 |
| --- | ---: | --- |
| `ADMIN_AUTH_REQUIRED` | 401 | ADMIN_TOKENがない、または不一致。 |
| `CONFIG_MISSING` | 500 | WorkerにADMIN_TOKENが設定されていない。 |
| `DELETE_REQUEST_NOT_FOUND` | 404 | requestIdが存在しない。 |
| `DELETE_REQUEST_ALREADY_HANDLED` | 409 | 申請がpendingではない。 |
| `DELETE_REQUEST_HAS_DESCENDANTS` | 409 | 対象versionに直接子があり承認不可。 |
| `INVALID_ADMIN_NOTE` | 400 | adminNoteの型、必須、長さが不正。 |
| `DELETE_REQUEST_LIST_FAILED` | 500 | pending一覧取得失敗。 |
| `DELETE_REQUEST_APPROVE_FAILED` | 500 | 承認処理失敗。 |
| `DELETE_REQUEST_REJECT_FAILED` | 500 | 却下処理失敗。 |

承認・却下・競合・失敗は`admin_logs`へ記録する。申請一覧の参照は記録しない。

## 管理者向けR2 cleanup API

全APIで次のheaderを必須とする。

```http
Authorization: Bearer <ADMIN_TOKEN>
```

レスポンスや`admin_logs`にはraw R2 key、ADMIN_TOKEN、secret、生IP、生UAを含めない。cleanup対象は`is_hidden=1`, `download_blocked=1`, `file_deleted_at IS NULL`, `hidden_at`から30日以上経過し、`hidden_reason`が`delete_request_approved`または`deleted_within_24h`のversionに限定する。

### GET /api/admin/r2-cleanup-candidates

query parameters:

| name | default | 内容 |
| --- | ---: | --- |
| `olderThanDays` | 30 | 最小30。30未満は30へ丸める。 |
| `page` | 1 | 1以上。 |
| `pageSize` | 50 | 最大100。 |

候補一覧ではR2 `head`を行わず、実行時に再確認する。

```json
{
  "ok": true,
  "items": [
    {
      "versionId": "version_xxx",
      "chartId": "chart_xxx",
      "songTitle": "曲名",
      "chartName": "差分名",
      "versionLabel": "1-2-1",
      "branchPath": "root/a/b",
      "author": "作者",
      "hiddenReason": "delete_request_approved",
      "hiddenAt": "2026-06-01 00:00:00",
      "ageDays": 31,
      "fileDeletedAt": null,
      "hasR2Key": true,
      "fileName": "chart.bms",
      "fileSize": 12345,
      "fileSha256": "..."
    }
  ],
  "olderThanDays": 30,
  "page": 1,
  "pageSize": 50,
  "total": 1
}
```

### POST /api/admin/r2-cleanup/:versionId/delete-file

request body:

```json
{
  "confirm": "DELETE_R2_FILE",
  "olderThanDays": 30,
  "expectedHiddenAt": "2026-06-01 00:00:00",
  "expectedFileSha256": "..."
}
```

実行時にD1状態、保持期間、`expectedHiddenAt`、任意の`expectedFileSha256`を再検証する。R2 objectが存在する場合は`head`, `delete`, 再`head`の順で消失を確認し、その後にD1へ`file_deleted_at`, `file_delete_reason`, `updated_at`を記録する。objectが既にない、またはR2 keyが欠落している場合はD1修復として成功扱いにする。`progress_image_key`のobjectは削除しない。

成功outcome:

| outcome | 内容 |
| --- | --- |
| `r2_file_deleted` | 譜面R2 objectを削除しD1へ記録。 |
| `r2_object_missing_reconciled` | object不在またはkey欠落を確認しD1を修復。 |
| `already_deleted` | `file_deleted_at`設定済み。冪等成功。 |

成功レスポンスは`progressImagePreserved: true`を返す。

cleanupエラー:

| code | HTTP | 内容 |
| --- | ---: | --- |
| `ADMIN_AUTH_REQUIRED` | 401 | ADMIN_TOKENがない、または不一致。 |
| `CONFIG_MISSING` | 500 | WorkerにADMIN_TOKENが設定されていない。 |
| `VERSION_NOT_FOUND` | 404 | versionIdが存在しない。 |
| `CLEANUP_CONFIRM_REQUIRED` | 400 | 確認文字列またはJSON形式が不正。 |
| `CLEANUP_TARGET_NOT_ELIGIBLE` | 400/409 | 保持日数または現在状態がcleanup条件外。 |
| `CLEANUP_EXPECTED_VALUE_MISMATCH` | 409 | hidden_atまたはSHA-256が一覧取得時から変化。 |
| `CLEANUP_R2_KEY_MISSING` | 成功ログ | key欠落をobject不在としてD1修復。 |
| `CLEANUP_R2_DELETE_FAILED` | 500 | R2 head/delete/消失確認失敗。D1削除日時は更新しない。 |
| `CLEANUP_D1_UPDATE_FAILED` | 500 | 対象照会またはR2結果のD1記録失敗。 |
| `CLEANUP_CANDIDATE_LIST_FAILED` | 500 | 候補一覧取得失敗。 |

cleanup実行結果は`admin_logs.action='r2_cleanup_delete_file'`、失敗は`r2_cleanup_delete_file_failed`で記録する。detailにはversion/chart、非表示理由・日時、保持日数、R2 key有無、outcome/errorCode、削除記録日時、SHA-256有無、ファイルサイズだけを含める。

## BAN管理API

以下はすべて`Authorization: Bearer <ADMIN_TOKEN>`を必須とする。レスポンスにはfull `ip_hash`、full `ua_hash`、full `file_sha256`、生IP、生UA、`ADMIN_TOKEN`、`HASH_SECRET`を含めない。

### GET /api/admin/post-logs

query:

| name | default | 制約 |
| --- | ---: | --- |
| `page` | 1 | 1以上 |
| `pageSize` | 50 | 最大100 |

最近の投稿ログを新しい順で返す。hashは先頭12文字の短縮値だけを返す。`canBanIp=false`はIP hash欠落または`unknown` marker由来を表す。

```json
{
  "ok": true,
  "items": [
    {
      "postLogId": "post_log_xxx",
      "createdAt": "2026-07-11 12:00:00",
      "action": "create_chart",
      "result": "accepted",
      "errorCode": null,
      "ipHashShort": "0123456789ab...",
      "uaHashShort": "abcdef012345...",
      "fileSha256Short": "fedcba987654...",
      "hasIpHash": true,
      "hasUaHash": true,
      "hasFileSha256": true,
      "canBanIp": true,
      "versionId": "version_xxx",
      "chartId": "chart_xxx",
      "detailSummary": "create_chart / accepted"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 1
}
```

### POST /api/admin/bans

管理UIはfull hashを送らず、対象`post_logs`のIDを送る。

```json
{
  "sourcePostLogId": "post_log_xxx",
  "targetType": "ip_hash",
  "reason": "荒らし投稿",
  "duration": "7d"
}
```

`targetType`は`ip_hash`または`file_sha256`、`duration`は`24h`, `7d`, `30d`, `permanent`。Workerがsource logから対応するfull hashを取得し、`bans`へ保存する。同一type/valueが既にある場合は既存行を再有効化する。

```json
{
  "ok": true,
  "banId": "ban_xxx",
  "banType": "ip_hash",
  "banValueShort": "0123456789ab...",
  "active": true,
  "expiredAt": "2026-07-18 12:00:00",
  "reactivated": false,
  "outcome": "ban_created"
}
```

### GET /api/admin/bans

queryの`state`は`active`（default）, `expired`, `disabled`, `all`。`page`/`pageSize`はpost-logsと同じ。activeは`active=1`, `disabled_at IS NULL`, `expired_at IS NULL OR expired_at > CURRENT_TIMESTAMP`で判定する。

返却項目は`banId`, `banType`, `banValueShort`, `reason`, `active`, `storedActive`, `createdAt`, `updatedAt`, `expiredAt`, `disabledAt`, `state`。full `ban_value`は返さない。

### POST /api/admin/bans/:banId/lift

```json
{
  "adminNote": "解除理由"
}
```

解除時は`active=0`, `disabled_at=CURRENT_TIMESTAMP`, `updated_at=CURRENT_TIMESTAMP`とする。既に解除済みの場合は冪等成功として`outcome: "already_lifted"`を返す。解除理由はschema変更を行わず`admin_logs.detail`へ長さだけを記録し、本文は保存しない。

### 投稿APIでのBAN判定

`POST /api/charts`と`POST /api/charts/:chartId/versions`は、multipart解析前にrequest fingerprint BANを照合する。file SHA-256 BANはファイルSHA計算後、R2保存前に照合する。BAN時は次の一般化レスポンスだけを返す。

```json
{
  "code": "POSTING_BLOCKED",
  "message": "投稿が制限されています。",
  "detail": "Posting is not available."
}
```

BAN関連エラー:

| code | HTTP | 内容 |
| --- | ---: | --- |
| `POSTING_BLOCKED` | 403 | active BANに一致。対象詳細は返さない。 |
| `BAN_CHECK_FAILED` | 503 | BAN照合または保護設定確認に失敗。fail closed。 |
| `BAN_NOT_FOUND` | 404 | banIdが存在しない。 |
| `BAN_ALREADY_DISABLED` | 409 | 予約コード。MVPは冪等`already_lifted`を返す。 |
| `INVALID_BAN_TARGET_TYPE` | 400 | targetTypeまたはJSON bodyが不正。 |
| `INVALID_BAN_DURATION` | 400 | durationが不正。 |
| `INVALID_BAN_REASON` | 400 | reasonが空または長すぎる。 |
| `INVALID_BAN_STATE` | 400 | BAN一覧stateが不正。 |
| `BAN_SOURCE_LOG_NOT_FOUND` | 404 | sourcePostLogIdが存在しない。 |
| `BAN_SOURCE_HASH_NOT_AVAILABLE` | 409 | 対象hashがない、またはunknown IP由来。 |
| `BAN_CREATE_FAILED` | 500 | BAN作成・再有効化失敗。 |
| `BAN_LIFT_FAILED` | 400/500 | 解除body不正またはD1更新失敗。 |
| `BAN_LIST_FAILED` | 500 | BAN一覧取得失敗。 |
| `POST_LOG_LIST_FAILED` | 500 | 投稿ログ一覧取得失敗。 |
| `ADMIN_AUTH_REQUIRED` | 401 | ADMIN_TOKENがない、または不一致。 |
| `CONFIG_MISSING` | 500 | ADMIN_TOKENまたは管理操作に必要なHASH_SECRETが未設定。 |

BAN拒否は既存action（`create_chart` / `append_version`）、`result='rejected'`, `error_code='POSTING_BLOCKED'`で`post_logs`へ記録する。detailにはstage、banType、targetKind、SHA有無、errorCodeだけを入れ、raw ban valueや生IP/UAは入れない。BAN作成・解除は`admin_logs.action='create_ban'` / `'lift_ban'`で記録する。

## 投稿・追記レート制限

対象API:

- `POST /api/charts`
- `POST /api/charts/:chartId/versions`

BAN判定後、progressImageを含むmultipart解析前に、既存`post_logs`を`ip_hash`単位で集計する。取り消し、削除申請、閲覧、DL、管理API、R2 cleanup、管理パスワード失敗制限は対象外。

accepted上限:

| action | 10分 | 1時間 | 24時間 |
| --- | ---: | ---: | ---: |
| `create_chart` | 3 | 10 | 30 |
| `append_version` | 5 | 20 | 60 |

初回・追記合算のclient起因rejected上限は10分10件、1時間30件。次の固定allowlistだけを数える。

```text
INVALID_FORM
PASSWORD_REQUIRED
INVALID_EXTENSION
FILE_TOO_LARGE
INVALID_PROGRESS
INVALID_REJECTED_FLAG_FOR_FOLLOWUP
INVALID_PROGRESS_MAP
PROGRESS_MAP_OUT_OF_RANGE
PROGRESS_MAP_BLOCK_COUNT_MISMATCH
PROGRESS_MAP_UNCHANGED
CHART_NOT_FOUND
PARENT_VERSION_NOT_FOUND
PARENT_VERSION_CHART_MISMATCH
REJECTED_CHART_CANNOT_BE_EXTENDED
TITLE_ARTIST_MISMATCH
DUPLICATE_FILE
CHART_ALREADY_EXISTS
```

`POSTING_BLOCKED`, `POST_RATE_LIMITED`, `BAN_CHECK_FAILED`, `POST_RATE_LIMIT_CHECK_FAILED`およびサーバー起因エラーは数えない。

上限超過レスポンス:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 420
Cache-Control: no-store
```

```json
{
  "code": "POST_RATE_LIMITED",
  "message": "短時間の投稿数が多すぎます。しばらく待ってから再試行してください。",
  "detail": "Posting rate limit exceeded.",
  "retryAfterSeconds": 420
}
```

複数ルール違反時は、各時間窓の最古対象ログから算出した解除までの残り秒数の最大値を`Retry-After`と`retryAfterSeconds`へ設定する。公開レスポンスにはrule、limit、count、hash、内部SQLを出さない。

rate-limit拒否ログは既存action、`result='rejected'`, `error_code='POST_RATE_LIMITED'`, `file_sha256=NULL`でbest effort記録する。ログ書込み失敗でも429応答を維持する。production相当でIP markerが取得できない場合、またはD1集計に失敗した場合はHTTP 503を返す。

```json
{
  "code": "POST_RATE_LIMIT_CHECK_FAILED",
  "message": "投稿回数の確認に失敗しました。しばらく待ってから再試行してください。",
  "detail": "Posting rate limit lookup failed."
}
```

ローカルhostでIP marker不明の場合は共通`unknown`バケットを作らず、レート制限だけをスキップする。schema、migration、index、環境変数、管理UIの追加はない。

## ZIP投稿安全検査

`POST /api/charts`と`POST /api/charts/:chartId/versions`で`.zip`を受け取った場合、file SHA BAN・重複判定後、R2/D1保存前に内部検査する。単体`.bms/.bme/.bml`の既存処理には適用しない。

利用者起因のZIP拒否はHTTP 400で返す。

```text
ZIP_INVALID
ZIP_ENCRYPTED
ZIP_UNSUPPORTED_FORMAT
ZIP_UNSUPPORTED_COMPRESSION
ZIP_TOO_MANY_ENTRIES
ZIP_TOO_MANY_FILES
ZIP_UNCOMPRESSED_TOO_LARGE
ZIP_ENTRY_TOO_LARGE
ZIP_CHART_TOO_LARGE
ZIP_COMPRESSION_RATIO_TOO_HIGH
ZIP_UNSAFE_PATH
ZIP_UNSUPPORTED_ENTRY_TYPE
ZIP_DUPLICATE_PATH
ZIP_AUDIO_NOT_ALLOWED
ZIP_NESTED_ARCHIVE
ZIP_FORBIDDEN_FILE
ZIP_CHART_NOT_FOUND
ZIP_MULTIPLE_CHART_FILES
```

Workerまたはライブラリ起因の予期しない検査失敗はHTTP 503 `ZIP_INSPECTION_FAILED`を返す。ZIP拒否時は譜面R2 object、song、chart、versionを作成しない。`post_logs.detail`は次の安全な要約だけを持ち、内部パスや内容を含めない。

```json
{
  "stage": "zip_inspection",
  "errorCode": "ZIP_AUDIO_NOT_ALLOWED",
  "entryCount": 2,
  "declaredUncompressedBytes": 1234,
  "chartFileCount": 1
}
```

利用者起因の上記`ZIP_*`はclient rejected投稿レート制限の対象とする。`ZIP_INSPECTION_FAILED`はserver起因のため対象外とする。
