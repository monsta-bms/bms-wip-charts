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

未実装:

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

フォームは2カラムの見やすさを維持しつつ、入力誘導、補足文、必須表示を表示する。

ユーザーが入力・選択する項目:

- 譜面ファイル
- 曲名
- サブタイトル
- アーティスト
- サブアーティスト
- 仮差分名
- 想定難易度
- 差分作者（別名義可）
- 進捗度 0〜100
- コメント
- 没譜面チェック
- 管理パスワード
- 管理パスワード保存チェック

通常フォームでは `level` の見える入力欄を表示しない。ユーザーが入力・閲覧する難易度は「想定難易度」に統一する。

フォーム上の必須項目には赤い `*` を表示し、フォーム内に `*項目は入力必須。` と表示する。初期表示時には未入力エラーを大量に表示せず、送信ボタン押下後に未入力項目が分かるようにする。

現行APIとの互換のため、初回投稿では以下を未入力チェック対象にする。

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

想定難易度欄は、テキスト入力ではなく「シンボルタブ + 数字チップ式UI」とする。フォーム全体の現行2カラム配置は維持し、仮差分名・差分作者・進捗度などの配置を大きく移動しない。

想定難易度UI:

- ラベル: `想定難易度 *`
- シンボルタブ: `★`, `★★`, `sl`, `st`, `手入力`
- 数字チップグリッド
- 手入力欄
- 選択中プレビュー

DIF-01以降、難易度入力ブロックはシンボル切替時に高さが変わらない固定サイズのUIとする。

通常シンボルでは数字を常に1〜25まで表示する。シンボルごとの上限を超える数字はdisabledにしてクリック不可にする。

| シンボル | 選択可能 | disabled |
| --- | --- | --- |
| `★` | 1〜25 | なし |
| `★★` | 1〜7 | 8〜25 |
| `sl` | 1〜12 | 13〜25 |
| `st` | 1〜15 | 16〜25 |

PC表示では数字チップを1行10個で表示する。

- 1行目: 1〜10
- 2行目: 11〜20
- 3行目: 21〜25

ユーザー向けに上限説明文は表示しない。上限はdisabled状態で表現する。

シンボル変更時、現在選択中の数字が新しいシンボルの上限を超える場合は最大値に丸める。

例:

- `★25` を選択中に `★★` へ変更した場合は `★★7` に補正する。
- `★25` を選択中に `sl` へ変更した場合は `sl12` に補正する。
- `★25` を選択中に `st` へ変更した場合は `st15` に補正する。

手入力モードでは、数字チップではなく自由入力欄を表示するが、難易度入力ブロック全体の高さは通常シンボル時と変えない。シンボル込み入力を許可し、入力中の値をプレビューに反映する。数字部分が3桁以上になる入力は受け付けない。手入力時はシンボル別の上限チェックは行わない。

手入力placeholder:

- `例: ★12 / sl10 / 自由入力`

音源ファイルはアップロード禁止とする。音源が必要な場合は、コメント欄にURLを貼る方式とする。フォームにも音源URLはコメント欄へ記入する旨を表示する。

管理パスワードは、取り下げ・削除申請に使う。公開しない。忘れると投稿者側で操作できない。DBには生パスワードを保存せず、server secretやsaltを使った `password_hash` のみ保存する。

管理パスワード保存チェックは残す。保存する場合は、この端末のブラウザに保存するため共有PCでは使わない旨を表示する。

### 没譜面チェック

没譜面チェック `isRejected` は初回投稿 `POST /api/charts` でのみ有効とする。

フォームでは `没譜面` の横または下に `追記されることがなくなります。進捗度は100固定です。` という意味の補足を表示する。

没譜面チェックON時:

- 進捗度を `100` にする。
- 進捗度欄をreadonlyまたはdisabledにする。
- 見た目でも100固定であることが分かるようにする。

没譜面チェックOFF時:

- 進捗度欄を通常入力可能に戻す。

API側でも `isRejected=true` の場合は `progress=100` に強制する。ブラウザ側の制御は補助扱いとする。

`isRejected=true` のversionは以下の扱いにする。

- `completed_at` を保存する。
- completed扱いにする。
- 難易度表掲載対象にする。
- 難易度表と一覧では没譜面バッジで通常の完成譜面と区別する。
- このversionからの追記は禁止する。

追記投稿 `POST /api/charts/:chartId/versions` では `isRejected` を指定できない。将来の追記APIで `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。

将来の追記APIで親versionの `is_rejected=1` を検出した場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。

### 投稿一覧

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

例:

- `difficulty="★12"`, `level="12"` の場合、一覧表示は `★12`。
- `difficulty="★★7"`, `level="7"` の場合、一覧表示は `★★7`。
- `difficulty="st5"`, `level="5"` の場合、一覧表示は `st5`。

## 管理単位

管理単位は以下の3層に分ける。

- `songs`: 元曲単位
- `charts`: 差分単位
- `versions`: 分岐・履歴単位

同じ曲でも `[ANOTHER]` と `[ALITHER]` は別chartとして扱う。各chartは独立して `ver1.0` を持てる。

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

音源ファイルのアップロードは禁止する。`.zip` が投稿された場合は、将来zip内の禁止拡張子検査を行う。

禁止対象例:

- `.wav`
- `.ogg`
- `.mp3`
- `.flac`
- `.aac`
- `.m4a`
- `.aiff`
- `.aif`

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

GitHub Pagesの初回投稿フォームでは、選択UIから `difficulty` と `level` を生成して `POST /api/charts` へ送信する。

生成例:

| UI入力 | difficulty | level |
| --- | --- | --- |
| `★` + `12` | `★12` | `12` |
| `★★` + `7` | `★★7` | `7` |
| `sl` + `8` | `sl8` | `8` |
| `st` + `15` | `st15` | `15` |
| 手入力 `★12` | `★12` | `12` |
| 手入力 `★★7` | `★★7` | `7` |
| 手入力 `sl10` | `sl10` | `10` |
| 手入力 `st15` | `st15` | `15` |
| 手入力 `12` | `12` | `12` |
| 手入力 `overjoy` | `overjoy` | 空または `null` |

`POST /api/charts` では、`level` が未入力の場合、`difficulty` から可能な範囲で自動抽出する。

抽出できない場合は `level` を空または `null` にしてよい。

将来 `estimated_difficulty` と `table_level` を分ける可能性は残す。

## 分岐version管理

単線version管理ではなく、分岐ツリー型version管理にする。

同じbase versionから複数人が追記した場合は、両方を受け入れる。遅れた投稿者を `VERSION_CONFLICT` で拒否しない。

`versions` は以下を持つ。

- `parent_version_id`: 親version。rootだけNULL、それ以外は必須。
- `version_number`: 整数。表示時に `verX.0` 形式へ変換する。
- `branch_label`: 同じ親からの分岐識別子。
- `branch_path`: ツリー表示、ページング、祖先DL制御、並び順に使う内部パス。

`display_version` はDBには保存せず、APIレスポンス時に生成する。

表示例:

- root: `ver1.0`
- root/a: `ver2.0-a`
- root/b: `ver2.0-b`
- root/a/1: `ver3.0-a1`

## progress=100 / 難易度表

`progress=100` に到達したversionは完成扱いにする。

完成versionは別ページの難易度表に自動掲載する。

難易度表用に以下の情報を取得・保存・返却できるようにする。

- `title`
- `subtitle`
- `artist`
- `subartist`
- `difficulty`
- `level`
- `md5`
- `dl_link`

`progress=100` 到達時は `completed_at` を保存する。

`progress=100` かつ `is_rejected=1` の没譜面も難易度表に通常掲載し、難易度表上では没譜面バッジで区別する。

難易度表の掲載日時や並び順には `completed_at` を使う。

## DL制御

`progress=100` のversion自体はDL可能とする。

`progress=100` のversionに追記された場合でも、追記元の `progress=100` versionはDL可能のままにする。

追記後のversionも `progress=100` なら、そのversionもDL可能にする。

ただし、同じ分岐上で `progress=100` に到達した場合、その完成versionに至るまでの親譜面のうち `progress=1〜99` のversionはDL不可にする。

DL不可は以下で管理する。

- `download_blocked`
- `download_block_reason`
- `download_blocked_at`

`download_block_reason` の候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `delete_requested`
- `admin_blocked`
- `admin_hidden`

## DL不可譜面の将来自動削除

将来、`download_blocked=1` になってから30日経過したversionのR2ファイルを、Cloudflare Workers Cron Triggerで1日1回程度自動整理する。

自動削除時の方針:

- R2ファイルは削除する。
- D1の `versions` 行は物理削除しない。
- 分岐ツリーを壊さないため、version行の物理削除は禁止する。
- D1上では `is_hidden=1` にして通常一覧から非表示にする。
- `hidden_reason='auto_deleted_after_download_block'` を保存する。
- `file_deleted_at` にR2ファイル削除日時を保存する。
- `file_delete_reason='auto_deleted_after_download_block'` を保存する。
- R2削除成功後にD1を更新する。
- R2削除失敗時はD1を非表示化せず、`admin_logs` に失敗ログを残す。
- 自動削除成功時も `admin_logs` に記録する。
- 一度に処理する件数には上限を設ける。

MVPでの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。削除申請は管理人確認が前提のため、将来含める場合は `delete_requests.status='approved'` などの承認済み条件を追加する。

## 取り下げ

各version行に「取り下げ」ボタンを表示する想定とする。

取り下げは管理パスワードで実行する。

取り下げ後の挙動:

- DLだけ不可にする。
- 追記は可能。
- version自体は削除しない。
- ツリー構造は維持する。

`progress=100` のversionは投稿者による取り下げ不可とする。`progress=100` では削除申請のみ可能とする。

取り下げ時は以下を更新する。

- `download_blocked=1`
- `download_block_reason='withdrawn'`
- `withdrawn_at`
- `download_blocked_at`
- `updated_at`

## 削除申請

削除は即時完全削除ではなく、管理人への削除申請とする。

削除申請には管理パスワード入力を必要とする。

削除申請時点で、対象versionのDLはひとまず不可にする。

削除申請時は以下を更新する。

- `download_blocked=1`
- `download_block_reason='delete_requested'`
- `delete_requested_at`
- `download_blocked_at`
- `updated_at`

削除申請内容は `delete_requests` に保存し、管理人が後から確認・承認・却下できるようにする。

`delete_requested` はMVPの自動削除対象には含めない。

## 追記時のタイトル・アーティスト一致

追記投稿時は、アップロードされたBMSのタイトルとアーティストが追記先chartのsong情報に一致しない場合に拒否する。

エラーコード:

- `TITLE_ARTIST_MISMATCH`

単純完全一致ではなく、正規化比較を前提にする。

比較時に考慮する正規化:

- 前後空白
- 連続スペース
- 全角半角
- 大文字小文字
- 差分名部分の除去または分離

## 一覧ページング

一覧はchart/差分単位で100件ごとにページ分割する。

ただし分岐が途中で切れる場合は、その分岐の終端まで同じページに延長する。

version単位でページを分断しない。

`branch_path` を使ってツリー表示とページングを実現しやすくする。

## 検索

検索機能を追加する前提で正規化カラムとindexを用意する。

検索結果は該当versionだけではなく、該当chart全体を返す想定とする。

検索対象:

- `songs.normalized_title`
- `songs.normalized_subtitle`
- `songs.normalized_artist`
- `songs.normalized_subartist`
- `charts.normalized_chart_name`
- `versions.author`
- `versions.authors_json`
- `versions.difficulty`
- `versions.level`
- `versions.md5`
- `versions.comment`

コメント全文検索はMVPではLIKEでよい。高度な検索やFTSは後回しとする。

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

追加設計API:

- `GET /api/table`
- `GET /api/table?level=...`
- `GET /api/table/search?q=...`
- `POST /api/versions/:versionId/withdraw`
- `POST /api/versions/:versionId/delete-request`
- `GET /api/admin/delete-requests`
- `POST /api/admin/delete-requests/:requestId/approve`
- `POST /api/admin/delete-requests/:requestId/reject`

難易度表APIは一覧APIとは分ける。難易度表は `progress=100` かつDL可能なversion中心に返し、`difficulty` と `level` を返せる設計にする。

今回の投稿フォームUI調整では、Worker API、D1 schema、R2処理は変更しない。

## DB仕様

schemaファイル:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `schema/d1.sql`

設計方針:

- `songs / charts / versions` の3層に分ける。
- 外部キー制約を使う。
- cascade削除は安易に使わない。
- chart/versionは `is_hidden` による論理非表示を基本にする。
- versionのDL不可は `download_blocked` と `download_block_reason` で管理する。
- R2ファイル削除状態は `file_deleted_at` と `file_delete_reason` で管理する。
- 全主要テーブルに `created_at` と必要に応じて `updated_at` を持たせる。
- 日付はクライアント入力ではなく、DBまたはWorker側で取得する。
- 基本はUTCの `CURRENT_TIMESTAMP` を使う。
- `updated_at` は更新処理時にWorker側で明示的に更新する。
- よく使う検索条件にはindexを貼る。

主なテーブル:

- `songs`: 元曲単位。
- `charts`: 差分単位。
- `versions`: 分岐・履歴単位。
- `delete_requests`: 削除申請。
- `post_logs`: 投稿試行ログ。
- `bans`: BAN情報。
- `admin_logs`: 管理者向け操作ログ・運用ログ。

`versions` の主なカラム:

- `id`
- `chart_id`
- `parent_version_id`
- `version_number`
- `branch_label`
- `branch_path`
- `author`
- `authors_json`
- `progress`
- `comment`
- `difficulty`
- `level`
- `title`
- `subtitle`
- `artist`
- `subartist`
- `md5`
- `is_rejected`
- `file_id`
- `file_name`
- `file_size`
- `file_sha256`
- `r2_key`
- `file_deleted_at`
- `file_delete_reason`
- `password_hash`
- `download_blocked`
- `download_block_reason`
- `is_hidden`
- `hidden_reason`
- `created_at`
- `updated_at`
- `completed_at`
- `withdrawn_at`
- `delete_requested_at`
- `hidden_at`
- `download_blocked_at`

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
