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
- `versions.file_deleted_at` / `versions.file_delete_reason` の自動削除準備カラム
- PROG-01 進捗グラフ用DBカラムとJSON/API仕様

未実装:

- Worker側BMS解析の本実装
- フロント側進捗グラフUI
- Canvas/SVG描画
- R2への進捗画像保存処理
- 初回投稿APIの `progress_map_json` 対応
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

## 画面仕様

### 全体構成

- 1ページサイトとする。
- ページ上部に初回投稿フォームを表示する。
- ページ下部に投稿一覧を表示する。
- ログインは不要とする。
- 管理人承認は行わず、投稿後すぐ公開する。

### 初回投稿フォーム

フォームは入力誘導、補足文、必須表示を表示しつつ、情報の意味単位が分かる構造にする。

FORM-03以降、初回投稿フォームは以下のセクションに分ける。

1. 譜面ファイル
2. 楽曲情報
3. 差分情報
4. 進捗・管理
5. コメント

差分情報セクションには、差分に関する入力をまとめる。導線は以下の順にする。

1. 想定難易度
2. 仮差分名
3. 差分作者（別名義可）

進捗・管理セクションには、進捗度、没譜面、管理パスワード、管理パスワード保存チェックをまとめる。将来の進捗グラフUI追加を見据えて過度に作り込まない。

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

PC表示では数字チップを1行10個で表示する。

- 1行目: 1〜10
- 2行目: 11〜20
- 3行目: 21〜25

シンボル変更時、現在選択中の数字が新しいシンボルの上限を超える場合は最大値に丸める。

手入力モードでは、数字チップではなく自由入力欄を表示するが、難易度入力ブロック全体の高さは通常シンボル時と変えない。数字部分が3桁以上になる入力は受け付けない。手入力時はシンボル別の上限チェックは行わない。

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

PROG-01以降、没譜面の進捗グラフは全塗り扱いとする。`progress_map_json` には `kind: "rejected_auto_fill"` のlayerを使う。

## 進捗グラフ仕様

PROG-01ではDB拡張とJSON/API仕様のみ定義する。Worker側BMS解析、フロント側進捗グラフUI、Canvas/SVG描画、R2への進捗画像保存処理はまだ実装しない。

### 目的

進捗度を手入力だけで管理するのではなく、BMS小節単位の塗りUIから算出できるようにする。

将来のUIでは以下を行う。

- BMSファイルを解析し、小節ごとのプレイノート数を算出する。
- 小節ごとのプレイノート数を折れ線グラフで表示する。
- 折れ線グラフと小節ブロックを重ねて表示する。
- グラフ上に小節ごとの透明ブロックを重ねる。
- ブロックをクリック/ドラッグすると、その小節が作成済み色に変わる。
- 追記時は親versionの塗り情報を引き継ぎ、今回追記分は別色で重ね塗りする。
- 重ね塗りは可能とする。
- 進捗度は、色が付いた対象小節数のunion / 対象小節数で算出する。

### 対象小節

- プレイノートが最初に出現した小節から開始する。
- 最後にノートがある小節までを対象にする。
- その間にある非プレイノート小節も対象小節に含める。
- 前後の完全な空白小節は進捗対象にしない。
- `first_note_measure` を対象範囲の開始小節として保存する。
- `last_note_measure` を対象範囲の終了小節として保存する。
- `target_measure_count` を対象小節数として保存する。

### 8小節線

進捗グラフUIでは、最初にプレイノートが出る小節から8小節ごとに黒線を表示する。

- 起点は `first_note_measure` とする。
- ユーザー向けの説明文は不要とする。

### play_notes算出方針

- BGM/BPM/STOP/メタ情報はプレイノート数に含めない。
- プレイ用チャンネルの `00` 以外をノートとして数える。
- LNはMVPでは開始のみ1ノートとして数える。
- `lnPolicy` は `count_start_only` として保存する。
- `play_notes` はプレイノート総数として `versions.play_notes` に保存する。

### measure_notes_json

小節ごとのプレイノート数を保存するJSON文字列。

仕様:

- `schemaVersion`: JSON仕様バージョン。MVPは `1`。
- `firstMeasure`: 最初にプレイノートが出現した対象小節。
- `lastMeasure`: 最後にプレイノートがある対象小節。
- `targetMeasureCount`: `firstMeasure` から `lastMeasure` までの小節数。
- `playNotes`: プレイノート総数。
- `lnPolicy`: MVPでは `count_start_only`。
- `measures`: 対象範囲内の各小節ごとのノート数。途中の非プレイノート小節も `playNotes: 0` として含める。

例:

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

小節単位の進捗塗り情報を保存するJSON文字列。

仕様:

- `schemaVersion`: JSON仕様バージョン。MVPは `1`。
- `firstMeasure`: 対象範囲の開始小節。
- `lastMeasure`: 対象範囲の終了小節。
- `targetMeasureCount`: 対象小節数。
- `layers`: versionごとの塗りlayer配列。
- layerの `ranges` は連続小節範囲を `[start, end]` で保存する。
- 追記時は親versionのlayersを引き継ぎ、今回分を新しいlayerとして追加する。
- 重ね塗りは可能。
- progress計算では、複数layerで塗られた同じ小節も1小節として数える。
- `progress` は全layerのunionから算出した進捗度のsnapshot。

layerの `kind` 候補:

- `normal`: 初回投稿または通常塗り。
- `followup`: 追記投稿で追加された塗り。
- `rejected_auto_fill`: 没譜面による全塗り。
- `completion_fill`: 完成ボタンによる未塗り小節の全塗り。

例:

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

### 完成ボタン仕様

将来の進捗グラフUIでは、`progress >= 80` で「完成版にする」ボタンを有効化する。

押した場合:

- 未塗り小節を現在versionの色で全部塗る。
- `progress=100` にする。
- `completed_at` を保存する。
- `progress_map_json` に `kind: "completion_fill"` のlayerを追加する。

### 進捗画像仕様

進捗グラフ画像は、譜面ファイル本体とは別にR2へ保存する。

- 保存キー例: `charts/{chartId}/versions/{versionId}/progress/progress.png`
- 画像形式はPNG推奨。
- `progress_image_key`: R2 key。
- `progress_image_mime`: `image/png`。
- `progress_image_size`: 画像ファイルサイズ。
- `progress_image_sha256`: 画像SHA256。
- `progress_image_created_at`: 画像作成日時。

譜面ファイル本体が `file_deleted_at` により削除済みになっても、進捗画像は残す。進捗画像は一覧、折り畳み展開表示、履歴確認で使う。

### progress=100到達後の折り畳み表示

`is_hidden` と `collapsed_by_completion` は分ける。

- `is_hidden`: 管理、削除、BANなどで通常表示から消す状態。
- `collapsed_by_completion`: 通常一覧で省略するだけの状態。展開すれば確認できる。

`collapsed_by_completion=1` のversionは、展開ボタン経由で進捗画像、差分作者、コメント、進捗度などを確認できる。ただしDLは不可のままとする。

関連カラム:

- `collapsed_by_completion`
- `collapsed_reason`
- `collapsed_at`
- `collapsed_by_version_id`

`collapsed_reason` 候補:

- `superseded_by_completed_descendant`

### DL制御との関係

`progress=100` の完成version自体はDL可能とする。

同じ分岐上で `progress=100` に到達した場合、その完成versionに至るまでの親譜面のうち `progress=1〜99` のversionはDL不可にする。

DL不可から30日経過した譜面ファイルは、将来R2から自動削除する。ただし削除対象は譜面ファイル本体のみで、進捗画像は残す。

### お気に入り仕様

お気に入りはサーバーDBに保存しない。

- version.id 単位でブラウザのlocalStorageに保存する。
- 各version行に星マークを表示する。
- クリックすると黄色にする。
- お気に入りのみ表示するフィルタを将来追加する。
- MVPでは読み込み済み一覧に対するクライアント側フィルタでよい。

## 分岐version管理

単線version管理ではなく、分岐ツリー型version管理にする。

同じbase versionから複数人が追記した場合は、両方を受け入れる。遅れた投稿者を `VERSION_CONFLICT` で拒否しない。

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
- 取り下げボタン
- 削除申請ボタン

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

PROG-01で `versions` に追加するカラム:

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

追加index:

- `idx_versions_measure_range`
- `idx_versions_progress_image_key`
- `idx_versions_collapsed_completion`
- `idx_versions_collapsed_by_version`

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

PROG-01ではWorker本体のAPI実装は変更しない。ただし将来 `GET /api/charts` のversionレスポンスで以下を返せるようにAPI仕様を拡張する。

- `playNotes`
- `firstNoteMeasure`
- `lastNoteMeasure`
- `targetMeasureCount`
- `measureNotes`
- `progressMap`
- `progressImage`
- `collapsedByCompletion`
- `collapsedReason`
- `collapsedAt`
- `collapsedByVersionId`

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
| `TITLE_ARTIST_MISMATCH` | 追記先と譜面情報が一致しません。 |
| `INVALID_PROGRESS` | 進捗度の値が不正です。 |
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
