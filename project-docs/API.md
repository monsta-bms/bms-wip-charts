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

ブラウザのOriginはパスを含まないため、CORSでは以下を許可する。

```text
https://monsta-bms.github.io
```

実装済み:

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts` 初回投稿のみ
- `GET /api/files/:fileId`
- GitHub Pages からの一覧取得
- GitHub Pages 投稿フォームからの初回投稿

まだ実装しないもの:

- `POST /api/charts/:chartId/versions`
- 追記投稿
- 取り下げ
- 削除申請
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理
- Worker側BMS解析
- 進捗グラフUI
- 進捗画像R2保存処理

## 共通仕様

### Base URL

フロント `docs/app.js` では以下を `API_BASE_URL` とする。

```js
const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
```

### CORS

CORSは `ALLOWED_ORIGINS` で許可Originを制御する。

```toml
[vars]
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

後方互換として `ALLOWED_ORIGIN` も読み取るが、今後は `ALLOWED_ORIGINS` を使う。

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

schema / migrationファイル:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `worker/migrations/0003_progress_graph_fields.sql`
- `schema/d1.sql`

テーブル:

- `songs`
- `charts`
- `versions`
- `delete_requests`
- `post_logs`
- `bans`
- `admin_logs`

PROG-01で `versions` に追加したカラム:

| column | 内容 |
| --- | --- |
| `play_notes` | BMS解析で算出したプレイノート総数。 |
| `first_note_measure` | 進捗対象の開始小節。 |
| `last_note_measure` | 進捗対象の終了小節。 |
| `target_measure_count` | 進捗対象小節数。 |
| `measure_notes_json` | 小節ごとのプレイノート数JSON。 |
| `progress_map_json` | 小節単位の塗りlayer JSON。 |
| `progress_image_key` | 進捗画像のR2 key。 |
| `progress_image_mime` | 進捗画像MIME。MVP想定は `image/png`。 |
| `progress_image_size` | 進捗画像ファイルサイズ。 |
| `progress_image_sha256` | 進捗画像SHA256。 |
| `progress_image_created_at` | 進捗画像作成日時。 |
| `collapsed_by_completion` | 完成到達後に通常一覧で折り畳むか。 |
| `collapsed_reason` | 折り畳み理由。 |
| `collapsed_at` | 折り畳み日時。 |
| `collapsed_by_version_id` | 折り畳み原因になった完成version ID。 |

## 難易度表示方針

ユーザーが入力・閲覧する項目は `difficulty` を使い、表示名は「想定難易度」に統一する。

`level` は内部値として保持する。

- 通常の初回投稿フォームには `level` の見える入力欄を出さない。
- 投稿一覧では `difficulty` のみ表示し、`level` を併記しない。
- `GET /api/charts` は既存API互換のため `level` を返してよい。
- 将来の難易度表APIでは `level` を返してよい。

## 進捗グラフAPI設計

PROG-01ではAPI実装は変更しない。将来の実装で `GET /api/charts` のversionレスポンスに進捗グラフ情報を返せるよう、レスポンス仕様を予約する。

### versionレスポンス追加フィールド

| response field | DB column | 内容 |
| --- | --- | --- |
| `playNotes` | `play_notes` | プレイノート総数。 |
| `firstNoteMeasure` | `first_note_measure` | 対象開始小節。 |
| `lastNoteMeasure` | `last_note_measure` | 対象終了小節。 |
| `targetMeasureCount` | `target_measure_count` | 対象小節数。 |
| `measureNotes` | `measure_notes_json` | 小節ごとのノート数JSONをparseした値。 |
| `progressMap` | `progress_map_json` | 小節単位の塗りlayer JSONをparseした値。 |
| `progressImage.url` | `progress_image_key` | 進捗画像取得URL。 |
| `progressImage.mime` | `progress_image_mime` | 画像MIME。 |
| `progressImage.size` | `progress_image_size` | 画像サイズ。 |
| `progressImage.sha256` | `progress_image_sha256` | 画像SHA256。 |
| `collapsedByCompletion` | `collapsed_by_completion` | 完成到達後の通常一覧折り畳み状態。 |
| `collapsedReason` | `collapsed_reason` | 折り畳み理由。 |
| `collapsedAt` | `collapsed_at` | 折り畳み日時。 |
| `collapsedByVersionId` | `collapsed_by_version_id` | 折り畳み原因になった完成version ID。 |

レスポンス例:

```json
{
  "id": "version_xxx",
  "displayVersion": "ver2.0-a",
  "difficulty": "★12",
  "level": "12",
  "progress": 45,
  "playNotes": 1234,
  "firstNoteMeasure": 12,
  "lastNoteMeasure": 87,
  "targetMeasureCount": 76,
  "measureNotes": {
    "schemaVersion": 1,
    "firstMeasure": 12,
    "lastMeasure": 87,
    "targetMeasureCount": 76,
    "playNotes": 1234,
    "lnPolicy": "count_start_only",
    "measures": [
      { "measure": 12, "playNotes": 8 },
      { "measure": 13, "playNotes": 0 }
    ]
  },
  "progressMap": {
    "schemaVersion": 1,
    "firstMeasure": 12,
    "lastMeasure": 87,
    "targetMeasureCount": 76,
    "layers": [
      {
        "versionId": "version_xxx",
        "color": "#2f80ed",
        "kind": "normal",
        "ranges": [[12, 18], [22, 25]]
      }
    ],
    "progress": 45
  },
  "progressImage": {
    "url": "/api/progress-images/version_xxx",
    "mime": "image/png",
    "size": 20480,
    "sha256": "..."
  },
  "collapsedByCompletion": false,
  "collapsedReason": null,
  "collapsedAt": null,
  "collapsedByVersionId": null
}
```

### measure_notes_json仕様

小節ごとのプレイノート数を保存するJSON文字列。

```json
{
  "schemaVersion": 1,
  "firstMeasure": 12,
  "lastMeasure": 87,
  "targetMeasureCount": 76,
  "playNotes": 1234,
  "lnPolicy": "count_start_only",
  "measures": [
    { "measure": 12, "playNotes": 8 },
    { "measure": 13, "playNotes": 0 }
  ]
}
```

仕様:

- `firstMeasure` は最初にプレイノートが出現した小節。
- `lastMeasure` は最後にプレイノートがある小節。
- `targetMeasureCount` は `firstMeasure` から `lastMeasure` までの小節数。
- 途中の非プレイノート小節も `measures` に含める。
- BGM/BPM/STOP/メタ情報はプレイノート数に含めない。
- LNはMVPでは開始のみ1ノートとして数え、`lnPolicy` は `count_start_only` とする。

### progress_map_json仕様

小節単位の進捗塗り情報を保存するJSON文字列。

```json
{
  "schemaVersion": 1,
  "firstMeasure": 12,
  "lastMeasure": 87,
  "targetMeasureCount": 76,
  "layers": [
    {
      "versionId": "version_xxx",
      "color": "#2f80ed",
      "kind": "normal",
      "ranges": [[12, 18], [22, 25]]
    },
    {
      "versionId": "version_yyy",
      "color": "#27ae60",
      "kind": "followup",
      "ranges": [[18, 24]]
    }
  ],
  "progress": 45
}
```

仕様:

- 塗りはversionごとのlayerで持つ。
- 追記時は親versionのlayersを引き継ぎ、今回分を新layerとして追加する。
- 重ね塗りは可能。
- progressは全layerのunionで算出する。
- 同じ小節が複数layerで塗られていても、進捗計算では1小節として数える。
- 連続範囲は `ranges` で持つ。

`kind` 候補:

- `normal`
- `followup`
- `rejected_auto_fill`
- `completion_fill`

### 進捗画像仕様

進捗グラフ画像は譜面ファイルとは別にR2へ保存する。

- 保存キー例: `charts/{chartId}/versions/{versionId}/progress/progress.png`
- 画像形式はPNG推奨。
- `progress_image_mime` は `image/png` を想定する。
- 譜面ファイル本体が `file_deleted_at` で削除済みになっても、進捗画像は残す。

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

レスポンス概要:

- `charts` は chart単位の配列。
- 各要素に `song`, `chart`, `versions` を含める。
- `charts.is_hidden=1` のchartは通常一覧に出さない。
- `versions.is_hidden=1` のversionは通常一覧に出さない。
- versionsは `branch_path` 昇順で返す。
- `displayVersion` はDB保存値ではなくAPI側で生成する。
- `difficulty` と `level` を返すが、通常一覧では `difficulty` のみ表示する。
- `progress=100` のversionは `completed: true` を返す。
- `is_rejected=1` のversionは `isRejected: true` を返し、UIでは没譜面バッジで区別する。
- `downloadBlocked` と `downloadBlockReason` を返す。
- 将来、PROG-01の進捗グラフ関連フィールドを返す。

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
- `comment`
- `isRejected`
- `password`

主な仕様:

- 許可拡張子は `.bms`, `.bme`, `.bml`, `.zip` のみ。
- 単体譜面ファイルは2MBまで。
- zipファイルは5MBまで。
- 音源ファイルのアップロードは禁止する。
- 同一 `file_sha256` は `DUPLICATE_FILE` で拒否する。
- 作成するversionは `ver1.0` 相当。
- `isRejected=true` の場合は、入力された `progress` に関係なく保存値を `progress=100` に強制する。
- `isRejected=true` の場合は `completed_at` を保存し、completed扱いにする。

PROG-01では `measure_notes_json` / `progress_map_json` / 進捗画像の受信・保存はまだ実装しない。

### GET /api/files/:fileId

投稿ファイルをダウンロードする。

エラー:

- fileIdに対応するversionがない場合は `FILE_NOT_FOUND`。
- versionが非表示の場合は `FILE_NOT_AVAILABLE`。
- 親chartが非表示の場合も `FILE_NOT_AVAILABLE`。
- `download_blocked=1` の場合は `FILE_DOWNLOAD_BLOCKED`。
- D1にはあるがR2にない場合は `R2_FILE_NOT_FOUND`。
- R2取得処理が失敗した場合は `R2_DOWNLOAD_FAILED`。

## スタブのままのエンドポイント

### POST /api/charts/:chartId/versions

既存chartへ追記投稿する。現時点では未実装。

将来の本実装では以下のルールを適用する。

- 追記投稿では `isRejected` を指定できない。
- 追記投稿で `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。
- 追記元の親versionが `is_rejected=1` の場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。
- 親versionの `progress_map_json` layersを引き継ぎ、今回追記分を新しいlayerとして追加する。

### POST /api/admin/hide-version

管理人が指定versionを非表示にする。現時点ではスタブ応答のまま。

### POST /api/admin/ban

管理人がIPハッシュ、UAハッシュ、ファイルSHA256をBANする。現時点ではスタブ応答のまま。

## 自動削除準備

将来、Cloudflare Workers Cron Triggerで1日1回程度、DL不可から30日経過したversionのR2ファイルを整理する。

MVPの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。

譜面ファイル削除後も進捗画像は残す。

## displayVersion生成方針

DBには `displayVersion` / `display_version` を保存しない。

レスポンス時に以下から生成する。

- `version_number`
- `branch_label`
- `branch_path`

## 主なエラー

| code | HTTP status | 内容 |
| --- | ---: | --- |
| `CORS_ORIGIN_NOT_ALLOWED` | 403 | `ALLOWED_ORIGINS` とリクエストOriginが一致しない。 |
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
| `R2_UPLOAD_FAILED` | 500 | R2への保存に失敗。 |
| `DB_INSERT_FAILED` | 500 | D1への保存に失敗。 |
| `FILE_NOT_FOUND` | 404 | fileIdに対応するversionがない。 |
| `FILE_NOT_AVAILABLE` | 403 | versionまたはchartが非表示。 |
| `FILE_DOWNLOAD_BLOCKED` | 403 | versionのDLがブロックされている。 |
| `R2_FILE_NOT_FOUND` | 404 | D1 metadataはあるがR2 objectがない。 |
| `R2_DOWNLOAD_FAILED` | 500 | R2からの取得に失敗。 |
| `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` | 400 | 追記投稿では没譜面チェックを指定できない。 |
| `REJECTED_CHART_CANNOT_BE_EXTENDED` | 409 | 没譜面versionから追記投稿しようとした。 |
| `UNKNOWN_ERROR` | 500 | 想定外エラー。 |
| `INTERNAL_ERROR` | 500 | 未処理例外。 |

## 管理ログ用コード

| code | level | 内容 |
| --- | --- | --- |
| `R2_USAGE_EXCEEDED_8GB` | `warning` | R2使用量が8GBを超えた。 |
| `AUTO_FILE_DELETE_SUCCEEDED` | `info` | DL不可から30日経過したR2ファイルの自動削除に成功した。 |
| `AUTO_FILE_DELETE_FAILED` | `error` | DL不可から30日経過したR2ファイルの自動削除に失敗した。 |
