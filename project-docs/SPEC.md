# BMS WIP Charts 仕様書

## 目的

BMS差分をログイン不要で共有できる1ページサイトを作る。初回投稿と追記投稿を受け付け、作成途中の差分譜面を進捗マップ付きで共有できるようにする。

## 公開情報

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/bms-wip-charts/
- 本番Worker URL: https://bms-wip-charts-worker.monsta3228gsl.workers.dev

## 現在の実装範囲

実装済み:

- GitHub Pages の静的1ページUI
- GitHub Pages から本番Worker APIへの一覧取得、初回投稿、追記投稿UI
- 一覧側のversion分岐ツリー表示
- 一覧側の完成到達後の中間version折り畳み/展開UI
- `GET /api/charts` のD1実データ読み取り
- `POST /api/charts` の初回投稿
- `POST /api/charts/:chartId/versions` の追記投稿
- `GET /api/files/:fileId` のR2実ダウンロード
- `GET /api/progress-images/:versionId` のR2進捗画像取得
- 没譜面初回投稿の `progress=100` 強制
- Worker側BMS解析による `play_notes` / 小節情報保存
- フロント側進捗マップUI
- 初回投稿時と追記投稿時の `progress_map_json` 保存
- フロント側での進捗PNG生成、FormData添付、R2保存
- `versions.progress_image_*` metadata保存
- 一覧側の `progressMap` 簡易サムネイル表示
- 分岐version管理、`branch_path` 生成、完成到達時の親version DL不可化
- `versions.file_deleted_at` / `versions.file_delete_reason` の自動削除準備カラム

未実装:

- 一覧サムネイルのR2進捗画像への完全切替
- ZIP内部のBMS解析
- 取り下げAPI
- 削除申請API
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除本体
- Turnstile
- お気に入り★
- 本格的な譜面ミニビュー

## 画面仕様

### 全体構成

- 1ページサイトとする。
- ページ上部に投稿フォームを表示する。
- ページ下部に投稿一覧を表示する。
- ログインは不要とする。
- 管理人承認は行わず、投稿後すぐ公開する。

### 投稿フォーム

フォームは以下のセクションに分ける。

1. 譜面ファイル
2. 楽曲情報
3. 差分情報
4. 進捗・管理
5. コメント

必須項目:

- 譜面ファイル
- 曲名
- アーティスト
- 仮差分名
- 想定難易度
- 差分作者
- 進捗度
- 管理パスワード

通常フォームでは `level` の見える入力欄を表示しない。ユーザーが入力・閲覧する難易度は「想定難易度」に統一する。

### 追記投稿UI

一覧の各version行に `追記投稿` ボタンを表示する。ボタンを押すと、ページ上部の投稿フォームを追記モードへ切り替える。

追記モードでは以下を行う。

- 楽曲情報と仮差分名は追記元を引き継ぐため入力欄を隠す。
- 親versionの `difficulty` / `level` を想定難易度UIへ初期反映し、編集可能にする。
- 親versionの `progressMap.layers` を読み取り専用の親layerとして表示する。
- 今回追記分は最後の `followup` layerとして編集する。
- API送信時は `title`, `artist`, `chartName`, `isRejected` は送らない。

追記モードでは以下を禁止する。

- `isRejected=true` の送信
- 没譜面versionからの追記
- `progressMap` を持たない古いversionからの画面追記
- 今回追記分のlayerが空のままの送信

完成versionに置き換えられた中間履歴versionでは、一覧UI上で追記投稿ボタンをdisabledまたは非表示にし、`追記不可` として扱う。

## 進捗マップUI

投稿フォーム内の「進捗・管理」セクションに進捗マップUIを表示する。

1. 上段: 下段の標準化ブロックと1対1対応するプレイノート密度棒グラフ。読み取り専用。
2. 下段: 進捗を塗るための標準化ブロック。クリック/範囲ドラッグで編集可能。

対象ファイル:

- `.bms`
- `.bme`
- `.bml`

`.zip`、プレイノートなしBMS、解析失敗時は進捗マップを表示しない、または控えめなメッセージを表示する。

### BMS解析範囲

プレイノート範囲と、進捗マップの表示・進捗対象範囲は別に管理する。

- `first_note_measure` は最初のプレイノート小節。
- `last_note_measure` は最後のプレイノート小節。
- `displayFirstMeasure` は最初のプレイノート小節。
- `displayLastMeasure` は曲終端小節。
- `target_measure_count` は `displayFirstMeasure` から `displayLastMeasure` までの小節数。
- `progressMap.blocks`、進捗マップUI、進捗PNGは `displayFirstMeasure` から `displayLastMeasure` までを基準にする。

曲終端候補:

- プレイノートチャンネル `11-19`, `21-29`, `51-59`, `61-69`
- BGM `01`
- 小節長 `02`
- BPM `03`, `08`
- STOP `09`

BGAだけの後ろ余白は進捗対象を延ばす理由にしない。曲頭側の完全な空白小節も通常表示に含めない。

`measure_notes_json` はschemaVersion 2として、以下のようにプレイノート範囲と表示範囲を分けて保存する。

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

既存投稿済みデータと既存PNGは自動再生成しない。新規投稿・追記投稿から新しい解析基準で保存する。

### progress計算

進捗度は標準化ブロック数で算出する。

```text
round(塗られた標準化ブロック数のunion / 標準化ブロック総数 * 100)
```

初回投稿では単一layerを送る。追記投稿では親versionまでのlayerを維持し、最後に今回追記分のlayerを追加して送る。

### 完成版にするボタン

- `progress >= 80` かつ `progress < 100` で有効化する。
- 押すと未塗りブロックをすべて塗る。
- `progress=100` にする。
- 追記投稿では今回追記layerに未塗り分を追加し、`progress=100` として送信する。

### 没譜面との連動

没譜面チェックON時:

- `progress=100`
- 進捗マップは全塗り扱い
- 進捗度欄は100固定
- 進捗マップの標準化ブロックは編集不可
- 初回投稿時にWorker側で `rejected_auto_fill` の全塗りlayerを生成する

没譜面チェックは初回投稿でのみ有効。追記投稿では指定できない。

## progress_map_json

標準化ブロック単位の進捗塗り情報を保存するJSON文字列。

```json
{
  "schemaVersion": 2,
  "blockMode": "standardized_measure",
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
    },
    {
      "versionId": "pending",
      "color": "#2563eb",
      "kind": "followup",
      "ranges": [[31, 40]]
    }
  ],
  "progress": 29
}
```

仕様:

- `schemaVersion=2` とする。
- `blockMode=standardized_measure` とする。
- `blocks` は下段の標準化ブロックと1対1対応する。
- `blocks` は曲終端基準の表示範囲まで作る。
- `ranges` は連続したブロックindexを `[startIndex, endIndex]` で圧縮して持つ。
- progressは全layerのunion / `targetBlockCount` で算出する。
- 重複して塗られたブロックは1回だけ数える。
- 初回投稿では1layerでよい。
- 追記投稿では親versionまでのlayerを維持し、今回追記分を最後のlayerとして保存する。
- Workerは追記投稿保存時、最後のlayerの `versionId` を今回作成したversion IDへ置き換える。
- 追記投稿では親versionのunionと同じ塗り範囲を `PROGRESS_MAP_UNCHANGED` で拒否する。

layerの `kind` 候補:

- `initial`
- `followup`
- `completion_fill`
- `rejected_auto_fill`

## progressImage PNG

`progressMap` が正データで、`progressImage` は表示・履歴確認用の派生データとする。

- フロント側で `progressMap` からCanvas描画し、PNG Blobを生成する。
- 初回投稿と追記投稿の `FormData` に `progressImage` として添付する。
- MIMEは `image/png`、filenameは `progress.png` とする。
- 進捗PNG生成に失敗した場合は投稿を止めず、`console.warn` に処理段階名付きで警告を残し、`progressImage` なしで投稿を継続してよい。
- Worker側では `progressImage` がある場合のみ検証・保存する。
- `progressImage` は任意項目であり、未送信の場合も投稿は成功してよい。
- PNGの表示終端は `progressMap.blocks` と同じ曲終端基準にする。

Worker側検証:

- MIMEが `image/png` であること。
- 空ファイルではないこと。
- サイズは1MB以下であること。

R2保存:

```text
charts/{chartId}/versions/{versionId}/progress/progress.png
```

DB保存:

- `versions.progress_image_key`
- `versions.progress_image_mime`
- `versions.progress_image_size`
- `versions.progress_image_sha256`
- `versions.progress_image_created_at`

譜面ファイル本体と進捗画像は別R2 objectとして扱う。将来、DL不可から30日経過した譜面ファイル本体を削除しても、進捗画像は履歴確認用として残す。

`GET /api/charts` は進捗画像が保存済みの場合に `progressImage` objectを返す。`GET /api/progress-images/:versionId` はR2からPNG本体を返す。

## 分岐version管理

単線version管理ではなく、分岐ツリー型version管理にする。

`versions` は以下を持つ。

- `parent_version_id`: 親version。rootだけNULL、それ以外は必須。
- `version_number`: 整数。APIの `displayVersion` 生成や内部管理に使う。
- `branch_label`: 同じ親からの分岐識別子。
- `branch_path`: ツリー表示、ページング、祖先DL制御、並び順に使う内部パス。

追記投稿では以下で分岐を生成する。

- `version_number = parent.version_number + 1`
- 同じ親を持つ既存子version数を数え、0件目を `a`、1件目を `b`、以降 `c`...`z`、`aa`... とする。
- `branch_path = parent.branch_path + '/' + branch_label` とする。

## progress=100到達時の親version DL制御

追記投稿で新versionのprogressが100になった場合、完成version自体はDL可能にする。

同一分岐上の祖先のうち `progress BETWEEN 1 AND 99` の途中versionのみ、以下を設定する。

- `download_blocked=1`
- `download_block_reason='superseded_by_completed_descendant'`
- `download_blocked_at=CURRENT_TIMESTAMP`
- `collapsed_by_completion=1`
- `collapsed_reason='superseded_by_completed_descendant'`
- `collapsed_at=CURRENT_TIMESTAMP`
- `collapsed_by_version_id=<new version id>`

この処理ではD1行やR2ファイルは物理削除しない。DL不可から30日経過したR2譜面ファイル削除は、将来のCron Triggerで実行する。進捗画像は譜面ファイル削除後も残す。

## 投稿一覧

投稿一覧では、song単位で曲名とアーティストを表示し、その下にchart単位の差分を表示する。version行では曲名・アーティスト・サブタイトル・サブアーティストを繰り返さない。

各version行には以下を表示する。

- 表示専用の版ラベル。rootは `BASE`、子孫は `1`, `1-1`, `1-2`, `1-2-1` のように `branchPath` から数字パスとして生成する。
- 親version表示。rootは `起点`、子versionは `from BASE`, `from 1`, `from 1-2` のように表示する。
- 重要状態バッジ。通常表示は `完成`, `没譜面`, `DL不可`, `削除申請中`, 管理非表示系に限定する。
- 想定難易度
- 差分作者
- 進捗度
- `progressMap` がある場合の簡易進捗サムネイル
- コメントの短い表示
- DLボタンまたはDL不可ボタン
- 追記投稿ボタン

現時点の一覧サムネイルは `progressMap` から再描画する。`progressImage` を一覧サムネイルへ完全利用する処理は次フェーズ以降で行う。

## 自動削除準備

将来、Cloudflare Workers Cron Triggerで1日1回程度、DL不可から30日経過したversionのR2譜面ファイルを整理する。

MVPの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。

自動削除時はD1行を物理削除せず、`is_hidden=1` と `hidden_reason='auto_deleted_after_download_block'` にし、`file_deleted_at` と `file_delete_reason` を保存する。進捗画像は履歴確認用として残す。

## API仕様

既存API:

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts`
- `POST /api/charts/:chartId/versions`
- `GET /api/files/:fileId`
- `GET /api/progress-images/:versionId`
- `POST /api/admin/hide-version`
- `POST /api/admin/ban`

APIエラーは必ず JSON で `code`, `message`, `detail` を返す。

主な進捗画像エラー:

| code | message |
| --- | --- |
| `INVALID_PROGRESS_IMAGE` | 進捗画像が不正です。 |
| `PROGRESS_IMAGE_TOO_LARGE` | 進捗画像のサイズが上限を超えています。 |
| `PROGRESS_IMAGE_UPLOAD_FAILED` | 進捗画像の保存に失敗しました。 |
| `PROGRESS_IMAGE_NOT_FOUND` | 進捗画像が見つかりません。 |
| `PROGRESS_IMAGE_UNAVAILABLE` | この進捗画像は表示できません。 |
| `PROGRESS_IMAGE_R2_NOT_FOUND` | 進捗画像ファイルが見つかりません。 |

ログ方針:

- エラーは握りつぶさない。
- `console.error` には処理段階名を含める。
- 秘密情報、APIキー、トークン、生IP、生UA、生パスワードはログに出力しない。
