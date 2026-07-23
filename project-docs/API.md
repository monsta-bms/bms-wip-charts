# API仕様

## CHART-MINIVIEW-01

新規投稿・追記でWorkerのBMS解析に成功した場合、`measure_notes_json`をschemaVersion 3として保存する。schemaVersion 2の既存項目は維持し、`miniView`へ元BMSの分数位置を保持する圧縮イベント列を保存する。`miniView`全体は32KiB以下とする。

`GET /api/charts`は完全なpayloadを除外し、versionへ次だけを追加する。

```json
{
  "miniView": {
    "available": true,
    "mode": "7key-sp",
    "url": "/api/versions/version_xxx/mini-view"
  }
}
```

### GET /api/versions/:versionId/mini-view

認証不要の読み取り専用API。versionとchartがともに公開中で、schemaVersion 3のready payloadがある場合だけ返す。

```json
{
  "versionId": "version_xxx",
  "miniView": {
    "schemaVersion": 3,
    "mode": "7key-sp",
    "laneOrder": ["scratch", "key1", "key2", "key3", "key4", "key5", "key6", "key7"],
    "startMeasure": 1,
    "endMeasure": 3,
    "startPosition": 1,
    "endPosition": 3.75,
    "noteCount": 1200,
    "tapCount": 1160,
    "longNoteCount": 40,
    "eventEncoding": "grouped-varint-v1",
    "eventGroupCount": 123,
    "eventData": "...",
    "measureLengths": [[3, 0.75]],
    "initialBpm": 150,
    "bpmEvents": [[3, 1, 4, 202.5]]
  }
}
```

`eventData`は同じ小節・レーン・種別・分母のイベントをまとめたvarint列で、各イベントの`pairIndex/pairCount`を丸めず復元できる。`measureLengths`は長さ1.0以外の小節だけを`[measure, length]`で保持する。`startPosition/endPosition`とprogressMap blockの同名値は小節長累積の共通座標である。schemaVersion 3の`initialBpm`は宣言された初期値またはNULL、`bpmEvents`は`[measure, numerator, denominator, bpm]`でchannel 03/08の変化を保持する。schemaVersion 2はBPM情報なしで取得可能とし、schemaVersion 1だけを`MINIVIEW_NOT_AVAILABLE`とする。一覧APIには引き続き完全payloadを含めない。

成功時は`Cache-Control: public, max-age=300, stale-while-revalidate=300`とpayload SHA-256由来の`ETag`を返し、`If-None-Match`一致時は304とする。

| HTTP | code | 条件 |
| ---: | --- | --- |
| 404 | `MINIVIEW_NOT_AVAILABLE` | version/chartが非公開、存在しない、measure notes schemaVersion 2、miniView payload schemaVersion 1、またはunsupported |
| 500 | `MINIVIEW_READ_FAILED` | D1読込または保存JSON解析に失敗 |

ミニビューwarningは投稿レスポンスの既存warningsへ追加するが、投稿自体は成功可能とする。warning detailへBMS本文やイベント一覧は含めない。

## Turnstile投稿認証

対象:

- `POST /api/charts`
- `POST /api/charts/:chartId/versions`

Pagesはmultipart bodyとは別に、次のヘッダーでtokenを送る。

```http
X-Turnstile-Token: <turnstile-token>
```

`X-Turnstile-Token`はCORSの`Access-Control-Allow-Headers`で許可する。既存のOrigin allowlistは変更しない。WorkerはBANと投稿レート制限の後、multipart解析より前にSiteverifyを実行し、共通action `chart_submit`と許可hostnameを照合する。

requiredモードのエラー:

| HTTP | code | 条件 |
| ---: | --- | --- |
| 400 | `TURNSTILE_REQUIRED` | tokenがない |
| 403 | `TURNSTILE_FAILED` | token不正、期限切れ、再利用、長さ超過、hostname/action不一致 |
| 503 | `TURNSTILE_UNAVAILABLE` | Secret不足、許可hostname設定不足、timeout、Siteverify障害・不正レスポンス |

レスポンスはSiteverifyの詳細error code、token、Secret、IP、UAを含めない。拒否ログは既存action、`result=rejected`、上記error code、`stage=pre_multipart_turnstile`、安全な判定分類、再試行有無を使用する。`TURNSTILE_REQUIRED`と`TURNSTILE_FAILED`はclient rejected投稿レート制限へ含め、`TURNSTILE_UNAVAILABLE`は含めない。

`TURNSTILE_MODE=observe`ではtokenなしの旧Pages投稿を許可し、tokenがある場合は検証するが、失敗しても投稿を止めない。observeは段階移行専用であり、本番最終状態は`required`とする。

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

既存の `versions` 追加カラム:

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
| `origin_url` | 原曲配布URLのversion単位snapshot。任意、NULL許可、最大2048文字。 |
| `chart_name` | そのversionの差分名snapshot。NULL時は`charts.chart_name`へfallbackする。 |
| `normalized_chart_name` | version差分名のNFKC・小文字化済み検索値。NULL時は`charts.normalized_chart_name`へfallbackする。 |

`charts.chart_name` / `charts.normalized_chart_name` は、初回投稿時の起点差分名として維持する。追記で別名を指定しても更新しない。既存versionはmigration `0005_version_chart_name.sql` でchartの値をbackfillする。

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
| `excludeChartId` | 空 | 指定した公開chartを一覧と`total`から除外する。トップの「選択中の投稿」と最近一覧の重複防止に使用する。英数字、`_`, `-`のみ、最大160文字。 |

検索対象は曲名、サブタイトル、アーティスト、サブアーティスト、公開中version自身の差分名、公開中versionの作者とする。検索結果の単位はchartであり、いずれかに一致したchartについて公開中versionをすべて返す。

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
- `originUrl`: 初回投稿時に登録され、追記では親から継承した原曲配布URL。未登録は`null`。
- `chartName`: そのversionの差分名。DB上の`versions.chart_name`がNULLの場合だけ起点の`charts.chart_name`へfallbackする。
- `allowAppend`: そのversionを親にした新しい追記・分岐を受け付けるかを示すboolean。

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
    "q": "",
    "excludeChartId": ""
  },
  "serverTime": "2026-07-18 03:04:05"
}
```

`serverTime`はD1の`CURRENT_TIMESTAMP`（UTC）であり、トップの相対時刻表示の基準にする。`excludeChartId`を指定した場合、一覧SELECTとCOUNTの両方へ同じ除外条件を適用する。

### GET /api/charts/:chartId

独立投稿一覧から指定されたchartをトップの詳細カードで開くため、公開中のchartを1件取得する。レスポンスのchart objectとversion objectは`GET /api/charts`と同じ整形処理を使用する。

レスポンス例:

```json
{
  "charts": [
    {
      "song": {},
      "chart": {},
      "versions": []
    }
  ],
  "serverTime": "2026-07-18 03:04:05"
}
```

公開条件:

- `charts.is_hidden = 0`
- `versions.is_hidden = 0`
- 詳細ツリーの復元に必要な`collapsed_by_completion = 1`の中間履歴も`versions`へ含める。
- 取り下げ、削除申請中、DL停止、没譜面は、公開状態である限り状態つきで返す。

存在しないchartと非公開chartは、情報を区別せずHTTP 404 `CHART_NOT_FOUND`を返す。IDが空、不正文字を含む、160文字を超える、またはURL encodingが不正な場合はHTTP 400 `INVALID_CHART_ID`とする。GET以外はHTTP 405 `METHOD_NOT_ALLOWED`とする。

レスポンスは`Cache-Control: no-cache`とし、追記、取り下げ、削除申請、DL停止、非公開化が再検証されるようにする。`serverTime`はD1の`CURRENT_TIMESTAMP`（UTC）を返す。既存のCORS方針を適用する。D1取得または整形に失敗した場合はHTTP 500 `CHART_DETAIL_QUERY_FAILED`を返し、SQLや内部例外を公開しない。

### GET /api/versions

独立投稿一覧 `list.html` 用に、公開versionを1行1件で取得する。トップの詳細一覧が使用する `GET /api/charts` とはページング単位が異なる。

公開条件:

- `charts.is_hidden = 0`
- `versions.is_hidden = 0`
- `COALESCE(versions.collapsed_by_completion, 0) = 0`

`withdrawn`, `deleteRequested`, `downloadBlocked` は、`is_hidden=0` である限り状態つきで返す。

クエリ:

| name | default | 内容 |
| --- | ---: | --- |
| `q` | 空 | 最大100文字。曲名、サブタイトル、アーティスト、サブアーティスト、差分名、そのversionの作者を部分一致検索する。`%`, `_`, `\\` は文字として扱う。 |
| `sort` | `new` | `new`: version投稿日時順。`updated`: chart更新日時、version投稿日時順。 |
| `status` | `all` | `all`, `incomplete`, `complete`, `rejected`。 |
| `dateFrom` | 空 | `YYYY-MM-DD`。指定日のJST 00:00以降を対象にする。片側指定可。 |
| `dateTo` | 空 | `YYYY-MM-DD`。指定日の翌JST 00:00未満を対象にする。片側指定可。 |
| `page` | `1` | 1始まりのversionページ番号。 |
| `pageSize` | `20` | version件数。最大100。 |

日付は実在する暦日を厳密に検証し、`dateFrom > dateTo`は拒否する。`sort=new`では`versions.created_at`、`sort=updated`では`charts.updated_at`へ同じ期間条件を適用する。境界は固定JST（UTC+9）で計算し、開始を含み、終了日の翌日00:00を含まない。

状態条件:

- `incomplete`: `completed_at IS NULL AND is_rejected = 0`
- `complete`: `completed_at IS NOT NULL AND is_rejected = 0`
- `rejected`: `is_rejected = 1`

レスポンス例:

```json
{
  "items": [
    {
      "versionId": "version_xxx",
      "chartId": "chart_xxx",
      "originUrl": "https://example.com/song",
      "file": {
        "downloadUrl": "/api/files/file_xxx"
      },
      "createdAt": "2026-07-17 01:02:03",
      "chartCreatedAt": "2026-07-10 00:00:00",
      "chartUpdatedAt": "2026-07-17 01:02:03",
      "rootCreatedAt": "2026-07-10 00:00:00",
      "title": "曲名",
      "subtitle": "",
      "artist": "artist",
      "subartist": "",
      "chartName": "差分名",
      "difficulty": "★12",
      "author": "author",
      "commentPreview": "短いコメントの先頭だけを返す",
      "hasComment": true,
      "progress": 60,
      "isRejected": false,
      "allowAppend": true,
      "withdrawn": false,
      "deleteRequested": false,
      "downloadBlocked": false,
      "branchPath": "root/a/b",
      "versionLabel": "1-2",
      "isNew": true,
      "newUntil": "2026-07-17 00:00:00"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "hasNext": false
  },
  "serverTime": "2026-07-17 01:02:03"
}
```

`chartName`は一覧行の対象version自身の差分名であり、起点差分名とは限らない。`q`の差分名検索も`COALESCE(versions.normalized_chart_name, charts.normalized_chart_name)`を使用する。

`originUrl`は対象version自身の原曲・本体URL snapshotで、未登録時は`null`。`file.downloadUrl`は既存Workerファイル配信APIの相対URLで、`file_id`をURL encodeして生成する。`download_blocked=1`、`withdrawal_download_blocked=1`、またはlifecycleが`processing/tombstoned`なら`null`とする。R2 URL、`r2_key`、`file_id`自体はレスポンスへ公開しない。

`isNew` はchartの初回公開日時から168時間以内かをD1時刻で判定する。追記によってNEW期間は延長しない。COUNTとSELECTは同じ公開・検索・状態条件を使用する。

### POST /api/versions/query

独立投稿一覧の「お気に入りのみ」で使用する。認証不要。`localStorage` のversion IDだけを受け取り、Workerが公開状態を再確認する。共有キャッシュは禁止し、レスポンスは `Cache-Control: no-store` とする。

request:

```json
{
  "favoriteVersionIds": ["version_xxx"],
  "q": "",
  "sort": "new",
  "status": "all",
  "dateFrom": "2026-07-01",
  "dateTo": "2026-07-31",
  "page": 1,
  "pageSize": 20
}
```

- `favoriteVersionIds` は文字列配列、重複除去後のversion ID単位、最大200件。
- 非公開または存在しないversionは `items` へ返さず、`unavailableFavoriteCount` に含める。
- 検索や状態で除外された公開お気に入りは `unavailableFavoriteCount` には含めない。
- `dateFrom`, `dateTo`の検証・JST境界・`sort`との対応は `GET /api/versions` と同じ。
- レスポンスのitemとpaginationは `GET /api/versions` と同じ形式で、`originUrl`と`file.downloadUrl`も同じDL可否判定で返す。

主なエラー:

- `INVALID_QUERY_PARAM`: GETクエリ不正、HTTP 400。
- `INVALID_FAVORITE_QUERY`: POST bodyまたはお気に入りID不正、HTTP 400。
- `VERSION_LIST_QUERY_FAILED`: D1読取り失敗、HTTP 500。SQLや内部detailは返さない。

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
- `originUrl` optional。原曲配布URL。
- `progress`
- `progressMap` optional JSON string
- `progressImage` optional `image/png` file
- `comment`
- `isRejected`
- `allowAppend`。新PagesはcheckboxのON/OFFを `true` / `false` で必ず送る。
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
- `allowAppend`は完全一致の文字列`true` / `false`だけを受け付ける。初回通常版はtrue固定、初回没譜面はtrue/falseを選択できる。項目がない旧Pagesでは、非没譜面をtrue、没譜面をfalseとして扱う。
- 初回通常版は完成版にできない。Worker再計算後のprogressが100なら `INITIAL_COMPLETION_NOT_ALLOWED` で拒否する。没譜面はprogress=100でも `completed=false`, `completedAt=null` とする。
- `originUrl`は空欄なら`NULL`。絶対HTTP/HTTPS URLだけを許可し、認証情報、制御文字、未エンコード空白を拒否する。fragmentを削除してqueryを維持し、正規化後も2048文字以内とする。外部URLへの通信は行わない。
- `chartName`は前後空白を除去し、100 Unicode code point以内とする。初回投稿では`charts`の起点差分名とBASE versionの差分名snapshotへ同じ値を保存する。

成功レスポンスには`chartName`, `isRejected`, `allowAppend`, `completed`, `completedAt`を含め、保存できた場合のみ `progressImage` objectを含める。

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

- `chartName`。今回作成するversionの差分名。旧Pages互換のため省略可能。
- `difficulty`
- `level`
- `comment`
- `isRejected`
- `allowAppend`。新PagesはcheckboxのON/OFFを `true` / `false` で必ず送る。
- `progressImage` optional `image/png` file

主な仕様:

- 許可拡張子、サイズ上限、R2保存、SHA256/MD5計算、単体BMS解析は初回投稿と同じ方針を使う。
- `progressMap` は必須。progressは送信値を信用せず、全layerのunionからWorker側で再計算する。
- `progressImage` が送られた場合、初回投稿と同じR2 key規則で保存する。
- 親versionは公開中、指定chart所属、`collapsed_by_completion=0`、`file_deleted_at IS NULL`、利用可能なprogressMapあり、`allow_append=1`を必須とする。`is_rejected=1`だけでは拒否しない。
- 公開中の取り下げ、削除申請、通常DL停止は、それだけを理由に追記拒否しない。
- 追記投稿の `isRejected=true` は `FOLLOWUP_REJECTED_NOT_ALLOWED` で拒否する。
- 未完成の子versionは `allowAppend=true` 固定とし、falseは `APPEND_POLICY_LOCKED_FOR_INCOMPLETE` で拒否する。明示的な完成版だけtrue/falseを選択できる。項目がない旧Pagesではtrueとして扱う。
- 完成版は最後の子layerが `completion_fill` で、Worker再計算progressが100の場合だけ成立する。`completionBaseRanges` と親layerのunionが80%未満なら `COMPLETION_PROGRESS_TOO_LOW` で拒否する。未完成親から完成指定なしで100%を送った場合は `COMPLETION_ACTION_REQUIRED` で拒否する。
- 親の軽量確認はmultipart解析直後、ファイルhash・BMS/ZIP解析・R2保存より前に行う。D1 INSERT時にも親条件を再確認し、競合で不成立なら子versionを作成せず、先に保存した譜面R2 objectをcleanupする。
- 未完成の親versionでprogressMap unionが同じ塗り範囲の場合は `PROGRESS_MAP_UNCHANGED` で拒否する。完成済みの親versionは、正規化後の子レイヤーに有効な区間が1件以上ある場合だけ、unionが100%のままでも通常追記できる。通常子の空rangesは `PROGRESS_MAP_UNCHANGED` と「追記する進捗範囲を1つ以上選択してください。」で拒否する。
- 新versionの`originUrl`は親versionのDB値をコピーする。追記リクエストからのURL入力は受け付けない。
- 新versionの差分名は、空でない有効な送信`chartName`、親versionの`chart_name`、起点の`charts.chart_name`の順で決定する。送信値を省略した旧Pagesは親名を継承する。
- 追記で別名を指定しても`charts.chart_name`は更新しない。新versionの`chart_name` / `normalized_chart_name`だけをsnapshotとして保存する。

成功レスポンス例:

```json
{
  "chartId": "chart_xxx",
  "parentVersionId": "version_parent",
  "versionId": "version_new",
  "displayVersion": "ver2.0-a",
  "branchPath": "root/a",
  "chartName": "[ANOTHER]",
  "progress": 72,
  "isRejected": false,
  "allowAppend": true,
  "completed": false,
  "completedAt": null,
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
| `INVALID_ALLOW_APPEND` | 400 | `allowAppend`が完全一致の`true` / `false`以外。 |
| `APPEND_POLICY_LOCKED_FOR_INCOMPLETE` | 400 | 初回通常版または追記の未完成版で`allowAppend=false`が指定された。 |
| `INITIAL_COMPLETION_NOT_ALLOWED` | 400 | 初回通常投稿がWorker再計算で完成状態になった。 |
| `FOLLOWUP_REJECTED_NOT_ALLOWED` | 400 | 追記投稿で`isRejected=true`が指定された。 |
| `COMPLETION_PROGRESS_TOO_LOW` | 400 | 完成版指定前の親・子進捗unionが80%未満。 |
| `COMPLETION_ACTION_REQUIRED` | 400 | 未完成親から完成版指定なしでprogress=100が送られた。 |
| `PASSWORD_REQUIRED` | 400 | 管理パスワードが未入力。 |
| `INVALID_ORIGIN_URL` | 400 | 原曲配布URLが絶対HTTP/HTTPS URLではない、認証情報・制御文字・未エンコード空白を含むなど不正。 |
| `ORIGIN_URL_TOO_LONG` | 400 | 原曲配布URLが正規化前または正規化後に2048文字を超える。 |
| `SERVER_CONFIG_ERROR` | 500 | `HASH_SECRET` などサーバー設定が不足。 |
| `INVALID_PROGRESS` | 400 | `progress` が0〜100の整数ではない。 |
| `INVALID_PROGRESS_MAP` | 400 | `progressMap` がJSONとして不正、または必須構造を満たさない。 |
| `PROGRESS_MAP_OUT_OF_RANGE` | 400 | `progressMap.layers[].ranges` がブロック範囲外を指している。 |
| `PROGRESS_MAP_BLOCK_COUNT_MISMATCH` | 400 | `progressMap.targetBlockCount` と `blocks.length` が一致しない。 |
| `PROGRESS_MAP_UNCHANGED` | 409 | 追記投稿の塗り範囲が親versionと同じ、または完成済み親への通常子で有効な新規rangeがない。 |
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
| `PARENT_APPEND_DISABLED` | 409 | 追記元versionの `allow_append=0` により追記・分岐受付が停止中。 |
| `PARENT_APPEND_CONFLICT` | 409 | 条件付きINSERTが0件となり、その後の親version再検証はすべて通過した。親状態または保存条件の競合として再読込を案内する。 |
| `TITLE_ARTIST_MISMATCH` | 409 | 追記ファイルの `#TITLE` / `#ARTIST` が追記先songと一致しない。 |
| `BRANCH_CREATE_FAILED` | 500 | 分岐suffix/branch_pathの作成またはDB unique競合処理に失敗。 |
| `VERSION_INSERT_FAILED` | 500 | 追記versionのD1保存に失敗。 |
| `R2_UPLOAD_FAILED` | 500 | 譜面ファイル本体のR2保存に失敗。 |
| `FILE_NOT_FOUND` | 404 | fileIdに対応するversionがない。 |
| `FILE_NOT_AVAILABLE` | 403 | versionまたはchartが非表示。 |
| `FILE_DOWNLOAD_BLOCKED` | 403 | versionのDLがブロックされている。 |
| `R2_FILE_NOT_FOUND` | 404 | D1 metadataはあるが譜面R2 objectがない。 |
| `R2_DOWNLOAD_FAILED` | 500 | R2からの取得に失敗。 |
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

### Scheduled R2 cleanup

HTTP APIを自己呼び出しせず、Workerの`scheduled()` handlerが手動cleanupと同じ内部処理を直接呼び出す。Cronは`0 18 * * *`（毎日UTC 18:00、JST 03:00）で、30日以上経過した候補を最大20件、`hidden_at ASC, version ID ASC`で取得して逐次処理する。新しいSecret、Binding、管理認証は使用しない。

各候補はR2操作直前にD1から再取得する。対象外へ変化していた場合は`outcome='skipped_state_changed'`としてR2を変更しない。R2 object不在は`outcome='r2_object_missing_reconciled'`としてD1を修復し、同時実行で別処理がD1更新を完了していた場合は`outcome='concurrent_completed'`として冪等成功扱いにする。

個別結果は既存の`r2_cleanup_delete_file` / `r2_cleanup_delete_file_failed`へ`trigger`, `runId`, `objectExisted`, `d1Updated`を追加して記録する。実行全体は`admin_logs.action='r2_cleanup_cron_run'`へ候補・処理・削除・object不在修復・スキップ・失敗件数、上限、所要時間、scheduledTime、cron、エラーコード要約を記録する。raw R2 key、生IP、生UA、ADMIN_TOKEN、Secretは記録しない。

候補取得失敗時はR2操作を開始せずScheduled Eventを失敗終了する。個別失敗は記録して次候補へ進み、R2削除失敗ではD1を更新しない。R2削除後のD1更新失敗は次回のobject不在修復で回復する。progressImageおよびD1行は削除しない。

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
INVALID_ALLOW_APPEND
APPEND_POLICY_LOCKED_FOR_INCOMPLETE
INITIAL_COMPLETION_NOT_ALLOWED
FOLLOWUP_REJECTED_NOT_ALLOWED
COMPLETION_PROGRESS_TOO_LOW
COMPLETION_ACTION_REQUIRED
INVALID_PROGRESS_MAP
PROGRESS_MAP_OUT_OF_RANGE
PROGRESS_MAP_BLOCK_COUNT_MISMATCH
PROGRESS_MAP_UNCHANGED
CHART_NOT_FOUND
PARENT_VERSION_NOT_FOUND
PARENT_VERSION_CHART_MISMATCH
REJECTED_CHART_CANNOT_BE_EXTENDED
PARENT_APPEND_DISABLED
TITLE_ARTIST_MISMATCH
DUPLICATE_FILE
CHART_ALREADY_EXISTS
```

`INVALID_REJECTED_FLAG_FOR_FOLLOWUP` と `REJECTED_CHART_CANNOT_BE_EXTENDED` は、deploy直前の旧Workerが記録したログをrolling windowへ含めるための互換コードであり、新APIレスポンスでは返さない。`PARENT_APPEND_CONFLICT`, `POSTING_BLOCKED`, `POST_RATE_LIMITED`, `BAN_CHECK_FAILED`, `POST_RATE_LIMIT_CHECK_FAILED`およびサーバー起因エラーは数えない。

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

## ZIP内BMS解析

`POST /api/charts`と`POST /api/charts/:chartId/versions`のZIP投稿では、安全検査で取得した内部BMS/BME/BMLを単体BMSと同じWorker解析へ渡す。

- `file.sha256`: 外側ZIP全体のSHA-256
- `file.md5`: ZIP内譜面バイト列のMD5
- `metadata`: Workerが内部譜面から読んだTITLE/SUBTITLE/ARTIST/SUBARTIST/encoding
- `analysis`: Worker解析によるplayNotes、小節範囲、targetMeasureCount、measureNotes
- `progressMap.blocks`: Workerが内部譜面から再生成した標準ブロック。新規保存分は小節長累積座標の`startPosition/endPosition`を含む

`ZIP_PROGRESS_MAP_MISMATCH`は、クライアントblocksの改ざん・不一致、またはZIP追記時の親格子不一致に対してHTTP 400で返す。`ZIP_BMS_ANALYSIS_FAILED`は、内部譜面解析に失敗し、送信されたprogressMapを検証できない場合にHTTP 400で返す。両方ともclient rejected投稿レート制限対象とする。progressMapなしの解析失敗は投稿を許可し、`BMS_ANALYSIS_FAILED` warningを返す。内部バイト取得などWorker起因障害は既存`ZIP_INSPECTION_FAILED` HTTP 503とし、レート制限対象外とする。

## 公開BMS難易度表

認証不要の公開読み取りAPIとして、RC★とRC★★の2表を提供する。

| 表 | 取込用HTML | header | data |
| --- | --- | --- | --- |
| RC★ | `GET /difficulty-tables/rc-star` | `GET /api/difficulty-tables/rc-star/header.json` | `GET /api/difficulty-tables/rc-star/data.json` |
| RC★★ | `GET /difficulty-tables/rc-double-star` | `GET /api/difficulty-tables/rc-double-star/header.json` | `GET /api/difficulty-tables/rc-double-star/data.json` |

全ルートでGET/HEAD/OPTIONSを許可し、`Access-Control-Allow-Origin: *`を返す。その他のmethodはHTTP 405。不明な表IDはHTTP 400 `INVALID_DIFFICULTY_TABLE`、D1取得失敗はHTTP 503 `DIFFICULTY_TABLE_UNAVAILABLE`とし、内部SQLや例外詳細をレスポンスへ出さない。

header例:

```json
{
  "name": "リサイクルセンター RC★",
  "symbol": "RC★",
  "data_url": "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/difficulty-tables/rc-star/data.json",
  "level_order": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "他"]
}
```

dataは譜面objectの配列を返す。対象なしはHTTP 200の`[]`。

```json
[
  {
    "md5": "0123456789abcdef0123456789abcdef",
    "level": "5",
    "title": "曲名",
    "artist": "アーティスト",
    "url": "https://example.com/original-song?download=1",
    "url_diff": "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/files/file_xxx",
    "name_diff": "差分名 / 1-2",
    "bms_wip_original_difficulty": "st9",
    "bms_wip_chart_name": "差分名",
    "bms_wip_version": "1-2",
    "bms_wip_author": "差分作者",
    "bms_wip_completed_at": "2026-07-12T00:00:00.000Z",
    "bms_wip_subtitle": "サブタイトル",
    "bms_wip_subartist": "サブアーティスト"
  }
]
```

`url`は、MD5重複排除後に採用されたversion自身に有効な`origin_url`がある場合だけ出力し、未登録時はキー自体を省略する。`name_diff`と`bms_wip_chart_name`は採用version自身の`chart_name`を使用し、NULLの既存行だけ`charts.chart_name`へfallbackする。`url_diff`は常に従来どおり出力する。`org_md5`と外側ZIPのSHA-256は出力しない。header/取込HTMLは`Cache-Control: public, max-age=3600, must-revalidate`、dataは`public, max-age=60, must-revalidate`とし、すべてETagと`If-None-Match`による304応答に対応する。エラー応答は`Cache-Control: no-store`とする。

## WITHDRAWAL-LIFECYCLE-16A

### `POST /api/versions/:versionId/withdrawal`

管理パスワードを検証し、利用者向けの取り下げ申請を作成する。`Content-Type: application/json`を使用する。

```json
{
  "password": "management password",
  "idempotencyKey": "client-generated-uuid"
}
```

`idempotencyKey`は16～200文字の英数字と`._:-`だけを許可する。Workerは`HASH_SECRET`でhash化した値だけを保存し、生値をログ・D1・レスポンスへ出さない。同じkeyの再送は既存結果を返し、別versionへの再利用はHTTP 409 `IDEMPOTENCY_KEY_REUSED`とする。

投稿から24時間以内で、DB上の直接子、`collapsed_by_version_id`参照、旧`delete_requests`、activeなlifecycle処理がなく、version/chartが公開中かつファイル未削除なら`requestMode=immediate`となる。それ以外は`requestMode=deferred`で、`scheduledAt`はD1現在時刻から7日後になる。分類と作成は条件付きINSERTで再確認し、immediate条件が競合で外れた場合はdeferredへ安全に切り替える。

```json
{
  "ok": true,
  "outcome": "withdrawal_pending",
  "lifecycleStatus": "withdrawal_pending",
  "requestMode": "deferred",
  "requestedAt": "2026-07-20 12:00:00",
  "scheduledAt": "2026-07-27 12:00:00",
  "canRequestWithdrawal": false,
  "canCancelWithdrawal": true,
  "requestPreview": "unavailable",
  "downloadAvailable": true,
  "appendAvailable": true
}
```

immediateの`outcome`は`immediate_delete_pending`、既存pendingへの冪等応答は`already_pending`。16Aではどちらも物理削除せず、pending行の作成だけを行う。

### `POST /api/versions/:versionId/withdrawal/cancel`

```json
{ "password": "management password" }
```

最新行が`pending`かつ`deferred`で、D1現在時刻が`scheduledAt`未満の場合だけ取消可能。成功時は`status=canceled`、`canceled_at/resolved_at/updated_at=CURRENT_TIMESTAMP`とし、version本体の`allow_append`、`download_blocked`、`withdrawn_at`、`is_hidden`は変更しない。7日ちょうど以降はHTTP 409 `WITHDRAWAL_CANCEL_EXPIRED`、immediateは`WITHDRAWAL_NOT_ALLOWED`、processingは`LIFECYCLE_OPERATION_IN_PROGRESS`。同じ取消の再送は`already_canceled`として成功してよい。

### `GET /api/versions/:versionId/lifecycle`

公開中versionの安全なlifecycle情報を認証なしで返す。内部の依存件数、lease、hashは返さない。応答は`Cache-Control: no-store`。

- `lifecycleStatus`: `active` / `withdrawal_pending` / `processing` / `legacy_withdrawn` / `legacy_delete_pending` / `tombstoned`
- `requestMode`, `requestedAt`, `scheduledAt`: activeまたは取消済みでは`null`
- `canRequestWithdrawal`, `canCancelWithdrawal`
- `requestPreview`: `immediate_delete` / `deferred_delete_or_tombstone` / `unavailable` / `legacy_process`
- `downloadAvailable`, `appendAvailable`

`GET /api/charts`、chart詳細、`GET /api/versions`、`POST /api/versions/query`が返すversionには`lifecycleStatus`、`requestMode`、`withdrawalRequestedAt`、`scheduledAt`、`canCancelWithdrawal`を追加する。一般一覧・検索・件数・お気に入り・RC★/RC★★は`pending/processing/tombstoned/deleted`を除外する。chart詳細だけはpendingをツリー文脈付きで返す。

pending中は既存のDL状態と`allow_append`を維持する。processing/tombstoned/deletedはfile APIと追記APIで拒否する。

### エラーコード

- `INVALID_IDEMPOTENCY_KEY` (400)
- `IDEMPOTENCY_KEY_REUSED` (409)
- `WITHDRAWAL_NOT_ALLOWED` (409)
- `WITHDRAWAL_NOT_PENDING` (409)
- `WITHDRAWAL_CANCEL_EXPIRED` (409)
- `WITHDRAWAL_STATE_CONFLICT` (409)
- `LIFECYCLE_OPERATION_IN_PROGRESS` (409)
- `LEGACY_LIFECYCLE_ACTIVE` (409)
- `WITHDRAWAL_FAILED` (500)

既存の`POST /api/versions/:id/withdraw`と`POST /api/versions/:id/delete-request`は互換用として変更しない。新Pagesは新3routeだけを使用し、404時に旧APIへ自動fallbackしない。

### 取込HTMLのtheme query

`GET /difficulty-tables/:tableId`の取込HTMLは、任意の`theme` queryを受け付ける。

```text
?theme=white
?theme=default
?theme=dark
```

省略または不正値は`default`として扱う。queryは取込HTMLの背景・文字・リンク配色だけに適用し、`meta[name="bmstable"]`、header/data JSON、難易度表データ、ETag、キャッシュ時間、CORS、D1 queryへ影響しない。

## WITHDRAWAL-LIFECYCLE-16B

> 履歴仕様。pending中のDL可否と依存ありfinalizerは、後述の16Rを現行仕様として優先する。

### `POST /api/versions/:versionId/withdrawal`

即時要求は受付だけでなく、共通finalizerによるR2 cleanupとD1終端処理まで同期実行する。

物理削除が完了した場合:

```json
{
  "ok": true,
  "outcome": "immediate_deleted",
  "lifecycleStatus": "deleted",
  "requestMode": "immediate",
  "canRequestWithdrawal": false,
  "canCancelWithdrawal": false,
  "downloadAvailable": false,
  "appendAvailable": false
}
```

派生または参照を維持する墓標になった場合は`outcome="tombstoned"`、`lifecycleStatus="tombstoned"`を返す。claim済みで完了待ちの場合はHTTP 202、`outcome="processing"`を返す。

同じ`idempotencyKey`の再送では、`version_withdrawals`の既存結果をversion取得・パスワード照合より先に返す。物理削除後も同じ終端結果を返す。別versionへのkey再利用はHTTP 409 `IDEMPOTENCY_KEY_REUSED`とする。

### 公開APIのlifecycle制御

- 通常の`GET /api/charts`、version一覧、検索、難易度表は`processing/tombstoned/deleted`を返さない。
- `GET /api/charts/:chartId`は版ツリー接続のため`processing/tombstoned`を含められるが、作者、コメント、原曲URL、hash、進捗map、miniView、progressImage、ファイル情報を返さず、固定lifecycle文言だけを返す。
- `GET /api/files/:fileId`、`GET /api/progress-images/:versionId`、`GET /api/versions/:versionId/mini-view`はprocessing/tombstoned/deletedを404で扱い、内部状態、削除時刻、R2 keyを返さない。
- pendingは16Aどおり、既存の`download_blocked`と`allow_append`に従う。

### finalizerエラー

- `WITHDRAWAL_R2_DELETE_FAILED`: 譜面またはprogressImageのR2削除失敗。D1終端更新を行わず再試行可能にする。
- `WITHDRAWAL_D1_FINALIZE_FAILED`: R2処理後のD1終端更新失敗。次回はobject不在を修復経路として処理する。
- `WITHDRAWAL_LEASE_CONFLICT`: 有効なleaseまたは別処理との競合によりclaimできない。
- `LEGACY_LIFECYCLE_CONFLICT`: legacy lifecycle状態との競合。
- `EXTERNAL_VERSION_STATE_CONFLICT`: finalizer中に対象versionの状態が外部更新された。
- `PARENT_LIFECYCLE_UNAVAILABLE`: 追記親がprocessing/tombstoned/deletedで利用できない。

これらの内部detail、lease token、idempotency hash、raw R2 keyは公開レスポンスやログへ出さない。16Bはfinalizer用の公開APIおよびCronを追加しない。

## WITHDRAWAL-LIFECYCLE-16C

> 履歴仕様。候補分類は、後述の16Rのhandling mode基準を現行仕様として優先する。

16Cでは公開HTTP route、手動observe API、手動finalizer APIを追加しない。毎時Cron `0 * * * *`は、通常変数`WITHDRAWAL_CRON_MODE`が厳密に`observe`である場合だけ、期限到達済みの取り下げ候補を読み取り専用で分類する。リポジトリ既定値、未設定、不正値は`off`であり、`active`処理は未実装とする。

observeは`versions`、`version_withdrawals`、`charts`、`songs`、`delete_requests`、`post_logs`およびR2 objectを変更しない。既存finalizer、claim、lease更新、R2操作は呼び出さず、監視結果だけを既存`admin_logs.action='version_withdrawal_finalize'`へ`operation='withdrawal_cron_observe'`として記録する。通常候補の個別ログは作らず、`manual_review`または予期しない候補エラーだけを1実行最大5件記録する。公開レスポンスへの新しいエラーコード追加はない。

既存R2 cleanup Cron `0 18 * * *`は従来どおりR2 cleanupだけを実行する。Scheduled handlerは発火したCron式を完全一致で振り分け、同時刻に別イベントとして発火しても1 invocationで両処理を実行しない。

## WITHDRAWAL-LIFECYCLE-16R

16Rでは`POST /api/versions/:versionId/withdrawal`のJSON bodyを次とする。`reason`は`grace_auto_delete`と`manual_review`で必須、前後空白を除いた10～500文字とし、`immediate_delete`では省略できる。

```json
{
  "password": "management password",
  "idempotencyKey": "client-generated-key",
  "reason": "取り下げを希望する理由"
}
```

`GET /api/versions/:versionId/lifecycle`、preview相当の管理dialog取得、申請成功、取消成功は次の機械判定値を返す。

- `handlingMode`: `immediate_delete` / `grace_auto_delete` / `manual_review` / `null`
- `reasonRequired`: boolean
- `requestPreview`: `immediate_delete` / `grace_auto_delete` / `manual_review` / `unavailable` / `legacy_process`
- `scheduledAt`, `canCancelWithdrawal`, `downloadAvailable`, `appendAvailable`

pendingのgrace/manualは通常のchart/version一覧APIへ残り、`handlingMode`を返す。`downloadBlocked`は既存停止または取り下げ専用停止のどちらかが有効ならtrue。file APIは取り下げ専用停止中をHTTP 404 `FILE_NOT_FOUND`として扱い、既存`download_blocked`だけの場合のHTTP 403は維持する。RC★/RC★★はpendingも除外する。

理由エラー:

- `INVALID_WITHDRAWAL_REASON` (400): 必須理由が未入力、空白のみ、または10文字未満
- `WITHDRAWAL_REASON_TOO_LONG` (400): 500文字超過

### `GET /api/admin/version-withdrawals`

`Authorization: Bearer <ADMIN_TOKEN>`必須の読み取り専用一覧。現在は`handlingMode=manual_review`だけを受け付け、`page`、`pageSize`でページングする。返却項目はwithdrawal/version/chart識別情報、曲名・差分名・版表示、申請日時、申請理由、`handlingMode`、`status`、依存有無と直接子・折り畳み参照・旧削除申請の件数。公開APIから理由や内部依存件数は返さない。管理者の最終削除・墓標化操作は本APIに含めない。

期限到達時の自動処理対象は`status='pending' AND handling_mode='grace_auto_delete' AND scheduled_at<=CURRENT_TIMESTAMP`と、lease期限切れのimmediate/grace processingだけ。依存なしは物理削除、依存ありは`status=pending/handling_mode=manual_review`へ移し、R2・versionを削除しない。manual reviewはpending/processingともclaimしない。

## DIFFICULTY-TABLE-VIEW Phase A API互換

Migration `0009_version_source_metadata.sql`で、初回・追記ファイルから解析した元BMSメタ情報をD1内部へ保存する。Phase Aではこのテーブルを読む公開routeまたは管理routeを追加しない。

次の既存response形式は変更しない。

- `GET /api/charts`
- `GET /api/versions`
- `POST /api/versions/query`
- `/api/difficulty-tables/:tableId/data.json`
- 初回・追記の投稿成功response

source metadata、解析状態、内部error codeは上記responseへ含めない。バックフィルAPIはPhase Aの対象外とする。
