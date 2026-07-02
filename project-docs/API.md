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
- Worker側BMS解析: 単体 `.bms` / `.bme` / `.bml` のプレイノート数と対象小節情報を保存する

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
- ZIP内部のBMS解析
- フロント側進捗グラフUI
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
| `play_notes` | BMS解析で算出したプレイノート総数。PROG-02で単体BMS投稿時に保存する。 |
| `first_note_measure` | 進捗対象の開始小節。PROG-02で単体BMS投稿時に保存する。 |
| `last_note_measure` | 進捗対象の終了小節。PROG-02で単体BMS投稿時に保存する。 |
| `target_measure_count` | 進捗対象小節数。PROG-02で単体BMS投稿時に保存する。 |
| `measure_notes_json` | 小節ごとのプレイノート数JSON。PROG-02で単体BMS投稿時に保存する。 |
| `progress_map_json` | 小節単位の塗りlayer JSON。未実装。 |
| `progress_image_key` | 進捗画像のR2 key。未実装。 |
| `progress_image_mime` | 進捗画像MIME。MVP想定は `image/png`。未実装。 |
| `progress_image_size` | 進捗画像ファイルサイズ。未実装。 |
| `progress_image_sha256` | 進捗画像SHA256。未実装。 |
| `progress_image_created_at` | 進捗画像作成日時。未実装。 |
| `collapsed_by_completion` | 完成到達後に通常一覧で折り畳むか。未実装。 |
| `collapsed_reason` | 折り畳み理由。未実装。 |
| `collapsed_at` | 折り畳み日時。未実装。 |
| `collapsed_by_version_id` | 折り畳み原因になった完成version ID。未実装。 |

## 難易度表示方針

ユーザーが入力・閲覧する項目は `difficulty` を使い、表示名は「想定難易度」に統一する。

`level` は内部値として保持する。

- 通常の初回投稿フォームには `level` の見える入力欄を出さない。
- 投稿一覧では `difficulty` のみ表示し、`level` を併記しない。
- `GET /api/charts` は既存API互換のため `level` を返してよい。
- 将来の難易度表APIでは `level` を返してよい。

## Worker側BMS解析仕様

PROG-02で、単体 `.bms` / `.bme` / `.bml` 投稿時にWorker側でBMS本文を解析する。

### 対象

- 対象ファイル: `.bms`, `.bme`, `.bml`
- 文字コード: UTF-8 と Shift_JIS を試し、より妥当な結果を使う
- ZIP投稿: ZIP内部解析は未実装のため、解析値は `null` とする

### 解析対象行

BMSデータ行は以下の形式を対象にする。

```text
#mmmcc:data
```

- `mmm`: 3桁の小節番号
- `cc`: 2桁のチャンネル
- `data`: 2文字単位のオブジェクト列
- `00` は空として数えない

### プレイノート対象チャンネル

MVPで数えるチャンネル:

- `11`-`19`
- `21`-`29`
- `51`-`59`
- `61`-`69`

BGM、BPM、STOP、BGA、メタ情報はプレイノート数に含めない。

LNはMVPでは `count_start_only` とする。`51`-`59` / `61`-`69` の非`00`オブジェクトは開始・終了が並ぶ前提で、開始側のみ1ノートとして数える。`LNOBJ` / `LNTYPE` を使った厳密なLN判定は後続Phaseで扱う。

### 対象小節

- `first_note_measure`: 最初にプレイノートが出現した小節
- `last_note_measure`: 最後にプレイノートが出現した小節
- `target_measure_count`: `first_note_measure` から `last_note_measure` までの小節数
- 途中の非プレイノート小節も `measure_notes_json.measures` に `playNotes: 0` として含める
- 前後の完全な空白小節は進捗対象に含めない

プレイノートが見つからない場合:

- `play_notes=0`
- `first_note_measure=null`
- `last_note_measure=null`
- `target_measure_count=0`
- `measure_notes_json.measures=[]`
- warning `BMS_NO_PLAY_NOTES` を返す

解析に失敗した場合:

- 投稿自体は失敗させない
- 解析カラムは `null` を保存する
- warning `BMS_ANALYSIS_FAILED` を返す
- `post_logs.detail` に警告内容を残す
- `console.error` には `[bms-analysis]` の処理段階名を含める

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

## 進捗グラフAPI設計

PROG-02ではBMS解析結果を保存し、`GET /api/charts` のversionレスポンスに返す。
`progress_map_json`、進捗画像、完成到達後の折り畳み表示は未実装であり、後続Phaseで追加する。

### versionレスポンス追加フィールド

| response field | DB column | 内容 |
| --- | --- | --- |
| `playNotes` | `play_notes` | プレイノート総数。 |
| `firstNoteMeasure` | `first_note_measure` | 対象開始小節。 |
| `lastNoteMeasure` | `last_note_measure` | 対象終了小節。 |
| `targetMeasureCount` | `target_measure_count` | 対象小節数。 |
| `measureNotes` | `measure_notes_json` | 小節ごとのノート数JSONをparseした値。parseできない場合は `null`。 |

レスポンス例:

```json
{
  "id": "version_xxx",
  "displayVersion": "ver1.0",
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
  }
}
```

### progress_map_json仕様

小節単位の進捗塗り情報を保存するJSON文字列。未実装だが、後続Phaseでは以下の形式を使う。

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

`kind` 候補:

- `normal`
- `followup`
- `rejected_auto_fill`
- `completion_fill`

### 進捗画像仕様

進捗グラフ画像は譜面ファイルとは別にR2へ保存する。未実装。

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
- BMS解析済みversionでは `playNotes`, `firstNoteMeasure`, `lastNoteMeasure`, `targetMeasureCount`, `measureNotes` を返す。

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
- 単体 `.bms` / `.bme` / `.bml` の場合、BMS解析結果を `versions` に保存する。
- `.zip` の場合、ZIP内部解析は未実装のためBMS解析値は `null` とする。

成功レスポンス例:

```json
{
  "songId": "song_xxx",
  "chartId": "chart_xxx",
  "versionId": "version_xxx",
  "fileId": "file_xxx",
  "displayVersion": "ver1.0",
  "progress": 45,
  "completed": false,
  "analysis": {
    "encoding": "utf-8",
    "playNotes": 4,
    "firstNoteMeasure": 1,
    "lastNoteMeasure": 3,
    "targetMeasureCount": 3,
    "measureNotes": {
      "schemaVersion": 1,
      "firstMeasure": 1,
      "lastMeasure": 3,
      "targetMeasureCount": 3,
      "playNotes": 4,
      "lnPolicy": "count_start_only",
      "measures": [
        { "measure": 1, "playNotes": 2 },
        { "measure": 2, "playNotes": 0 },
        { "measure": 3, "playNotes": 2 }
      ]
    }
  },
  "warnings": []
}
```

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

## 主な警告

警告は投稿を失敗させず、成功レスポンスの `warnings` と `post_logs.detail` に残す。

| code | 内容 |
| --- | --- |
| `BMS_METADATA_PARSE_FAILED` | BMSメタデータの自動読取に失敗した。フォーム入力値を使う。 |
| `BMS_ANALYSIS_FAILED` | BMS小節解析に失敗した。解析カラムは `null` として投稿を継続する。 |
| `BMS_NO_PLAY_NOTES` | プレイノートが見つからなかった。解析値は0件として保存する。 |
| `BMS_UNSUPPORTED_CHANNEL_PATTERN` | 未対応のチャンネル表記があり、その行を解析対象外にした。 |

## 管理ログ用コード

| code | level | 内容 |
| --- | --- | --- |
| `R2_USAGE_EXCEEDED_8GB` | `warning` | R2使用量が8GBを超えた。 |
| `AUTO_FILE_DELETE_SUCCEEDED` | `info` | DL不可から30日経過したR2ファイルの自動削除に成功した。 |
| `AUTO_FILE_DELETE_FAILED` | `error` | DL不可から30日経過したR2ファイルの自動削除に失敗した。 |
