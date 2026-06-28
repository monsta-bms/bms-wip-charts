# BMS WIP Charts 仕様書

## 目的

BMS差分をログイン不要で共有できる1ページサイトを作る。

## 公開情報

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/wipbmschart/

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
- アーティスト
- 想定難易度
- 差分作者
- 進捗度
- コメント

曲名とアーティストは、譜面ファイルから `#TITLE` と `#ARTIST` を読み取り、自動入力する。

想定難易度は任意入力とする。

進捗度は `0` から `100` までの数値入力とする。

音源ファイルはアップロード禁止とする。音源が必要な場合は、コメント欄にURLを貼る方式とする。

### 投稿一覧

投稿一覧では、曲名とアーティストを結合表示風に見せる。

各曲の下にバージョン行を表示する。

各バージョン行には以下を表示する。

- 想定難易度
- 差分作者
- 進捗度
- コメント
- DLリンク
- 追記投稿ボタン

## 投稿仕様

### 投稿対象ファイル

アップロード可能なファイルは以下のみとする。

- `.bms`
- `.bme`
- `.bml`
- `.zip`

上記以外の拡張子は拒否する。

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

音源の案内はコメント欄にURLを貼る方式とする。

### BMSメタ情報の読み取り

`.bms`, `.bme`, `.bml` または `.zip` 内の譜面ファイルから、以下を読み取る。

- `#TITLE` を曲名として扱う。
- `#ARTIST` をアーティストとして扱う。

読み取りに失敗した場合でも、ユーザーがフォーム上で手入力できるようにする。

### バージョン管理

初回投稿は `ver1.0` とする。

同じ曲に対する追記投稿ごとに、以下のようにバージョンを増やす。

- 1回目: `ver1.0`
- 2回目: `ver2.0`
- 3回目: `ver3.0`

各バージョンは過去verとして保持し、DL可能にする。

## バックエンド想定

### 実行環境

- Cloudflare Worker を使用する。
- Cloudflare D1 をDBとして使用する。
- Cloudflare R2 をファイル保存先として使用する。
- Turnstile は後で追加できる設計にする。

### Cloudflareリソース

D1 database:

- database_name: `wip-bms-charts-db`
- database_id: `d55ed399-5a31-43a0-89d4-9bd2f32ba3a7`
- Worker binding: `DB`

R2 bucket:

- bucket_name: `wip-bms-charts-files`
- Worker binding: `CHART_FILES`
- 保存形式は Standard のみとする。

### R2使用量監視

R2使用量が8GBを超えた場合、管理ログに警告を出す。

警告は通常ユーザー向けAPIエラーではなく、管理者が後から確認できる運用ログとして扱う。

### 秘密情報

秘密情報、APIキー、トークンをソースコードに直書きしない。

秘密情報は Cloudflare secrets を使う前提にする。

## 荒らし対策

### 投稿者識別

IPアドレスは生保存しない。

IPアドレスは、secret付きSHA-256でハッシュ化して保存・照合する。

User-Agent も生保存せず、ハッシュ化して保存・照合する。

### 投稿制限

以下の投稿制限を行う。

- IPハッシュごとの投稿間隔制限
- IPハッシュごとの1日投稿数制限
- 1IPあたり1日10投稿まで
- UA空欄の拒否
- botっぽいUAの拒否
- ファイルSHA256重複の拒否
- zip内の禁止拡張子検査
- 音源拡張子入りzipの拒否
- コメント内URL数制限

### 管理機能

管理人が後から以下を行える設計にする。

- バージョンの非表示
- IPハッシュまたはUAハッシュに基づくBAN
- 管理ログの確認

管理機能は通常ユーザー向け画面とは分離し、管理操作には認証を設ける前提とする。

## API仕様

APIエラーは必ず JSON で `code`, `message`, `detail` を返す。

### GET /api/charts

投稿一覧を取得する。

返却内容には、曲情報と各バージョン情報を含める。

非表示にされたバージョンは通常一覧には含めない。

### POST /api/charts

新規曲として初回投稿する。

成功時は `ver1.0` のバージョンを作成する。

主な処理:

- 投稿ファイルの検証
- ファイルサイズ上限の検証
- zip内ファイルの検査
- BMSメタ情報の読み取り
- ファイルSHA256の計算
- 荒らし対策チェック
- R2へのファイル保存
- D1への曲情報・バージョン情報・投稿ログ保存

### POST /api/charts/:chartId/versions

既存曲へ追記投稿する。

成功時は既存の最新バージョン番号をもとに、次の `verX.0` を作成する。

主な処理:

- 対象曲の存在確認
- 投稿ファイルの検証
- ファイルサイズ上限の検証
- zip内ファイルの検査
- ファイルSHA256の計算
- 荒らし対策チェック
- R2へのファイル保存
- D1へのバージョン情報・投稿ログ保存

### GET /api/files/:fileId

投稿ファイルをダウンロードする。

非表示バージョンや存在しないファイルはダウンロードできない。

### POST /api/admin/hide-version

管理人が指定バージョンを非表示にする。

通常一覧とDL対象から除外する。

### POST /api/admin/ban

管理人がIPハッシュまたはUAハッシュをBANする。

BAN対象からの投稿は拒否する。

## DB仕様

### charts

曲単位の情報を保存する。

想定カラム:

- `id`
- `title`
- `artist`
- `created_at`
- `updated_at`

### versions

投稿バージョン単位の情報を保存する。

想定カラム:

- `id`
- `chart_id`
- `version_number`
- `difficulty`
- `author`
- `progress`
- `comment`
- `file_id`
- `file_sha256`
- `file_name`
- `file_size`
- `is_hidden`
- `created_at`

### post_logs

荒らし対策と監査用の投稿ログを保存する。

想定カラム:

- `id`
- `ip_hash`
- `ua_hash`
- `file_sha256`
- `action`
- `result`
- `error_code`
- `created_at`

### bans

BAN情報を保存する。

想定カラム:

- `id`
- `target_type`
- `target_hash`
- `reason`
- `created_at`

`target_type` は `ip_hash` または `ua_hash` を想定する。

### admin_logs

管理者向けの運用ログを保存する。

想定カラム:

- `id`
- `level`
- `code`
- `message`
- `detail`
- `created_at`

R2使用量が8GBを超えた場合は、`level` を `warning`、`code` を `R2_USAGE_EXCEEDED_8GB` として記録する。

## エラー設計

### エラーレスポンス形式

APIエラーは以下の形式で返す。

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

初心者でも原因追跡しやすいログを残す。

ログには以下を含める。

- 処理段階名
- APIパス
- 対象ID
- エラーコード
- 失敗理由

秘密情報、APIキー、トークン、生IP、生UAはログに出力しない。

### 想定エラーコード一覧

| code | message | detailの例 |
| --- | --- | --- |
| `INVALID_FILE_TYPE` | 投稿できないファイル形式です。 | 許可拡張子は `.bms`, `.bme`, `.bml`, `.zip` のみです。 |
| `FILE_TOO_LARGE` | ファイルサイズが上限を超えています。 | 単体譜面は2MB、zipは5MBまでです。 |
| `AUDIO_FILE_NOT_ALLOWED` | 音源ファイルはアップロードできません。 | zip内に禁止拡張子のファイルが含まれています。 |
| `ZIP_INSPECTION_FAILED` | zipファイルの検査に失敗しました。 | zipの読み取りまたは展開前検査に失敗しました。 |
| `TITLE_ARTIST_PARSE_FAILED` | 譜面情報の読み取りに失敗しました。 | `#TITLE` または `#ARTIST` を読み取れませんでした。 |
| `INVALID_PROGRESS` | 進捗度の値が不正です。 | 進捗度は0から100の数値で入力してください。 |
| `COMMENT_URL_LIMIT_EXCEEDED` | コメント内のURL数が多すぎます。 | 許可されたURL数を超えています。 |
| `EMPTY_USER_AGENT` | User-Agentが確認できません。 | UA空欄のため投稿を拒否しました。 |
| `BOT_USER_AGENT_REJECTED` | 自動投稿の可能性があるため拒否しました。 | botっぽいUAパターンに一致しました。 |
| `RATE_LIMITED` | 投稿間隔が短すぎます。 | IPハッシュごとの投稿間隔制限に該当しました。 |
| `DAILY_LIMIT_EXCEEDED` | 1日の投稿数上限に達しました。 | 1IPあたり1日10投稿の上限に該当しました。 |
| `DUPLICATE_FILE` | 同じファイルは投稿できません。 | ファイルSHA256が既存投稿と一致しました。 |
| `BANNED_POSTER` | 投稿が制限されています。 | IPハッシュまたはUAハッシュがBAN対象です。 |
| `CHART_NOT_FOUND` | 対象の曲が見つかりません。 | 指定されたchartIdが存在しません。 |
| `VERSION_NOT_FOUND` | 対象のバージョンが見つかりません。 | 指定されたversionIdが存在しません。 |
| `FILE_NOT_FOUND` | ファイルが見つかりません。 | 指定されたfileIdが存在しないか非表示です。 |
| `R2_UPLOAD_FAILED` | ファイル保存に失敗しました。 | R2へのアップロード処理で失敗しました。 |
| `R2_DOWNLOAD_FAILED` | ファイル取得に失敗しました。 | R2からのダウンロード処理で失敗しました。 |
| `DB_READ_FAILED` | データ取得に失敗しました。 | D1の読み取り処理で失敗しました。 |
| `DB_WRITE_FAILED` | データ保存に失敗しました。 | D1の書き込み処理で失敗しました。 |
| `ADMIN_AUTH_REQUIRED` | 管理者認証が必要です。 | 管理APIに認証なしでアクセスしました。 |
| `INTERNAL_ERROR` | 予期しないエラーが発生しました。 | 未分類の例外が発生しました。 |

### 管理ログ用コード

| code | level | 内容 |
| --- | --- | --- |
| `R2_USAGE_EXCEEDED_8GB` | `warning` | R2使用量が8GBを超えた。 |
