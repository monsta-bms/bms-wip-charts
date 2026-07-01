# API仕様

## 概要

Phase 10-FEでは、GitHub Pages の静的フロント画面を本番Worker APIへ接続した。

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
- `GET /api/files/:fileId`
- GitHub Pages からの一覧取得
- GitHub Pages 投稿フォームからの初回投稿

まだ実装しないもの:

- `POST /api/charts/:chartId/versions`
- 追記投稿
- 取り下げ
- 削除申請
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理

## 共通仕様

### Base URL

フロント `docs/app.js` では以下を `API_BASE_URL` とする。

```js
const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
```

ローカルWorker確認時は以下も利用できる。

```text
http://localhost:8787
```

### CORS

CORSは `ALLOWED_ORIGINS` で許可Originを制御する。

`ALLOWED_ORIGINS` はカンマ区切りで複数Originを指定できる。

```toml
[vars]
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

後方互換として `ALLOWED_ORIGIN` も読み取るが、今後は `ALLOWED_ORIGINS` を使う。

`Origin` ヘッダーがあるリクエストで許可Originに一致しない場合は、`CORS_ORIGIN_NOT_ALLOWED` を返す。

### エラーレスポンス

APIエラーは必ず以下のJSON形式で返す。

```json
{
  "code": "ERROR_CODE",
  "message": "ユーザー向けの短い説明",
  "detail": "原因追跡に使える詳細情報"
}
```

GitHub Pages側では `code`, `message`, `detail` を画面上部のエラー欄に表示する。

### Secrets

以下はCloudflare secretsで設定する。

- `HASH_SECRET`: password_hash、IPハッシュ、UAハッシュの生成に使う。
- `ADMIN_TOKEN`: 管理API用。

秘密情報はソースコードや `wrangler.toml` に直書きしない。

## 難易度表示方針

ユーザーが入力・閲覧する項目は `difficulty` を使い、表示名は「想定難易度」に統一する。

`level` は内部値として保持する。

- 通常の初回投稿フォームには `level` の見える入力欄を出さない。
- 投稿一覧では `difficulty` のみ表示し、`level` を併記しない。
- `GET /api/charts` は既存API互換のため `level` を返してよい。
- 将来の難易度表APIでは `level` を返してよい。
- DB上の `versions.level` カラムは残す。

`POST /api/charts` では、`level` が未入力の場合に `difficulty` から可能な範囲で自動抽出する。

抽出例:

| difficulty | 表示 | 保存するlevel |
| --- | --- | --- |
| `★12` | `★12` | `12` |
| `st5` | `st5` | `5` |
| `sl8` | `sl8` | `8` |
| `12` | `12` | `12` |

抽出できない場合、`level` は空または `null` として扱う。

## D1 schema

schema / migrationファイル:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `schema/d1.sql`

テーブル:

- `songs`
- `charts`
- `versions`
- `delete_requests`
- `post_logs`
- `bans`
- `admin_logs`

Phase 10-Fで `versions` に追加したカラム:

| column | 内容 |
| --- | --- |
| `file_deleted_at` | 将来R2ファイルが自動削除または管理削除された日時。 |
| `file_delete_reason` | 将来R2ファイルを削除した理由。 |

## エンドポイント

### GET /api/health

Workerが動いているか確認する。

レスポンス例:

```json
{
  "status": "ok",
  "service": "bms-wip-charts-worker",
  "phase": "phase-10-e"
}
```

### GET /api/charts

D1から投稿一覧を取得する。

GitHub Pages側はページ表示時と投稿成功後にこのAPIを呼ぶ。

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

GitHub Pages側は `multipart/form-data` で本番Workerへ送信する。

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
- `comment`
- `isRejected`
- `password`

主な仕様:

- `file`, `chartName`, `author`, `progress`, `password` は必須。
- `title` / `artist` はBMS本文から読める場合は空でもよい。
- 通常フォームでは `level` を見える入力欄として表示しない。
- `level` が未入力の場合は `difficulty` から可能な範囲で自動抽出する。
- 許可拡張子は `.bms`, `.bme`, `.bml`, `.zip` のみ。
- 単体譜面ファイルは2MBまで。
- zipファイルは5MBまで。
- 音源ファイルのアップロードは禁止する。
- 音源URLが必要な場合は `comment` にURLを貼る。
- 同一 `file_sha256` は `DUPLICATE_FILE` で拒否する。
- 作成するversionは `ver1.0` 相当。
- `isRejected=true` の場合は、入力された `progress` に関係なく保存値を `progress=100` に強制する。
- `isRejected=true` の場合は `completed_at` を保存し、completed扱いにする。
- 投稿成功後、GitHub Pages側は `GET /api/charts` を再取得して一覧を更新する。

成功レスポンス例:

```json
{
  "songId": "song_...",
  "chartId": "chart_...",
  "versionId": "version_...",
  "fileId": "file_...",
  "displayVersion": "ver1.0",
  "progress": 100,
  "isRejected": true,
  "completed": true,
  "completedAt": "2026-07-01T12:00:00.000Z",
  "file": {
    "name": "sample.bms",
    "size": 1024,
    "sha256": "...",
    "md5": "...",
    "downloadUrl": "/api/files/file_..."
  },
  "metadata": {
    "title": "Test Song",
    "artist": "Test Artist",
    "encoding": "utf-8"
  },
  "warnings": []
}
```

### GET /api/files/:fileId

投稿ファイルをダウンロードする。

GitHub Pages側では `version.file.downloadUrl` を `API_BASE_URL` と結合してDLリンクを表示する。

例:

```text
/api/files/file_... -> https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/files/file_...
```

エラー:

- fileIdに対応するversionがない場合は `FILE_NOT_FOUND`。
- versionが非表示の場合は `FILE_NOT_AVAILABLE`。
- 親chartが非表示の場合も `FILE_NOT_AVAILABLE`。
- `download_blocked=1` の場合は `FILE_DOWNLOAD_BLOCKED`。
- D1にはあるがR2にない場合は `R2_FILE_NOT_FOUND`。
- R2取得処理が失敗した場合は `R2_DOWNLOAD_FAILED`。

## スタブのままのエンドポイント

### POST /api/charts/:chartId/versions

既存chartへ追記投稿する。Phase 10-FEでは未実装。

将来の本実装では以下のルールを適用する。

- 追記投稿では `isRejected` を指定できない。
- 追記投稿で `isRejected=true` が送られた場合は `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返す。
- 追記元の親versionが `is_rejected=1` の場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返す。

### POST /api/admin/hide-version

管理人が指定versionを非表示にする。Phase 10-FEではスタブ応答のまま。

### POST /api/admin/ban

管理人がIPハッシュ、UAハッシュ、ファイルSHA256をBANする。Phase 10-FEではスタブ応答のまま。

## 自動削除準備

Phase 10-FEではCron TriggerとR2自動削除処理は実装しない。

将来、Cloudflare Workers Cron Triggerで1日1回程度、DL不可から30日経過したversionのR2ファイルを整理する。

MVPの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。

## displayVersion生成方針

DBには `displayVersion` / `display_version` を保存しない。

レスポンス時に以下から生成する。

- `version_number`
- `branch_label`
- `branch_path`

例:

| branch_path | version_number | branch_label | displayVersion |
| --- | ---: | --- | --- |
| `root` | 1 | `` | `ver1.0` |
| `root/a` | 2 | `a` | `ver2.0-a` |
| `root/b` | 2 | `b` | `ver2.0-b` |
| `root/a/1` | 3 | `a1` | `ver3.0-a1` |

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
| `INVALID_EXTENSION` | 400 | 許可されていない拡張子。 |
| `FILE_TOO_LARGE` | 400 | ファイルサイズ上限超過。 |
| `DUPLICATE_FILE` | 409 | 同じ `file_sha256` のversionが既にある。 |
| `CHART_ALREADY_EXISTS` | 409 | 初回投稿対象のchartが既にある。 |
| `R2_UPLOAD_FAILED` | 500 | R2への保存に失敗。 |
| `DB_INSERT_FAILED` | 500 | D1への保存に失敗。 |
| `INVALID_FILE_ID` | 400 | `fileId` が空または不正。 |
| `FILE_NOT_FOUND` | 404 | fileIdに対応するversionがない。 |
| `FILE_NOT_AVAILABLE` | 403 | versionまたはchartが非表示。 |
| `FILE_DOWNLOAD_BLOCKED` | 403 | versionのDLがブロックされている。 |
| `R2_FILE_NOT_FOUND` | 404 | D1 metadataはあるがR2 objectがない。 |
| `R2_DOWNLOAD_FAILED` | 500 | R2からの取得に失敗。 |
| `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` | 400 | 追記投稿では没譜面チェックを指定できない。 |
| `REJECTED_CHART_CANNOT_BE_EXTENDED` | 409 | 没譜面versionから追記投稿しようとした。 |
| `UNKNOWN_ERROR` | 500 | 想定外エラー。 |
| `INTERNAL_ERROR` | 500 | 未処理例外。 |

## 管理ログ用コード

| code | level | 内容 |
| --- | --- | --- |
| `R2_USAGE_EXCEEDED_8GB` | `warning` | R2使用量が8GBを超えた。 |
| `AUTO_FILE_DELETE_SUCCEEDED` | `info` | DL不可から30日経過したR2ファイルの自動削除に成功した。 |
| `AUTO_FILE_DELETE_FAILED` | `error` | DL不可から30日経過したR2ファイルの自動削除に失敗した。 |
