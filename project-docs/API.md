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
- `POST /api/charts/:chartId/versions` 追記投稿
- `GET /api/files/:fileId`
- GitHub Pages からの一覧取得
- GitHub Pages 投稿フォームからの初回投稿
- Worker側BMS解析: 単体 `.bms` / `.bme` / `.bml` のプレイノート数と対象小節情報を保存する
- フロント側進捗マップUI
- 初回投稿時の `progress_map_json` 保存
- 追記投稿時の `progress_map_json` 保存
- `GET /api/charts` の `progressMap` 返却

まだ実装しないもの:

- 追記投稿UI
- 取り下げ
- 削除申請
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理
- ZIP内部のBMS解析
- 進捗画像R2保存処理
- 一覧への進捗画像表示

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
| `progress_map_json` | 標準化ブロック単位の進捗塗りJSON。PROG-04Aで初回投稿時、BRANCH-01Aで追記投稿時に保存する。 |
| `progress_image_key` | 進捗画像のR2 key。未実装。 |
| `progress_image_mime` | 進捗画像MIME。MVP想定は `image/png`。未実装。 |
| `progress_image_size` | 進捗画像ファイルサイズ。未実装。 |
| `progress_image_sha256` | 進捗画像SHA256。未実装。 |
| `progress_image_created_at` | 進捗画像作成日時。未実装。 |
| `collapsed_by_completion` | 完成到達後に通常一覧で折り畳むか。BRANCH-01Aで同一分岐の途中versionに設定する。 |
| `collapsed_reason` | 折り畳み理由。BRANCH-01Aでは `superseded_by_completed_descendant`。 |
| `collapsed_at` | 折り畳み日時。 |
| `collapsed_by_version_id` | 折り畳み原因になった完成version ID。 |

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

PROG-04Aでは、フロント側で生成した `progressMap` を初回投稿時に `multipart/form-data` へ追加し、Worker側で検証・progress再計算後に `versions.progress_map_json` へ保存する。

BRANCH-01Aでは、追記投稿時にも `progressMap` を必須項目として受け取り、親versionの塗り情報を引き継いだJSONとして保存する。

### versionレスポンス追加フィールド

| response field | DB column | 内容 |
| --- | --- | --- |
| `playNotes` | `play_notes` | プレイノート総数。 |
| `firstNoteMeasure` | `first_note_measure` | 対象開始小節。 |
| `lastNoteMeasure` | `last_note_measure` | 対象終了小節。 |
| `targetMeasureCount` | `target_measure_count` | 対象小節数。 |
| `measureNotes` | `measure_notes_json` | 小節ごとのノート数JSONをparseした値。parseできない場合は `null`。 |
| `progressMap` | `progress_map_json` | 標準化ブロック単位の進捗塗りJSONをparseした値。未保存またはparse不可の場合は `null`。 |

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
  },
  "progressMap": {
    "schemaVersion": 2,
    "blockMode": "standardized_measure",
    "firstMeasure": 12,
    "lastMeasure": 87,
    "targetBlockCount": 76,
    "blocks": [],
    "layers": [],
    "progress": 45
  }
}
```

### progress_map_json仕様

標準化ブロック単位の進捗塗り情報を保存するJSON文字列。

```json
{
  "schemaVersion": 2,
  "blockMode": "standardized_measure",
  "firstMeasure": 4,
  "lastMeasure": 349,
  "targetBlockCount": 142,
  "blocks": [
    {
      "index": 0,
      "startMeasure": 4,
      "endMeasure": 7,
      "startTimeSec": 0,
      "endTimeSec": 2.1,
      "playNotes": 20
    }
  ],
  "layers": [
    {
      "versionId": "version_xxx",
      "color": "#1f7a5c",
      "kind": "initial",
      "ranges": [[0, 10], [20, 30]]
    }
  ],
  "progress": 23
}
```

仕様:

- `schemaVersion` は `2` とする。
- `blockMode` は `standardized_measure` とする。
- `blocks` はフロント下段の標準化ブロックと1対1で対応する。
- `ranges` は連続した塗り済みブロックindexを `[startIndex, endIndex]` で圧縮して持つ。
- `progress` は全layerのunionを `targetBlockCount` で割り、Worker側で再計算して保存する。
- 同じブロックが複数layerで塗られていても、進捗計算では1ブロックとして数える。
- 初回投稿では1layerを基本とし、Worker保存時に `versionId` を実IDへ置き換える。
- 追記投稿では既存layerを維持し、最後のlayerを今回作成したversion IDへ置き換えて保存する。
- 追記投稿では親versionのunionと同じ塗り範囲なら `PROGRESS_MAP_UNCHANGED` で拒否する。
- `progressMap` が未送信の場合、初回投稿では既存互換としてフォームの `progress` を保存する。
- `progressMap` が未送信の場合、追記投稿では `INVALID_PROGRESS_MAP` で拒否する。
- `isRejected=true` の場合は送信された `progressMap` を信用せず、Worker側で全塗りの `rejected_auto_fill` layerを生成し、`progress=100` として保存する。

`kind` 候補:

- `initial`: 初回投稿の通常塗り。
- `followup`: 追記投稿の今回追加分。
- `completion_fill`: 「完成版にする」で未塗りを全塗りした場合。
- `rejected_auto_fill`: 没譜面投稿でWorker側が全塗り扱いにした場合。

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
- `progress_map_json` 保存済みversionでは `progressMap` を返す。

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
- `progressMap` optional JSON string
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
- `progressMap` が送られた場合、Worker側でJSONを検証し、塗り済みunionから `progress` を再計算して保存する。
- `progressMap` の再計算結果を `versions.progress` に保存し、正規化したJSONを `versions.progress_map_json` に保存する。
- `progressMap` が未送信の場合は既存互換としてフォームの `progress` を保存する。
- `isRejected=true` の場合は、入力された `progress` と送信された `progressMap` に関係なく保存値を `progress=100` に強制する。
- `isRejected=true` の場合は、Worker側で全塗りの `rejected_auto_fill` progressMapを生成できる範囲で保存する。
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
  "progressMap": {
    "schemaVersion": 2,
    "blockMode": "standardized_measure",
    "firstMeasure": 1,
    "lastMeasure": 9,
    "targetBlockCount": 9,
    "blocks": [],
    "layers": [
      {
        "versionId": "version_xxx",
        "color": "#1f7a5c",
        "kind": "initial",
        "ranges": [[0, 3]]
      }
    ],
    "progress": 44
  },
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

### POST /api/charts/:chartId/versions

既存chartへ追記投稿する。BRANCH-01Aで実装済み。

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

受け付けない項目:

- `isRejected=true`

主な仕様:

- 許可拡張子、サイズ上限、R2保存、SHA256/MD5計算、単体BMS解析は初回投稿と同じ方針を使う。
- `HASH_SECRET` 未設定時は `SERVER_CONFIG_ERROR` を返す。
- `parentVersionId` のversionが存在しない、非表示、または `chartId` と一致しない場合は拒否する。
- 親versionが `is_rejected=1` の場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。
- 追記投稿で `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。
- 単体BMSで `#TITLE` / `#ARTIST` が読み取れる場合、追記先songと正規化比較し、不一致なら `TITLE_ARTIST_MISMATCH` で拒否する。
- 同じ `file_sha256` は `DUPLICATE_FILE` で拒否する。
- `progressMap` は必須。JSON構造、`schemaVersion=2`、`blockMode=standardized_measure`、`blocks.length=targetBlockCount`、`layers[].ranges` の範囲を検証する。
- progressは送信値を信用せず、全layerのunionからWorker側で再計算する。
- 親versionのprogressMap unionと同じ塗り範囲の場合は `PROGRESS_MAP_UNCHANGED` で拒否する。
- `difficulty` / `level` が未送信の場合は親versionから継承する。
- `level` が未送信で `difficulty` から数字を抽出できる場合は抽出値を保存する。
- 成功時は `post_logs.action='append_version'` / `result='accepted'` を記録する。
- 失敗時も可能な範囲で `post_logs.action='append_version'` / `result='rejected'` を記録する。
- D1登録失敗時はR2孤児ファイルを残さないよう削除を試み、削除失敗時は `admin_logs` に記録する。

分岐生成:

- `version_number = parent.version_number + 1`
- 親versionの既存子数を数え、0件目を `a`、1件目を `b`、以降 `c`...`z`、`aa`... とする。
- `branch_path = parent.branch_path + '/' + suffix`
- 例: 親 `root` の1つ目の追記は `root/a`、2つ目は `root/b`。
- 例: `root/a` への1つ目の追記は `root/a/a`。
- `displayVersion` はAPI側で `version_number` とbranch suffixから生成する。例: `ver2.0-a`。
- 競合時はDBのunique制約で検出し、`BRANCH_CREATE_FAILED` を返す。

progress=100時のDL制御:

- 新しく作成された `progress=100` version自体はDL可能にする。
- 同一分岐上の祖先のうち `progress BETWEEN 1 AND 99` のversionだけをDL不可にする。
- 対象祖先には以下を設定する。
  - `download_blocked=1`
  - `download_block_reason='superseded_by_completed_descendant'`
  - `download_blocked_at=CURRENT_TIMESTAMP`
  - `collapsed_by_completion=1`
  - `collapsed_reason='superseded_by_completed_descendant'`
  - `collapsed_at=CURRENT_TIMESTAMP`
  - `collapsed_by_version_id=<new version id>`
- `progress=100` の祖先や他分岐のversionは変更しない。
- D1行やR2ファイルの物理削除はしない。R2自動削除は将来のCron対象。

成功レスポンス例:

```json
{
  "chartId": "chart_xxx",
  "parentVersionId": "version_parent",
  "versionId": "version_new",
  "displayVersion": "ver2.0-a",
  "branchPath": "root/a",
  "progress": 72,
  "progressMap": {
    "schemaVersion": 2,
    "blockMode": "standardized_measure",
    "firstMeasure": 4,
    "lastMeasure": 80,
    "targetBlockCount": 77,
    "blocks": [],
    "layers": [],
    "progress": 72
  },
  "fileId": "file_xxx",
  "file": {
    "name": "append.bms",
    "size": 12345,
    "sha256": "...",
    "md5": "...",
    "downloadUrl": "/api/files/file_xxx"
  },
  "analysis": {
    "encoding": "utf-8",
    "playNotes": 1234,
    "firstNoteMeasure": 4,
    "lastNoteMeasure": 80,
    "targetMeasureCount": 77,
    "measureNotes": {}
  },
  "warnings": [],
  "message": "created"
}
```

curl.exe例:

```powershell
curl.exe -X POST "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/charts/chart_xxx/versions" ^
  -F "file=@C:\path\append.bms" ^
  -F "parentVersionId=version_parent" ^
  -F "difficulty=★12" ^
  -F "level=12" ^
  -F "author=tester" ^
  -F "progressMap={\"schemaVersion\":2,\"blockMode\":\"standardized_measure\",\"firstMeasure\":1,\"lastMeasure\":3,\"targetBlockCount\":3,\"blocks\":[{\"index\":0,\"startMeasure\":1,\"endMeasure\":1,\"startTimeSec\":null,\"endTimeSec\":null,\"playNotes\":4},{\"index\":1,\"startMeasure\":2,\"endMeasure\":2,\"startTimeSec\":null,\"endTimeSec\":null,\"playNotes\":0},{\"index\":2,\"startMeasure\":3,\"endMeasure\":3,\"startTimeSec\":null,\"endTimeSec\":null,\"playNotes\":8}],\"layers\":[{\"versionId\":\"version_parent\",\"color\":\"#1f7a5c\",\"kind\":\"initial\",\"ranges\":[[0,0]]},{\"versionId\":\"pending\",\"color\":\"#2563eb\",\"kind\":\"followup\",\"ranges\":[[1,2]]}],\"progress\":100}" ^
  -F "comment=追記テスト" ^
  -F "password=local-password"
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
| `INVALID_PROGRESS_MAP` | 400 | `progressMap` がJSONとして不正、または必須構造を満たさない。 |
| `PROGRESS_MAP_OUT_OF_RANGE` | 400 | `progressMap.layers[].ranges` がブロック範囲外を指している。 |
| `PROGRESS_MAP_BLOCK_COUNT_MISMATCH` | 400 | `progressMap.targetBlockCount` と `blocks.length` が一致しない。 |
| `PROGRESS_MAP_UNCHANGED` | 409 | 追記投稿の塗り範囲が親versionと同じ。 |
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
| `R2_ORPHAN_FILE` | `error` | D1登録失敗後のR2 cleanupにも失敗し、孤児ファイルが残った可能性がある。 |