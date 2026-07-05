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
- `GET /api/charts` のD1実データ読み取り
- `POST /api/charts` の初回投稿
- `POST /api/charts/:chartId/versions` の追記投稿
- `GET /api/files/:fileId` のR2実ダウンロード
- 没譜面初回投稿の `progress=100` 強制
- Worker側BMS解析による `play_notes` / 小節情報保存
- フロント側進捗マップUI
- 進捗マップ上段の標準化ブロック単位密度表示
- 初回投稿時と追記投稿時の `progress_map_json` 保存
- `GET /api/charts` の `progressMap` 返却
- 一覧側の `progressMap` 簡易サムネイル表示
- 分岐version管理、`branch_path` 生成、完成到達時の親version DL不可化
- `versions.file_deleted_at` / `versions.file_delete_reason` の自動削除準備カラム

未実装:

- 進捗画像PNGのR2保存
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
- 完成到達後の本格的な一覧折り畳み/展開UI
- お気に入り★
- 本格的な譜面ミニビュー

## 画面仕様

### 全体構成

- 1ページサイトとする。
- ページ上部に投稿フォームを表示する。
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

差分情報セクションは、`想定難易度 -> 仮差分名 -> 差分作者` の順にする。

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

### 追記投稿UI

一覧の各version行に `追記投稿` ボタンを表示する。ボタンを押すと、ページ上部の投稿フォームを追記モードへ切り替える。

追記モードでは以下を表示する。

- `追記投稿: verX.0 から` の見出し
- `displayVersion / branchPath` の追記元情報
- 追記元の曲名、アーティスト、仮差分名
- 追記元から継承した想定難易度。ユーザーは編集できる
- 追記元の `progressMap`

追記モードでは、楽曲情報と仮差分名は追記元を引き継ぐため入力欄を隠す。API送信時も `title`, `artist`, `chartName`, `isRejected` は送らない。

追記フォームの送信項目:

- `file`
- `parentVersionId`
- `author`
- `progressMap`
- `password`
- `difficulty` optional
- `level` optional
- `comment` optional

追記モードでは以下を禁止する。

- `isRejected=true` の送信
- 没譜面versionからの追記
- `progressMap` を持たない古いversionからの画面追記
- 今回追記分のlayerが空のままの送信

没譜面versionでは追記投稿ボタンをdisabledにし、`没譜面は追記できません` を表示する。

`progress=100` のversionから追記する場合は、フォームを開く前に確認ダイアログで警告する。

### 想定難易度UI

想定難易度欄は、テキスト入力ではなく「シンボルタブ + 数字チップ式UI」とする。

- シンボルタブ: `★`, `★★`, `sl`, `st`, `手入力`
- `★`: 1〜25
- `★★`: 1〜7
- `sl`: 1〜12
- `st`: 1〜15
- `手入力`: 2桁までの数字を含む自由入力

追記モードでは親versionの `difficulty` / `level` を初期値として反映し、ユーザーが編集できる。

## 進捗マップUI

投稿フォーム内の「進捗・管理」セクションに進捗マップUIを表示する。

1. 上段: 下段の標準化ブロックと1対1対応するプレイノート密度棒グラフ。読み取り専用。
2. 下段: 進捗を塗るための標準化ブロック。クリック/範囲ドラッグで編集可能。

対象ファイル:

- `.bms`
- `.bme`
- `.bml`

`.zip`、プレイノートなしBMS、解析失敗時は進捗マップを表示しない、または控えめなメッセージを表示する。

### フロント側BMS解析

フロント側でもWorker側と同じ簡易ルールでBMS本文を解析する。

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
- `#BPM`, `#BPMxx`, `#xxx03`, `#xxx08`, `#STOPxx`, `#xxx09`, `#xxx02` を可能な範囲で読み、標準化ブロックの秒数と密度計算に使う。
- 対象範囲は最初のプレイノート位置から最後のプレイノート位置までとし、途中の非プレイノート区間も進捗対象に含める。

### 表示ルール

- 緑系の面: 初回投稿または親versionまでの作成済み範囲。
- 青系の面: 追記モードで今回追加する範囲。
- 濃いグレーの縦線: 8ブロック区切り。
- 薄い線: 通常ブロック境界。
- 棒グラフ: 標準化ブロックごとのノーツ密度。

8ブロック区切り位置の下には、3桁ゼロ埋めの小節番号を表示する。表示スペースが狭い場合は16/32ブロック単位などに間引いてよい。

### 塗り操作

クリック操作:

- 未塗りブロックをクリックすると塗られる。
- 塗り済みブロックをクリックすると解除される。

追記モードでは親layerは読み取り専用とし、今回のfollowup layerだけを編集する。親だけで塗られているブロックは解除できない。親塗り済みブロックへの重ね塗りはできる。

### progress計算

進捗度は標準化ブロック数で算出する。

```text
round(塗られた標準化ブロック数のunion / 標準化ブロック総数 * 100)
```

初回投稿では単一layerを送る。追記投稿では親versionまでのlayerを維持し、最後に今回追記分のlayerを追加して送る。

### 完成版にするボタン

進捗マップ付近に「完成版にする」ボタンを表示する。

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

### 想定難易度とlevel

ユーザーが入力・閲覧する項目は `difficulty` に統一し、表示名は「想定難易度」とする。

`level` は内部値として扱う。

- 通常フォームでは `level` 入力欄を表示しない。
- 一覧では `difficulty` のみ表示し、`level` を併記しない。
- DB上の `versions.level` カラムは残す。
- `GET /api/charts` では既存API互換のため `level` を返してよい。
- 追記投稿では `difficulty` / `level` が未送信の場合、親versionの値を継承する。

### 没譜面チェック

没譜面チェック `isRejected` は初回投稿 `POST /api/charts` でのみ有効とする。

没譜面チェックON時:

- 進捗度を `100` にする。
- API側でも `isRejected=true` の場合は `progress=100` に強制する。
- `completed_at` を保存する。
- 難易度表掲載対象にする。
- 難易度表と一覧では没譜面バッジで通常の完成譜面と区別する。
- このversionからの追記は禁止する。

追記投稿で `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。

追記APIで親versionの `is_rejected=1` を検出した場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。

## progress_map_json

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

## 分岐version管理

単線version管理ではなく、分岐ツリー型version管理にする。

`versions` は以下を持つ。

- `parent_version_id`: 親version。rootだけNULL、それ以外は必須。
- `version_number`: 整数。表示時に `verX.0` 形式へ変換する。
- `branch_label`: 同じ親からの分岐識別子。
- `branch_path`: ツリー表示、ページング、祖先DL制御、並び順に使う内部パス。

追記投稿では以下で分岐を生成する。

- `version_number = parent.version_number + 1`
- 同じ親を持つ既存子version数を数え、0件目を `a`、1件目を `b`、以降 `c`...`z`、`aa`... とする。
- `branch_path = parent.branch_path + '/' + branch_label` とする。
- 例: 親 `root` の1件目は `root/a`、2件目は `root/b`。
- 例: `root/a` への1件目は `root/a/a`。

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

この処理ではD1行やR2ファイルは物理削除しない。DL不可から30日経過したR2譜面ファイル削除は、将来のCron Triggerで実行する。

## 投稿一覧

投稿一覧では、song単位で曲名とアーティストを表示し、その下にchart単位の差分を表示する。version行では曲名・アーティスト・サブタイトル・サブアーティストを繰り返さない。

各version行には以下を表示する。

- `displayVersion`
- `branchPath` の短い表示
- 想定難易度
- 差分作者
- 進捗度
- `progressMap` がある場合の簡易進捗サムネイル
- コメントの短い表示
- 没譜面バッジ
- DLリンクまたはDL不可表示
- 追記投稿ボタン

一覧の想定難易度は `difficulty` のみを表示する。`level` は併記しない。

### 分岐ツリー表示

BRANCH-01Cでは、同じchart内のversionsを `parentVersionId` と `branchPath` に基づいてツリー表示する。

表示例:

```text
ver1.0           root        20%
├ ver2.0-a       root/a      21%
└ ver2.0-b       root/b      35%
   └ ver3.0-b-a  root/b/a    100%
```

表示仕様:

- `branchPath` を `/` で分割し、depthを算出する。
- `depth=0` はrootとする。
- `depth=1` は `root/a`, `root/b` などとする。
- `depth=2` は `root/a/a` などとする。
- depthに応じてversion名の左paddingを増やす。
- 可能な範囲で薄いグレーのツリー線と `├` / `└` を表示する。
- スマホ幅ではツリー線やインデントを簡略化してよいが、親子関係は最低限分かるようにする。

ソート方針:

1. `branchPath` のツリー順
2. `versionNumber`
3. `createdAt`

同じ親からの分岐suffixは `a`, `b`, ... `z`, `aa` の自然順になるように扱う。

### completed / progress=100 表示

`progress=100` または `completed=true` のversionは、以下で目立たせる。

- 100%の進捗バッジ
- `完成` バッジ
- 薄い緑背景

注意:

- `progress=100` のversion自体はDL可能。
- DL可否は `downloadBlocked` を基準にする。

### downloadBlocked 表示

`downloadBlocked=true` のversionではDLリンクを無効化し、`DL不可` と表示する。

`downloadBlockReason` がある場合は、title属性などの控えめな補足として保持する。

理由候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `delete_requested`
- `admin_blocked`
- `admin_hidden`

### collapsedByCompletion 表示

本格的な折り畳み/展開UIは後続のTREE-01で扱う。

BRANCH-01Cでは、`collapsedByCompletion=true` が返っているversionを完全には消さず、薄い表示にする。

### 一覧側progressMapサムネイル

`progressMap` サムネイルは `layers[].ranges` のunionを緑系で表示する。追記UIでは親layerを薄い緑、今回追記layerを青で表示する。

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

PROG-01で `versions` に追加した主なカラム:

- `play_notes`
- `first_note_measure`
- `last_note_measure`
- `target_measure_count`
- `measure_notes_json`
- `progress_map_json`
- `progress_image_key` / `progress_image_*`
- `collapsed_by_completion` / `collapsed_*`

## 自動削除準備

将来、Cloudflare Workers Cron Triggerで1日1回程度、DL不可から30日経過したversionのR2ファイルを整理する。

MVPの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。

自動削除時はD1行を物理削除せず、`is_hidden=1` と `hidden_reason='auto_deleted_after_download_block'` にし、`file_deleted_at` と `file_delete_reason` を保存する。

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

`POST /api/charts/:chartId/versions` は `file`, `parentVersionId`, `author`, `progressMap`, `password` を必須として受け取る。Workerは追記元を検証し、分岐versionを作成し、progressMapのunionからprogressを再計算して保存する。

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
| `TITLE_ARTIST_MISMATCH` | 譜面ファイルの曲名またはアーティストが追記先と一致しません。 |
| `INVALID_PROGRESS` | 進捗度の値が不正です。 |
| `INVALID_PROGRESS_MAP` | 進捗マップ情報が不正です。 |
| `PROGRESS_MAP_OUT_OF_RANGE` | 進捗マップの範囲が不正です。 |
| `PROGRESS_MAP_BLOCK_COUNT_MISMATCH` | 進捗マップのブロック数が一致しません。 |
| `PROGRESS_MAP_UNCHANGED` | 追記投稿の塗り範囲が親versionと同じです。 |
| `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` | 追記投稿では没譜面チェックを指定できません。 |
| `REJECTED_CHART_CANNOT_BE_EXTENDED` | 没譜面から追記投稿はできません。 |
| `DUPLICATE_FILE` | 同じファイルは投稿できません。 |
| `CHART_NOT_FOUND` | 対象の差分が見つかりません。 |
| `PARENT_VERSION_NOT_FOUND` | 追記元のバージョンが見つかりません。 |
| `PARENT_VERSION_CHART_MISMATCH` | 追記元のバージョンが指定差分に属していません。 |
| `BRANCH_CREATE_FAILED` | 分岐番号の作成に失敗しました。 |
| `VERSION_INSERT_FAILED` | 追記データの保存に失敗しました。 |
| `R2_UPLOAD_FAILED` | ファイル保存に失敗しました。 |
| `DB_READ_FAILED` | データ取得に失敗しました。 |
| `DB_WRITE_FAILED` | データ保存に失敗しました。 |
| `SERVER_CONFIG_ERROR` | サーバー設定が不足しています。 |
| `UNKNOWN_ERROR` | 予期しないエラーが発生しました。 |
