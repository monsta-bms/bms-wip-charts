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
- 一覧側の `progressMap` ベース密度サムネイル表示と `progressImage.url` fallback表示
- 分岐version管理、`branch_path` 生成、完成到達時の親version DL不可化
- `versions.file_deleted_at` / `versions.file_delete_reason` の自動削除準備カラム
- versionId単位のブラウザ内お気に入り★とお気に入りのみ表示
- 投稿者管理パスワードによるversion取り消し・削除申請MVP

未実装:

- ZIP内部のBMS解析
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除本体
- Turnstile
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

### 一覧サムネイル

一覧サムネイルは、表示中の一覧で比較しやすいように `progressMap` からブラウザ側で再描画する。

表示優先順位:

1. `version.progressMap` が有効な場合は、`progressMap.blocks` と `progressMap.layers` から一覧専用サムネイルを生成する。
2. `progressMap` がない、または不正な場合に限り、`version.progressImage.url` があれば保存済みR2 PNGを `img` fallbackとして表示する。
3. R2 PNGの読み込みに失敗した場合も、同じversionの `progressMap` が使えるなら再描画サムネイルへfallbackする。
4. `progressImage.url` も `progressMap` もない場合は、サムネイルなしの控えめな空表示にする。

一覧専用サムネイルでは以下の意味に固定する。

- 棒の高さ = ノーツ密度。
- 棒の色 = そのblockを最後に塗ったlayer/投稿者。
- 未着手 = 薄い緑または薄いミント。
- 初回投稿layer = 緑系。
- 追記layer 1 = 青系。
- 追記layer 2 = 紫系。
- 追記layer 3 = 橙系。
- 追記layer 4 = 赤系。
- 以降の追記layerはパレットを循環する。

密度は色の濃淡ではなく棒の高さで表す。低密度区間や0ノーツ区間も存在が分かるよう、未着手0ノーツblockは2〜3px程度の薄色バー、塗り済み0ノーツblockは4px程度の色付きバーとして描画する。未着手色は `#CFE3DC`、未着手レールは `#D8E8E2` を基準にし、背景へ溶けない範囲で塗り済み色より弱く見せる。

上段密度バーと下段貢献者レールは同じplot領域を使う。DOM一覧では同じgrid列数、gap、paddingを共有し、Canvas PNGでは `plotX`, `plotWidth`, `blockWidth`, `gap`, `xForBlock(index)` を共通計算して、先頭・中央・末尾blockのX座標が上下で一致するようにする。8ブロック区切り線も同じ `xForBlock` 系の座標を使う。

新規生成PNGは一覧サムネイルと同じ未着手色、最低高さ、上段/下段の位置合わせルールに寄せる。既存R2 PNGは自動再生成しない。

サムネイル下の補助表示は進捗率を繰り返さず、`32/81 blocks · 3 users` のように作成済みblock数と参加者数を表示する。進捗率は一覧の進捗列チップで表示する。

hover tooltipでは以下を確認できるようにする。

- 進捗率
- 作成済みblock数 / 総block数
- 参加者数
- 色と投稿者/追記者の対応
- 未着手block数

色と投稿者の対応は、同じchart内の `versions` から `progressMap.layers[].versionId` と `version.id` を照合し、`version.author` を使う。authorが引けない場合は `初回`, `追記1`, `追記2`, `layer n` などにfallbackする。

密度スケールは、現在読み込んでいる一覧内の全 `progressMap.blocks` から正の密度値を集め、95パーセンタイル相当を共通 `densityScale` として使う。高さ計算は `sqrt(density / densityScale)` を基本とし、極端な高密度譜面だけ頭打ちにする。`blockDurationSec` が取れない場合は `playNotes` のみを密度値として扱う。将来はサイト全体または難易度帯別の固定スケールを検討する。

MVPではサムネイルクリックによる拡大表示は実装しない。将来、`progressImage.url` またはCanvas再描画結果をモーダルで拡大表示し、layer凡例や詳細ブロック情報を確認できる導線を検討する。

`progressImage.url` は `/api/progress-images/:versionId` のような相対URLで返るため、R2 PNG fallback時はGitHub Pages側で `API_BASE_URL` と結合して表示する。MVPではcache bustingは行わない。将来、同じversionIdの画像を再生成する場合はquery付与などを検討する。

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
- `progressMap` がある場合は、一覧内共通densityScaleを使った密度・担当layer色つき進捗サムネイル
- `progressMap` がない、または再描画できない場合は `progressImage.url` の保存済みR2 PNG fallback
- コメントの短い表示
- DLボタンまたはDL不可ボタン
- 追記投稿ボタン

### お気に入り★

投稿一覧の各version行では、版ラベル右側にお気に入り用の★buttonを表示する。

仕様:

- お気に入りの単位は `versionId` とする。
- お気に入り状態はサーバーには保存せず、ブラウザごとの `localStorage` に保存する。
- localStorage keyは `bms-wip-charts:favorites:v1` とする。
- 保存形式はversionIdをkeyにしたmap形式とし、判定はversionIdの存在で行う。
- `chartId`, `songTitle`, `chartName`, `versionLabel`, `branchPath`, `favoritedAt` は表示補助用snapshotとして保存してよい。
- localStorageが壊れている、またはJSON parseに失敗した場合は空扱いにし、一覧全体を壊さない。
- APIレスポンスに存在しないfavoriteはMVPでは表示上無視し、自動削除しない。
- `completed`, `downloadBlocked`, `collapsedByCompletion`, `isRejected` のversionもお気に入り可とする。
- `isHidden=true` のversionは一覧に表示されないため、お気に入りUIも表示しない。

お気に入りのみトグル:

- 投稿一覧上部に `★ お気に入りのみ` トグルを表示する。
- OFF時は通常一覧を表示する。
- ON時は、お気に入りversionとその祖先versionだけを表示する。
- お気に入りversionを含むchartだけを表示し、祖先を残すことでツリー文脈を維持する。
- 中間履歴内のversionがお気に入りの場合、フィルタON時はそのversionが見えるようにし、通常表示時の中間履歴折り畳み挙動は維持する。
- 将来検索を追加する場合は、検索キーワード一致 AND お気に入り関連行の条件で絞り込むことを検討する。
- 将来アカウント機能ができた場合は、サーバー保存や端末間同期を検討する。

## 投稿者による取り消し・削除

投稿一覧の各version行から、投稿時の管理パスワードを使って操作する。UIでは「取り消し」と表示し、既存APIルートと内部ログactionは `withdraw` / `withdraw_version` を維持する。

24時間ルール:

- 判定基準は `versions.created_at` とし、WorkerがD1上で `created_at >= datetime('now', '-24 hours')` を評価する。
- `visibleChildVersionCount`は`parent_version_id`が一致し、`COALESCE(is_hidden, 0)=0`の直接子数とする。即時非表示可否はこの値で判定する。
- `totalChildVersionCount`は`parent_version_id`が一致する全直接子数とし、非表示versionも含めて監査・参考表示に使う。
- 削除申請中、取り消し済み、DL不可、没譜面、中間履歴でも公開中なら`visibleChildVersionCount`へ含める。24時間以内即時非表示済み、管理承認済みなど`is_hidden=1`の子は除外する。
- 一覧の24時間表示は参考情報であり、最終結果はAPI実行時の再判定と `outcome` を正とする。

取り消し:

- 24時間以内かつ公開中の直接子なし: `outcome='immediate_hidden'`。`is_hidden=1`, `hidden_reason='canceled_within_24h'`, `hidden_at`, `withdrawn_at`, `download_blocked=1`を設定する。
- 24時間以内で公開中の直接子あり: `outcome='download_blocked'`。一覧には残し、DLを停止する。
- 24時間経過後: `outcome='download_blocked'`。一覧には残し、DLを停止する。
- 既存の `download_block_reason` は上書きせず、未設定の場合だけ `withdrawn` を使う。

削除:

- 24時間以内かつ公開中の直接子なし: `outcome='immediate_hidden'`。`is_hidden=1`, `hidden_reason='deleted_within_24h'`, `hidden_at`, `download_blocked=1`を設定し、pending削除申請は作らない。
- 24時間以内で公開中の直接子あり、または24時間経過後: `outcome='delete_requested'`。`delete_requests`へpendingを追加し、`delete_requested_at`と`download_blocked=1`を設定する。
- API入力の `reason` は `delete_requests.message` に保存し、申請日時は `delete_requests.created_at` とする。
- 同一versionにpending申請がある場合は重複受付しない。

論理削除と操作可否:

- `immediate_hidden`は物理削除ではない。D1 versions行、R2譜面ファイル、progressImage PNGを保持し、`file_deleted_at`は設定しない。
- `download_blocked`はDL制御であり、追記不可条件ではない。
- `withdrawn_at`または`delete_requested_at`があっても追記できる。
- `is_hidden=1`または`is_rejected=1`は追記不可とする。完成版に置換済み中間履歴など既存の明示的な追記不可条件も維持する。
- 即時非表示UPDATEは24時間条件と公開中の直接子不存在条件を再確認し、競合を検出した場合はDL停止または削除申請へ寄せる。

共通仕様:

- request bodyは `application/json` とし、`password` を必須にする。
- passwordは `hashWithSecret('password:' + password, HASH_SECRET)` で検証する。
- password、password_hash、HASH_SECRET、生IP、生UA、削除理由本文はログに出さない。
- 同じIP/UAハッシュで10分以内に5回以上 `INVALID_PASSWORD` が記録された場合は `RATE_LIMITED` とする。
- 成功・失敗は `post_logs` の既存action `withdraw_version` / `request_delete` に記録し、detailには `outcome`, `within24Hours`, `hasDescendants`, `visibleChildVersionCount`, `totalChildVersionCount`, ID、理由有無と文字数を残す。
- 通知、物理削除、復旧、処理済み申請の履歴検索は後続フェーズとする。

## 削除申請の管理

管理UIは公開一覧へ埋め込まず、`docs/admin.html` の専用URLとして提供する。公開一覧には管理ページへのリンクを置かず、URLを隠すこと自体は認証手段としない。

認証:

- 全管理APIで `Authorization: Bearer <ADMIN_TOKEN>` を必須にする。
- `ADMIN_TOKEN` はCloudflare secretで管理し、URL、HTML属性、console、D1ログへ出さない。
- 管理ページではトークンをページのメモリ内だけに保持し、`localStorage`へ保存しない。
- `ADMIN_TOKEN`未設定は`CONFIG_MISSING`、不一致は`ADMIN_AUTH_REQUIRED`とする。

pending一覧:

- `GET /api/admin/delete-requests?status=pending&page=1&pageSize=50` で古い申請から表示する。
- `delete_requests`, `versions`, `charts`, `songs`を結合し、申請理由、申請日時、曲・差分・版、作者、進捗、現在状態、公開中の直接子数、履歴上の全直接子数を返す。
- `password_hash`, R2 key, requester hash、secretは返さない。
- 24時間以内かつ公開中の直接子なしで即時非表示になったversionはpending申請を作らないため、この一覧には出ない。

承認:

- `POST /api/admin/delete-requests/:requestId/approve`を使い、`adminNote`は任意、1000文字以内とする。
- `status='pending'`かつ`visibleChildVersionCount=0`のversionだけ承認できる。公開中の直接子がある場合は`DELETE_REQUEST_HAS_DESCENDANTS`を返し、申請とversionを変更しない。
- `totalChildVersionCount>0`でも全直接子が`is_hidden=1`なら承認できる。
- 承認時は`delete_requests.status='approved'`, `handled_at`, `handled_by='admin'`, `admin_note`を設定する。
- versionは`is_hidden=1`, `hidden_at`, `hidden_reason='delete_request_approved'`, `download_blocked=1`, `updated_at`を設定する。
- 既に非表示のversionでは既存の`hidden_reason`を上書きせず、pending申請だけをapprovedにできる。
- 承認は論理非表示であり、R2譜面ファイル、progressImage、D1 version行を物理削除せず、`file_deleted_at`も設定しない。

却下:

- `POST /api/admin/delete-requests/:requestId/reject`を使い、`adminNote`を必須、1000文字以内とする。
- `delete_requests.status='rejected'`, `handled_at`, `handled_by='admin'`, `admin_note`を設定する。
- 同じversionに別のpending申請がなければ`delete_requested_at`を解除する。
- `download_block_reason='delete_requested'`の場合だけDL制限を解除する。`withdrawn`, `superseded_by_completed_descendant`, `admin_blocked`, `admin_hidden`など別理由の制限は保持する。
- 却下時に`is_hidden`, `hidden_reason`, `withdrawn_at`を復旧しない。

監査:

- 管理者の承認・却下・競合・失敗は`post_logs`ではなく`admin_logs`へ記録する。
- actionは`approve_delete_request`または`reject_delete_request`とする。
- detailにはrequest/version/chart ID、公開中・全直接子数、前後状態、outcome/errorCode、管理メモ文字数を記録する。
- ADMIN_TOKEN、password、HASH_SECRET、生IP、生UA、申請理由本文は`admin_logs`へ記録しない。
- R2物理削除、親versionの構造保持削除、復旧、複数管理者識別は後続フェーズとする。

## 管理者によるR2 cleanup

R2-CLEANUP-01では、削除意思が確定した論理削除versionの譜面ファイルだけを、管理画面から1件ずつ整理する。D1 version行、`progressMap`、`progressImage` PNGは保持する。

cleanup対象は次の全条件を満たすversionに限定する。

- `is_hidden=1`
- `download_blocked=1`
- `file_deleted_at IS NULL`
- `hidden_at IS NOT NULL`
- `hidden_at`から30日以上経過
- `hidden_reason IN ('delete_request_approved', 'deleted_within_24h')`

`is_hidden=1`だけではcleanup対象にしない。公開中のDL不可version、pending削除申請、`canceled_within_24h`、`admin_hidden`、`hidden_at IS NULL`は対象外とする。保持期間はブラウザではなくWorker/D1で再判定し、`created_at`や`download_blocked_at`へfallbackしない。

削除対象は`versions.r2_key`が指す譜面R2 objectのみとする。`versions.progress_image_key`が指すPNGは削除しない。R2 objectを削除した、またはobject不在を確認した後に次を更新する。

- `file_deleted_at=CURRENT_TIMESTAMP`
- 通常削除は`file_delete_reason='r2_cleanup_deleted'`
- object不在またはR2 key欠落のD1修復は`file_delete_reason='r2_object_missing_during_cleanup'`
- `updated_at=CURRENT_TIMESTAMP`

R2削除失敗時は`file_deleted_at`を設定しない。R2削除後にD1更新が失敗した場合、次回実行でobject不在を検出してD1を修復する。`file_deleted_at IS NOT NULL`なのにobjectが存在する逆方向の不整合は、このMVPでは自動削除しない。

cleanupは`ADMIN_TOKEN`認証後の管理画面で手動実行し、確認文字列`DELETE_R2_FILE`を要求する。実行結果は`admin_logs`へ記録するが、ADMIN_TOKEN、secret、生IP、生UA、raw R2 keyは記録しない。一括削除、Cron、自動削除、progressImage削除は後続フェーズとする。

## 自動削除準備

将来、Cloudflare Workers Cron Triggerで1日1回程度、DL不可から30日経過したversionのR2譜面ファイルを整理する。

MVPの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。

自動削除時はD1行を物理削除せず、`is_hidden=1` と `hidden_reason='auto_deleted_after_download_block'` にし、`file_deleted_at` と `file_delete_reason` を保存する。進捗画像は履歴確認用として残す。

## BAN-01 投稿制限

BANは、ログインなし投稿サイトで管理者が有害な初回投稿・追記投稿を明示的に制限するために使う。閲覧、DL、取り消し、削除申請、管理操作、管理承認・却下、R2 cleanupはBAN対象外とし、投稿者が自分の投稿を整理する経路は塞がない。

MVPで管理画面から作成できる対象は次の2種類とする。

- `ip_hash`: 投稿リクエスト元のIP markerを`HASH_SECRET`でハッシュ化した値。共有回線を巻き込む可能性があるため、管理画面に注意を表示する。
- `file_sha256`: 同一内容の譜面ファイルの再投稿を止める補助対象。

`ua_hash`は既存BANデータとの照合互換だけを維持し、管理画面から作成しない。IP+UA組み合わせBANは現schemaで安全に表現できないため未対応とし、IP行とUA行をAND条件の代用として作成してはならない。

IP markerは本番では`CF-Connecting-IP`を優先し、ローカル互換時だけ`X-Forwarded-For`先頭値を使う。markerが取得できない場合は`unknown`をハッシュ化して投稿ログへ残すが、そのログからIP BANは作成できない。ハッシュ規則は既存`post_logs`と共通化し、`hashWithSecret("ip:" + marker, HASH_SECRET)`および`hashWithSecret("ua:" + marker, HASH_SECRET)`を使う。`HASH_SECRET`未設定時やBAN照合DB障害時は投稿を安全側で拒否する。`HASH_SECRET`を変更すると既存`post_logs`と`bans`の照合が継続できなくなるため、運用中は固定する。

初回・追記投稿では、multipart解析より前に`ip_hash`を照合する。既存データ互換としてactiveな`ua_hash`も照合する。ファイルBANはmultipart解析とSHA-256計算後、R2保存およびD1 version作成より前に照合する。active判定は`active=1 AND disabled_at IS NULL AND (expired_at IS NULL OR expired_at > CURRENT_TIMESTAMP)`とする。BAN拒否はHTTP 403 `POSTING_BLOCKED`とし、ban id/type/valueや期限など回避に使える情報を公開レスポンスへ出さない。

BAN期間は24時間、7日、30日、無期限を扱う。解除は物理削除ではなく`active=0`, `disabled_at=CURRENT_TIMESTAMP`, `updated_at=CURRENT_TIMESTAMP`で記録する。既存の同一`ban_type`/`ban_value`を再度BANした場合は、同じ行を再有効化して理由・期限を更新する。

管理画面には最近の`post_logs`とBAN一覧を独立セクションとして表示する。full hash、生IP、生UAは返さず、短縮ハッシュだけを表示する。BAN作成時は管理UIからhash値を送らず、`sourcePostLogId`を受けたWorkerがD1内のfull hashを解決する。BAN作成・解除は`admin_logs`へ`create_ban` / `lift_ban`として記録するが、full hash、生IP、生UA、`ADMIN_TOKEN`、`HASH_SECRET`はdetailへ入れない。

Rate Limitはパスワード失敗などに対する短時間制限、BANは管理者判断による明示制限として区別する。両方が適用される投稿APIではBANを先に判定し、エラーコードも`POSTING_BLOCKED`と`RATE_LIMITED`に分ける。

## API仕様

既存API:

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts`
- `POST /api/charts/:chartId/versions`
- `GET /api/files/:fileId`
- `GET /api/progress-images/:versionId`
- `GET /api/admin/delete-requests`
- `POST /api/admin/delete-requests/:requestId/approve`
- `POST /api/admin/delete-requests/:requestId/reject`
- `GET /api/admin/r2-cleanup-candidates`
- `POST /api/admin/r2-cleanup/:versionId/delete-file`
- `GET /api/admin/post-logs`
- `POST /api/admin/bans`
- `GET /api/admin/bans`
- `POST /api/admin/bans/:banId/lift`
- `POST /api/admin/hide-version`

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
