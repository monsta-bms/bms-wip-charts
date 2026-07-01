# BMS WIP Charts 仕様書

## 目的

BMS差分をログイン不要で共有できる1ページサイトを作る。

## 公開情報

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/wipbmschart/

## Phase 10-Fの範囲

Phase 10-Fでは、没譜面仕様と将来のR2ファイル自動削除に備えた最小修正を行う。

実装・更新するもの:

- 初回投稿API `POST /api/charts` で `isRejected=true` の場合に `progress=100` として保存する。
- `isRejected=true` の場合に `completed_at` を保存し、completed扱いにする。
- `versions.file_deleted_at` と `versions.file_delete_reason` を追加するmigrationを用意する。
- 仕様書、API仕様、テスト手順に没譜面と自動削除準備を明記する。

今回は以下を実装しない。

- Cron Trigger実装
- R2自動削除処理
- `POST /api/charts/:chartId/versions` の本実装
- 取り下げAPI
- 削除申請API
- 難易度表API
- UI変更

## 画面仕様

### 全体構成

- 1ページサイトとする。
- ページ上部に投稿フォームを表示する。
- ページ下部に投稿一覧を表示する。
- ログインは不要とする。
- 管理人承認は行わず、投稿後すぐ公開する。

### 投稿フォーム

投稿フォームでは以下を入力・選択できるようにする。

- 譜面ファイル
- 曲名
- サブタイトル
- アーティスト
- サブアーティスト
- 差分名
- 想定難易度 / level
- 差分作者
- 進捗度 0〜100
- コメント
- 没譜面チェック
- 管理パスワード

曲名、サブタイトル、アーティスト、サブアーティスト、level、md5はBMS/BME/BMLファイルから可能な範囲で自動読取する。ただし最終的には手修正可能とする。

音源ファイルはアップロード禁止とする。音源が必要な場合は、コメント欄にURLを貼る方式とする。

没譜面チェック `isRejected` は初回投稿フォームでのみ有効とする。追記投稿フォームでは没譜面チェックを非表示またはdisabledにする。

管理パスワードはブラウザ側のCookieまたはlocalStorageで保持可能とする。DBには生パスワードを保存せず、server secretやsaltを使った `password_hash` のみ保存する。

### 投稿一覧

投稿一覧では、song単位で曲名とアーティストを表示し、その下にchart単位の差分を表示する。

各chartは独立したversionツリーを持つ。

各version行には以下を表示する。

- 表示version名
- 想定難易度 / level
- 差分作者
- 進捗度
- 没譜面バッジ
- コメント
- DLリンク
- 追記投稿ボタン
- 取り下げボタン
- 削除申請ボタン

`progress=100` のversionは、一覧上で色やバッジにより完成扱いであることが分かるようにする。

`is_rejected=1` のversionは没譜面バッジで通常の完成譜面と区別する。

## 管理単位

管理単位は以下の3層に分ける。

- `songs`: 元曲単位
- `charts`: 差分単位
- `versions`: 分岐・履歴単位

同じ曲でも `[ANOTHER]` と `[ALITHER]` は別chartとして扱う。各chartは独立して `ver1.0` を持てる。

例:

```text
星の器 / Artist
  [ANOTHER]
    ver1.0
    ver2.0-a
    ver2.0-b

  [ALITHER]
    ver1.0
```

## 投稿仕様

### 投稿対象ファイル

アップロード可能なファイルは以下のみとする。

- `.bms`
- `.bme`
- `.bml`
- `.zip`

ファイルサイズ上限は以下とする。

- 単体譜面ファイル: 2MBまで
- zipファイル: 5MBまで

### 音源ファイルの扱い

音源ファイルのアップロードは禁止する。

`.zip` が投稿された場合は、zip内のファイルを検査し、音源ファイルなどの禁止拡張子が含まれていれば拒否する。

禁止対象の例:

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

`level` は当面、投稿フォームの想定難易度またはそれに相当する値を使う。後で `estimated_difficulty` と `table_level` を分ける可能性を残す。

### 没譜面チェック

没譜面チェック `isRejected` は初回投稿 `POST /api/charts` でのみ有効とする。

初回投稿で `isRejected=true` の場合、ユーザーが入力した `progress` に関係なく、保存値は `progress=100` に強制する。

`isRejected=true` のversionは以下の扱いにする。

- `completed_at` を保存する。
- completed扱いにする。
- 難易度表掲載対象にする。
- 難易度表と一覧では没譜面バッジで通常の完成譜面と区別する。
- このversionからの追記は禁止する。

追記投稿 `POST /api/charts/:chartId/versions` では `isRejected` を指定できない。将来の追記APIで `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。

将来の追記APIで親versionの `is_rejected=1` を検出した場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。

## 分岐version管理

単線version管理ではなく、分岐ツリー型version管理にする。

同じbase versionから複数人が追記した場合は、両方を受け入れる。遅れた投稿者を `VERSION_CONFLICT` で拒否しない。

分岐名は自動生成のみとし、投稿者による任意分岐名入力は入れない。

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
- `level`
- `md5`
- `dl_link`

`progress=100` 到達時は `completed_at` を保存する。

`progress=100` と `is_rejected` は別フラグとして扱う。ただし `is_rejected=1` の初回投稿は保存時に `progress=100` へ強制する。

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

例:

```text
ver1.0 progress=30
└ ver2.0-a progress=70
   └ ver3.0-a progress=100
```

この場合:

- `ver1.0`: DL不可, reason=`superseded_by_completed_descendant`
- `ver2.0-a`: DL不可, reason=`superseded_by_completed_descendant`
- `ver3.0-a`: DL可

例:

```text
ver1.0 progress=30
└ ver2.0-a progress=100
   └ ver3.0-a progress=100
```

この場合:

- `ver1.0`: DL不可, reason=`superseded_by_completed_descendant`
- `ver2.0-a`: DL可
- `ver3.0-a`: DL可

### DL不可譜面の将来自動削除

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

MVPでの自動削除対象条件:

- `download_blocked=1`
- `download_blocked_at` が現在時刻から30日以上前
- `file_deleted_at IS NULL`
- `is_hidden=0` または管理理由によりファイルだけ残っている状態

MVPでの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。削除申請は管理人確認が前提のため、将来含める場合は `delete_requests.status='approved'` などの承認済み条件を追加する。

Phase 10-FではCron TriggerとR2自動削除本体は実装しない。

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

各version行に「削除」ボタンを表示する想定とする。

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

BMSの `#TITLE` に差分名が含まれる場合がある。

例:

```text
#TITLE 星の器 [ANOTHER]
```

この場合、曲名部分 `星の器` と差分名部分 `[ANOTHER]` を分離できる設計にする。高度な分離実装は後回しでよいが、DB上は `songs` と `charts` を分けることで対応可能にしておく。

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

### 既存API

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts`
- `POST /api/charts/:chartId/versions`
- `GET /api/files/:fileId`
- `POST /api/admin/hide-version`
- `POST /api/admin/ban`

### 追加設計API

後続Phaseで実装する。

- `GET /api/table`
- `GET /api/table?level=...`
- `GET /api/table/search?q=...`
- `POST /api/versions/:versionId/withdraw`
- `POST /api/versions/:versionId/delete-request`
- `GET /api/admin/delete-requests`
- `POST /api/admin/delete-requests/:requestId/approve`
- `POST /api/admin/delete-requests/:requestId/reject`

難易度表APIは一覧APIとは分ける。難易度表は `progress=100` かつDL可能なversion中心に返し、`is_rejected=1` のversionも没譜面バッジ付きで返す設計にする。

## DB仕様

schemaファイル:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `schema/d1.sql`

### 設計方針

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

### songs

元曲単位の情報を保存する。

主なカラム:

- `id`
- `title`
- `subtitle`
- `artist`
- `subartist`
- `normalized_title`
- `normalized_subtitle`
- `normalized_artist`
- `normalized_subartist`
- `created_at`
- `updated_at`

### charts

差分単位の情報を保存する。

主なカラム:

- `id`
- `song_id`
- `chart_name`
- `normalized_chart_name`
- `is_hidden`
- `hidden_reason`
- `created_at`
- `updated_at`

`song_id` は `songs.id` への外部キー。

`song_id + normalized_chart_name` で重複確認できるようにする。

### versions

分岐・履歴単位の情報を保存する。

主なカラム:

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

root versionのみ `parent_version_id` はNULL。それ以外のversionは `parent_version_id` 必須とする。

`display_version` はDBに保存せず、APIレスポンス時に生成する。

`file_deleted_at` は将来R2ファイルが自動削除または管理削除された日時を保存する。`file_delete_reason` はファイル削除理由を保存する。

### delete_requests

削除申請を保存する。

主なカラム:

- `id`
- `version_id`
- `chart_id`
- `message`
- `requester_ip_hash`
- `requester_ua_hash`
- `status`
- `created_at`
- `handled_at`
- `handled_by`
- `admin_note`

### post_logs

投稿試行ログを保存する。

主なカラム:

- `id`
- `action`
- `song_id`
- `chart_id`
- `version_id`
- `ip_hash`
- `ua_hash`
- `file_sha256`
- `result`
- `error_code`
- `detail`
- `created_at`

### bans

BAN情報を保存する。

主なカラム:

- `id`
- `ban_type`
- `ban_value`
- `reason`
- `active`
- `created_at`
- `updated_at`
- `expired_at`
- `disabled_at`

`ban_type` は以下を想定する。

- `ip_hash`
- `ua_hash`
- `file_sha256`

### admin_logs

管理者向けの操作ログ・運用ログを保存する。

主なカラム:

- `id`
- `action`
- `target_type`
- `target_id`
- `level`
- `code`
- `reason`
- `detail`
- `created_at`

R2使用量が8GBを超えた場合は、`level='warning'`, `code='R2_USAGE_EXCEEDED_8GB'` として記録する。

将来の自動削除では、成功時に `AUTO_FILE_DELETE_SUCCEEDED`、失敗時に `AUTO_FILE_DELETE_FAILED` を記録する。

## エラー設計

### エラーレスポンス形式

```json
{
  "code": "ERROR_CODE",
  "message": "ユーザー向けの短い説明",
  "detail": "原因追跡に使える詳細情報"
}
```

### ログ方針

エラーは握りつぶさない。

`console.error` には処理段階名を含める。

秘密情報、APIキー、トークン、生IP、生UA、生パスワードはログに出力しない。

### 想定エラーコード一覧

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
| `COMMENT_URL_LIMIT_EXCEEDED` | コメント内のURL数が多すぎます。 |
| `EMPTY_USER_AGENT` | User-Agentが確認できません。 |
| `BOT_USER_AGENT_REJECTED` | 自動投稿の可能性があるため拒否しました。 |
| `RATE_LIMITED` | 投稿間隔が短すぎます。 |
| `DAILY_LIMIT_EXCEEDED` | 1日の投稿数上限に達しました。 |
| `DUPLICATE_FILE` | 同じファイルは投稿できません。 |
| `BANNED_POSTER` | 投稿が制限されています。 |
| `CHART_NOT_FOUND` | 対象の差分が見つかりません。 |
| `VERSION_NOT_FOUND` | 対象のバージョンが見つかりません。 |
| `FILE_NOT_FOUND` | ファイルが見つかりません。 |
| `INVALID_PASSWORD` | 管理パスワードが一致しません。 |
| `WITHDRAW_NOT_ALLOWED` | このversionは取り下げできません。 |
| `DELETE_REQUEST_ALREADY_EXISTS` | 削除申請は既に存在します。 |
| `R2_UPLOAD_FAILED` | ファイル保存に失敗しました。 |
| `R2_DOWNLOAD_FAILED` | ファイル取得に失敗しました。 |
| `DB_READ_FAILED` | データ取得に失敗しました。 |
| `DB_WRITE_FAILED` | データ保存に失敗しました。 |
| `ADMIN_AUTH_REQUIRED` | 管理者認証が必要です。 |
| `CORS_ORIGIN_NOT_ALLOWED` | 許可されていないOriginです。 |
| `METHOD_NOT_ALLOWED` | 許可されていないHTTPメソッドです。 |
| `CONFIG_MISSING` | 必要な設定が不足しています。 |
| `INTERNAL_ERROR` | 予期しないエラーが発生しました。 |

### 管理ログ用コード

| code | level | 内容 |
| --- | --- | --- |
| `R2_USAGE_EXCEEDED_8GB` | `warning` | R2使用量が8GBを超えた。 |
| `AUTO_FILE_DELETE_SUCCEEDED` | `info` | DL不可から30日経過したR2ファイルの自動削除に成功した。 |
| `AUTO_FILE_DELETE_FAILED` | `error` | DL不可から30日経過したR2ファイルの自動削除に失敗した。 |
