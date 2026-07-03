# BMS WIP Charts 仕様書

## 目的

BMS差分をログイン不要で共有できる1ページサイトを作る。

## 公開情報

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/bms-wip-charts/
- 本番Worker URL: https://bms-wip-charts-worker.monsta3228gsl.workers.dev

## 現在の実装範囲

実装済み:

- GitHub Pages の静的1ページUI
- `GET /api/charts` のD1実データ読み取り
- `POST /api/charts` の初回投稿
- `GET /api/files/:fileId` のR2実ダウンロード
- GitHub Pages から本番Worker APIへの一覧取得/初回投稿
- 没譜面初回投稿の `progress=100` 強制
- Worker側BMS解析による `play_notes` / 小節情報保存
- `GET /api/charts` のBMS解析結果返却
- フロント側進捗マップUI
- 進捗マップ上段の標準化ブロック単位密度表示
- 初回投稿時の `progress_map_json` 保存
- `GET /api/charts` の `progressMap` 返却
- `versions.file_deleted_at` / `versions.file_delete_reason` の自動削除準備カラム
- PROG-01 進捗グラフ用DBカラムとJSON/API仕様

未実装:

- 進捗画像PNGのR2保存
- ZIP内部のBMS解析
- `POST /api/charts/:chartId/versions` の追記投稿
- 取り下げAPI
- 削除申請API
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除本体
- Turnstile
- 一覧への進捗画像表示
- 完成到達後の折り畳み表示
- お気に入り★
- 本格的な譜面ミニビュー

## 画面仕様

### 全体構成

- 1ページサイトとする。
- ページ上部に初回投稿フォームを表示する。
- ページ下部に投稿一覧を表示する。
- ログインは不要とする。
- 管理人承認は行わず、投稿後すぐ公開する。

### 初回投稿フォーム

フォームは以下のセクションに分ける。

1. 譜面ファイル
2. 楽曲情報
3. 差分情報
4. 進捗・管理
5. コメント

差分情報セクションには、差分に関する入力をまとめる。導線は以下の順にする。

1. 想定難易度
2. 仮差分名
3. 差分作者（別名義可）

進捗・管理セクションには、進捗マップ、進捗度、没譜面、管理パスワード、管理パスワード保存チェックをまとめる。

通常フォームでは `level` の見える入力欄を表示しない。ユーザーが入力・閲覧する難易度は「想定難易度」に統一する。

必須項目:

- 譜面ファイル
- 曲名
- アーティスト
- 仮差分名
- 想定難易度
- 差分作者
- 進捗度
- 管理パスワード

入力誘導:

- 曲名 placeholder: `一致していない場合修正してください。`
- アーティスト placeholder: `一致していない場合修正してください。`
- 仮差分名 placeholder: `例: [ANOTHER] / [ALITHER] / 仮差分`
- 仮差分名 補足: `同じ曲の別差分を区別するための名前です。`
- 差分作者 placeholder: `例: tester / anonymous`
- コメント placeholder: `音源URL、作業メモ、注意点など`

### 想定難易度UI

想定難易度欄は、テキスト入力ではなく「シンボルタブ + 数字チップ式UI」とする。

- シンボルタブ: `★`, `★★`, `sl`, `st`, `手入力`
- `★`: 1〜25
- `★★`: 1〜7
- `sl`: 1〜12
- `st`: 1〜15
- `手入力`: 2桁までの数字を含む自由入力

通常シンボルでは数字を常に1〜25まで表示する。シンボルごとの上限を超える数字はdisabledにしてクリック不可にする。

シンボル変更時、現在選択中の数字が新しいシンボルの上限を超える場合は最大値に丸める。

手入力モードでは、数字チップではなく自由入力欄を表示するが、難易度入力ブロック全体の高さは通常シンボル時と変えない。数字部分が3桁以上になる入力は受け付けない。

## 進捗マップUI

投稿フォーム内の「進捗・管理」セクションに、フロント側の進捗マップUIを表示する。

1. 上段: 下段の標準化ブロックと1対1対応するプレイノート密度棒グラフ。読み取り専用。
2. 下段: 進捗を塗るための標準化ブロック。クリック/範囲ドラッグで編集可能。

PROG-04Aでは、フロント側で作成した塗り状態を `progressMap` として初回投稿APIへ送信する。Workerは `progressMap` を検証し、progressを再計算した上で `versions.progress_map_json` と `versions.progress` に保存する。

### 表示条件

表示対象:

- `.bms`
- `.bme`
- `.bml`

未対応:

- `.zip`
- プレイノートなしBMS
- BMS解析失敗時

未対応時は控えめなメッセージを表示する。

例:

- `譜面ファイル選択後に進捗マップを表示します`
- `単体BMSのみ進捗マップを表示します`
- `プレイノートを検出できませんでした`
- `BMS解析に失敗しました`

### フロント側BMS解析

フロント側でもWorker側PROG-02と同じ簡易ルールでBMS本文を解析する。

対象チャンネル:

- `11`-`19`
- `21`-`29`
- `51`-`59`
- `61`-`69`

仕様:

- `#mmmcc:data` 形式のBMSデータ行を対象にする。
- `data` は2文字単位で読む。
- `00` はカウントしない。
- BGM/BPM/STOP/BGA/メタ情報はプレイノート数に含めない。
- LNはMVPとして `count_start_only` 扱いにする。
- `#BPM`, `#BPMxx`, `#xxx03`, `#xxx08` を読み、標準化ブロックの推定秒数と密度計算に使う。
- `#STOPxx`, `#xxx09` はMVPとして近似的に読み取る。
- `#xxx02` の小節長倍率を読み、標準化ブロックの算出に使う。
- `firstMeasure` は最初にプレイノートが出る小節。
- `lastMeasure` は最後にプレイノートが出る小節。

### 標準化ブロック密度グラフ

上段のグラフは、下段の `standardBlocks` 配列と同じ列構造で描画する。

- 上段の棒の本数は下段の標準化ブロック数と一致させる。
- 上段の1本の棒は、下段の1ブロックに対応する。
- 上段と下段は同じ表示範囲 `firstMeasure` 〜 `lastMeasure` を使う。
- 進捗対象外の曲頭空白小節は通常表示に含めない。
- 上段左端・右端・各区切り位置は下段ブロック列と揃える。
- 0密度のブロックも列として存在させ、下段との対応を崩さない。
- Canvasで棒グラフを描画する。
- 線グラフは使用しない。

棒の高さは、標準化ブロックごとに以下で計算した `densityValue` を相対スケーリングして表示する。

```text
densityValue = block.playNotes / (block.endTimeSec - block.startTimeSec)
```

`durationSec` が取れない、または0以下になる場合はfallbackとして `block.playNotes` を使う。

### 標準化ブロック

下段の編集ブロックは、BMSの生小節数ではなく、`#xxx02` を反映した標準化ブロックとして扱う。

基本方針:

- 通常長の1小節を1ブロック相当とする。
- `#xxx02` で短い小節が連続する場合は、標準化位置上で自然にまとまる。
- `#xxx02` で長い小節がある場合は、標準化位置上で複数ブロックに分かれる。
- 標準化ブロックの対象範囲は、最初のプレイノート位置から最後のプレイノート位置までとする。
- 対象範囲内にある無音・非プレイノート部分も進捗対象に含める。

### 表示ルール

意味を以下に固定する。

- 緑系の面: 作成済み・塗り済み範囲。
- 濃いグレーの縦線: 8ブロック区切り。
- 薄い線: 通常ブロック境界。
- 棒グラフ: 標準化ブロックごとのノーツ密度。

8ブロック区切り位置の下には小節番号を表示する。

- すべてのブロックには番号を表示しない。
- 基本は8ブロック区切り位置だけ表示する。
- 表示スペースが狭い場合は16/32ブロック単位などに間引いてよい。
- 標準化ブロックが複数実小節を含む場合は、代表として開始小節を表示する。
- スマホでは縮小表示または間引き表示を許容する。

進捗マップ付近には `play notes: xxxx / blocks: xx / progress: xx%` を表示する。必要に応じて `measures: first-last` も表示する。

### 塗り操作

クリック操作:

- 未塗りブロックをクリックすると塗られる。
- 塗り済みブロックをクリックすると解除される。

ドラッグ操作は範囲プレビュー方式とする。

- `pointerdown` 時に現在の塗り状態を `originalPaintedSet` として保存する。
- `pointerdown` したブロックを `anchorBlock` とする。
- 現在hoverしているブロックを `currentBlock` とする。
- `anchorBlock` から `currentBlock` までを `dragRange` とする。
- `anchorBlock` が未塗りなら、`dragRange` 内を塗る。
- `anchorBlock` が塗り済みなら、`dragRange` 内を解除する。
- `dragRange` 外は `originalPaintedSet` の状態に戻す。
- `pointerup` で確定する。

没譜面チェックON時は全ブロック塗り扱いにし、進捗マップの編集はできない。

### 位置参照UI

通常表示は軽くし、詳細情報はhover/右クリックで確認する。

hover表示:

- 小節範囲
- 秒数範囲
- notes

右クリックポップアップ:

- 該当ブロック上ではブラウザ標準の右クリックメニューを抑制してよい。
- 小節範囲、秒数範囲、notesを表示する。
- 今回は本格的な譜面ビューは実装しない。

将来拡張:

- 右クリックポップアップ内に7鍵/皿レーンの小型譜面ビューを表示する。
- 対象ブロック内のノーツ表示を行う。
- LN表示を行う。

### progress計算

進捗度は、小節数ではなく標準化ブロック数で算出する。

```text
round(塗られた標準化ブロック数 / 標準化ブロック総数 * 100)
```

算出した値は既存の進捗度欄 `progress` に反映する。初回投稿時は `progressMap` も送信し、Worker側で同じルールにより再計算した値を保存する。

手入力欄は残す。`progressMap` が送信されない場合の後方互換入力として使う。

### 完成版にするボタン

進捗マップ付近に「完成版にする」ボタンを表示する。

- `progress >= 80` かつ `progress < 100` で有効化する。
- 押すと未塗りブロックをすべて塗る。
- `progress=100` にする。
- 進捗度欄も100にする。
- 初回投稿時に `kind=completion_fill` のlayerとして保存する。

`completed_at` は投稿API側で `progress=100` の場合に保存する。進捗画像保存はまだ行わない。

### 没譜面との連動

没譜面チェックON時:

- `progress=100`
- 進捗マップは全塗り扱い
- 進捗度欄は100固定
- 進捗マップの標準化ブロックは編集不可
- 初回投稿時にWorker側で `kind=rejected_auto_fill` の全塗りlayerを生成する

没譜面チェックOFF時:

- 通常の進捗マップ操作に戻す。
- 進捗度欄も通常状態に戻す。

API側でも `isRejected=true` の場合は `progress=100` に強制する既存仕様を維持する。

## 投稿仕様

### 投稿対象ファイル

アップロード可能なファイル:

- `.bms`
- `.bme`
- `.bml`
- `.zip`

ファイルサイズ上限:

- 単体譜面ファイル: 2MBまで
- zipファイル: 5MBまで

音源ファイルのアップロードは禁止する。音源が必要な場合は、コメント欄にURLを貼る方式とする。

### BMSメタデータ

BMS/BME/BMLファイルから以下を取得・保存できるようにする。

- `title`
- `subtitle`
- `artist`
- `subartist`
- `md5`
- `level`

MD5はzipファイルではなく、BMS/BME/BMLファイル本体のMD5とする。

### 想定難易度とlevel

ユーザーが入力・閲覧する項目は `difficulty` に統一し、表示名は「想定難易度」とする。

`level` は内部値として扱う。

- 通常フォームでは `level` 入力欄を表示しない。
- 一覧では `difficulty` のみ表示し、`level` を併記しない。
- DB上の `versions.level` カラムは残す。
- `GET /api/charts` では既存API互換のため `level` を返してよい。
- 将来の難易度表APIでは `level` を返してよい。

## 没譜面チェック

没譜面チェック `isRejected` は初回投稿 `POST /api/charts` でのみ有効とする。

没譜面チェックON時:

- 進捗度を `100` にする。
- 進捗度欄をreadonlyまたはdisabledにする。
- API側でも `isRejected=true` の場合は `progress=100` に強制する。
- `completed_at` を保存する。
- completed扱いにする。
- 難易度表掲載対象にする。
- 難易度表と一覧では没譜面バッジで通常の完成譜面と区別する。
- このversionからの追記は禁止する。

追記投稿 `POST /api/charts/:chartId/versions` では `isRejected` を指定できない。将来の追記APIで `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。

将来の追記APIで親versionの `is_rejected=1` を検出した場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。

## 進捗グラフ保存仕様

### measure_notes_json

Worker側PROG-02で、単体BMS投稿時に小節ごとのプレイノート数を保存するJSON文字列。

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

### progress_map_json

標準化ブロック単位の進捗塗り情報を保存するJSON文字列。PROG-04Aでは初回投稿で保存する。

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

- `schemaVersion=2` とする。
- `blockMode=standardized_measure` とする。
- `blocks` は下段の標準化ブロックと1対1対応する。
- `ranges` は連続したブロックindexを `[startIndex, endIndex]` で圧縮して持つ。
- progressは全layerのunion / `targetBlockCount` で算出する。
- 重複して塗られたブロックは1回だけ数える。
- 初回投稿では1layerでよい。
- Workerは保存前にprogressを再計算し、`versions.progress` にも同じ値を保存する。
- `isRejected=true` の場合、送信されたprogressMapではなくWorker生成の全塗りprogressMapを保存する。

layerの `kind` 候補:

- `initial`
- `completion_fill`
- `rejected_auto_fill`

### 進捗画像仕様

進捗グラフ画像は、譜面ファイル本体とは別にR2へ保存する。未実装。

- 保存キー例: `charts/{chartId}/versions/{versionId}/progress/progress.png`
- 画像形式はPNG推奨。
- 譜面ファイル本体が `file_deleted_at` により削除済みになっても、進捗画像は残す。

## 分岐version管理

単線version管理ではなく、分岐ツリー型version管理にする。

同じbase versionから複数人が追記した場合は、両方を受け入れる。

`versions` は以下を持つ。

- `parent_version_id`: 親version。rootだけNULL、それ以外は必須。
- `version_number`: 整数。表示時に `verX.0` 形式へ変換する。
- `branch_label`: 同じ親からの分岐識別子。
- `branch_path`: ツリー表示、ページング、祖先DL制御、並び順に使う内部パス。

## 投稿一覧

投稿一覧では、song単位で曲名とアーティストを表示し、その下にchart単位の差分を表示する。

各version行には以下を表示する。

- 表示version名
- 想定難易度
- 差分作者
- 進捗度
- 没譜面バッジ
- コメント
- DLリンク
- 追記投稿ボタン

一覧の想定難易度は `difficulty` のみを表示する。`level` は併記しない。

将来の進捗グラフ対応後は、各version行または展開表示で進捗画像サムネイルを表示できるようにする。

## DB仕様

schema / migrationファイル:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `worker/migrations/0003_progress_graph_fields.sql`
- `schema/d1.sql`

主なテーブル:

- `songs`: 元曲単位。
- `charts`: 差分単位。
- `versions`: 分岐・履歴単位。
- `delete_requests`: 削除申請。
- `post_logs`: 投稿試行ログ。
- `bans`: BAN情報。
- `admin_logs`: 管理者向け操作ログ・運用ログ。

PROG-01で `versions` に追加したカラム:

| column | 内容 |
| --- | --- |
| `play_notes` | BMS解析で算出したプレイノート総数。 |
| `first_note_measure` | 進捗対象の開始小節。 |
| `last_note_measure` | 進捗対象の終了小節。 |
| `target_measure_count` | 進捗対象小節数。 |
| `measure_notes_json` | 小節ごとのプレイノート数JSON。 |
| `progress_map_json` | 標準化ブロック単位の塗りlayer JSON。 |
| `progress_image_key` | 進捗画像のR2 key。 |
| `progress_image_mime` | 進捗画像MIME。 |
| `progress_image_size` | 進捗画像ファイルサイズ。 |
| `progress_image_sha256` | 進捗画像SHA256。 |
| `progress_image_created_at` | 進捗画像作成日時。 |
| `collapsed_by_completion` | 完成到達後に通常一覧で折り畳むか。 |
| `collapsed_reason` | 折り畳み理由。 |
| `collapsed_at` | 折り畳み日時。 |
| `collapsed_by_version_id` | 折り畳み原因になった完成version ID。 |

## API仕様

APIエラーは必ず JSON で `code`, `message`, `detail` を返す。

既存API:

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts`
- `POST /api/charts/:chartId/versions`
- `GET /api/files/:fileId`
- `POST /api/admin/hide-version`
- `POST /api/admin/ban`

`POST /api/charts` は `progressMap` JSON文字列を受け取れる。Workerは `progressMap` のrangesからprogressを再計算し、`versions.progress` と `versions.progress_map_json` に保存する。

`GET /api/charts` のversionレスポンスでは以下も返せる。

- `playNotes`
- `firstNoteMeasure`
- `lastNoteMeasure`
- `targetMeasureCount`
- `measureNotes`
- `progressMap`

`progressImage` / `collapsedByCompletion` は後続Phaseで実装する。

## エラー設計

エラーレスポンス形式:

```json
{
  "code": "ERROR_CODE",
  "message": "ユーザー向けの短い説明",
  "detail": "原因追跡に使える詳細情報"
}
```

ログ方針:

- エラーは握りつぶさない。
- `console.error` には処理段階名を含める。
- 秘密情報、APIキー、トークン、生IP、生UA、生パスワードはログに出力しない。

主なエラーコード:

| code | message |
| --- | --- |
| `INVALID_FILE_TYPE` | 投稿できないファイル形式です。 |
| `FILE_TOO_LARGE` | ファイルサイズが上限を超えています。 |
| `AUDIO_FILE_NOT_ALLOWED` | 音源ファイルはアップロードできません。 |
| `ZIP_INSPECTION_FAILED` | zipファイルの検査に失敗しました。 |
| `TITLE_ARTIST_PARSE_FAILED` | 譜面情報の読み取りに失敗しました。 |
| `INVALID_PROGRESS` | 進捗度の値が不正です。 |
| `INVALID_PROGRESS_MAP` | 進捗マップ情報が不正です。 |
| `PROGRESS_MAP_OUT_OF_RANGE` | 進捗マップの範囲が不正です。 |
| `PROGRESS_MAP_BLOCK_COUNT_MISMATCH` | 進捗マップのブロック数が一致しません。 |
| `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` | 追記投稿では没譜面チェックを指定できません。 |
| `REJECTED_CHART_CANNOT_BE_EXTENDED` | 没譜面から追記投稿はできません。 |
| `DUPLICATE_FILE` | 同じファイルは投稿できません。 |
| `CHART_NOT_FOUND` | 対象の差分が見つかりません。 |
| `VERSION_NOT_FOUND` | 対象のバージョンが見つかりません。 |
| `FILE_NOT_FOUND` | ファイルが見つかりません。 |
| `R2_UPLOAD_FAILED` | ファイル保存に失敗しました。 |
| `R2_DOWNLOAD_FAILED` | ファイル取得に失敗しました。 |
| `DB_READ_FAILED` | データ取得に失敗しました。 |
| `DB_WRITE_FAILED` | データ保存に失敗しました。 |
| `ADMIN_AUTH_REQUIRED` | 管理者認証が必要です。 |
| `CORS_ORIGIN_NOT_ALLOWED` | 許可されていないOriginです。 |
| `METHOD_NOT_ALLOWED` | 許可されていないHTTPメソッドです。 |
| `CONFIG_MISSING` | 必要な設定が不足しています。 |
| `INTERNAL_ERROR` | 予期しないエラーが発生しました。 |

管理ログ用コード:

| code | level | 内容 |
| --- | --- | --- |
| `R2_USAGE_EXCEEDED_8GB` | `warning` | R2使用量が8GBを超えた。 |
| `AUTO_FILE_DELETE_SUCCEEDED` | `info` | DL不可から30日経過したR2ファイルの自動削除に成功した。 |
| `AUTO_FILE_DELETE_FAILED` | `error` | DL不可から30日経過したR2ファイルの自動削除に失敗した。 |
