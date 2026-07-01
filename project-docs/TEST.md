# テスト手順

## Phase 10-Fの対象

Phase 10-Fでは、没譜面仕様と自動削除準備の最小修正を確認する。

今回確認するもの:

- `worker/migrations/0002_file_delete_and_rejected_rules.sql` をD1へ適用できること
- `versions.file_deleted_at` と `versions.file_delete_reason` が追加されること
- `POST /api/charts` で `isRejected=true` の場合、入力 `progress` に関係なく保存値が `100` になること
- `isRejected=true` の場合、`completedAt` が返ること
- `POST /api/charts` の成功レスポンスに `progress`, `isRejected`, `completedAt` が含まれること
- `GET /api/charts` で対象versionが `progress: 100`, `completed: true`, `isRejected: true` として返ること
- エラーが必ず `code`, `message`, `detail` のJSONになること

今回確認しないもの:

- Cron Trigger実装
- R2自動削除処理
- `POST /api/charts/:chartId/versions` の本実装
- 取り下げAPI
- 削除申請API
- 難易度表API
- フロント接続

## 事前準備

依存関係を入れていない環境では、先に `worker` ディレクトリで依存関係を入れる。

```bash
cd worker
npm install
```

型チェック:

```bash
npm run typecheck
```

ローカル確認用のsecretは、コミットしない `.dev.vars` などで設定する。

```text
HASH_SECRET=local-dev-hash-secret
ADMIN_TOKEN=local-dev-admin-token
```

remoteに設定する場合:

```bash
cd worker
npx wrangler secret put HASH_SECRET
npx wrangler secret put ADMIN_TOKEN
```

## 0002 migration適用

ローカルD1へ適用する。

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
```

remote D1へ適用する場合は `--local` を外す。

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db
```

DashboardからSQL実行する場合は、以下を実行する。

```sql
ALTER TABLE versions ADD COLUMN file_deleted_at TEXT;
ALTER TABLE versions ADD COLUMN file_delete_reason TEXT;
```

## 追加カラム確認

ローカルD1で確認する。

```bash
cd worker
npx wrangler d1 execute wip-bms-charts-db --local --command "PRAGMA table_info(versions);"
```

remote確認の場合は `--local` を外す。

期待すること:

- `file_deleted_at` が存在する
- `file_delete_reason` が存在する

## Worker起動

ローカルD1/R2で確認する場合:

```bash
cd worker
npm run dev
```

remote D1/R2で確認する場合:

```bash
cd worker
npx wrangler dev --remote
```

別ターミナルで確認する。

```bash
curl.exe http://localhost:8787/api/health
curl.exe http://localhost:8787/api/charts
```

## テスト用BMSファイル作成例

PowerShell例:

```powershell
@"
#PLAYER 1
#TITLE Test Song Phase 10-F Rejected
#ARTIST Test Artist
#PLAYLEVEL 3
#BPM 120
#00111:01
"@ | Set-Content -Encoding UTF8 .\phase10f-rejected.bms
```

## isRejected=true 初回投稿確認

`progress=30` を送っても、保存値とレスポンスは `progress=100` になることを確認する。

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10f-rejected.bms;type=text/plain" `
  -F "title=" `
  -F "subtitle=" `
  -F "artist=" `
  -F "subartist=" `
  -F "chartName=[REJECTED]" `
  -F "difficulty=★3" `
  -F "level=3" `
  -F "author=tester" `
  -F "progress=30" `
  -F "comment=https://example.com/sound-source" `
  -F "isRejected=true" `
  -F "password=test-password"
```

期待レスポンス例:

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
    "name": "phase10f-rejected.bms",
    "size": 1024,
    "sha256": "...",
    "md5": "...",
    "downloadUrl": "/api/files/file_..."
  },
  "metadata": {
    "title": "Test Song Phase 10-F Rejected",
    "artist": "Test Artist",
    "encoding": "utf-8"
  },
  "warnings": []
}
```

確認ポイント:

- `progress` が `100`
- `isRejected` が `true`
- `completed` が `true`
- `completedAt` が `null` ではない

## D1保存値確認

レスポンスの `<versionId>` を使って確認する。

```bash
cd worker
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT id, progress, is_rejected, completed_at, file_deleted_at, file_delete_reason FROM versions WHERE id = '<versionId>';"
```

remote確認の場合は `--local` を外す。

期待する値:

```text
progress = 100
is_rejected = 1
completed_at = NULLではない
file_deleted_at = NULL
file_delete_reason = NULL
```

## GET /api/chartsでの確認

```powershell
curl.exe "http://localhost:8787/api/charts?page=1&pageSize=10"
```

対象versionの期待値:

```json
{
  "progress": 100,
  "completed": true,
  "completedAt": "2026-07-01T12:00:00.000Z",
  "isRejected": true
}
```

## isRejected=falseの通常投稿確認

`isRejected=false` では従来通り、入力された `progress` が保存されることを確認する。

```powershell
@"
#PLAYER 1
#TITLE Test Song Phase 10-F Normal
#ARTIST Test Artist
#PLAYLEVEL 2
#BPM 120
#00111:01
"@ | Set-Content -Encoding UTF8 .\phase10f-normal.bms

curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10f-normal.bms;type=text/plain" `
  -F "title=" `
  -F "subtitle=" `
  -F "artist=" `
  -F "subartist=" `
  -F "chartName=[NORMAL]" `
  -F "difficulty=★2" `
  -F "level=2" `
  -F "author=tester" `
  -F "progress=30" `
  -F "comment=https://example.com/sound-source" `
  -F "isRejected=false" `
  -F "password=test-password"
```

期待すること:

- `progress` が `30`
- `isRejected` が `false`
- `completed` が `false`
- `completedAt` が `null`

## progressバリデーション確認

`isRejected=true` でも `progress` の入力バリデーションは維持する。

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10f-rejected.bms;type=text/plain" `
  -F "title=Invalid Progress Test" `
  -F "artist=Test Artist" `
  -F "chartName=[INVALID]" `
  -F "author=tester" `
  -F "progress=101" `
  -F "comment=" `
  -F "isRejected=true" `
  -F "password=test-password"
```

期待レスポンス:

```json
{
  "code": "INVALID_PROGRESS",
  "message": "進捗度の値が不正です。",
  "detail": "progress must be an integer between 0 and 100."
}
```

## 将来の追記APIテスト項目

Phase 10-Fでは `POST /api/charts/:chartId/versions` は未実装のため、以下は将来Phaseで確認する。

追記投稿で `isRejected=true` が送られた場合:

```json
{
  "code": "INVALID_REJECTED_FLAG_FOR_FOLLOWUP",
  "message": "追記投稿では没譜面チェックを指定できません。",
  "detail": "isRejected is allowed only on initial chart creation."
}
```

没譜面versionを親にして追記しようとした場合:

```json
{
  "code": "REJECTED_CHART_CANNOT_BE_EXTENDED",
  "message": "没譜面から追記投稿はできません。",
  "detail": "The selected parent version is rejected and cannot be extended."
}
```

## 将来の自動削除テスト項目

Phase 10-FではCron TriggerとR2自動削除処理は未実装のため、以下は将来Phaseで確認する。

対象条件:

- `download_blocked=1`
- `download_blocked_at` が30日以上前
- `file_deleted_at IS NULL`
- `download_block_reason` が以下のいずれか
  - `superseded_by_completed_descendant`
  - `withdrawn`
  - `admin_blocked`
  - `admin_hidden`

期待する更新:

```sql
is_hidden = 1
hidden_reason = 'auto_deleted_after_download_block'
hidden_at = CURRENT_TIMESTAMP
file_deleted_at = CURRENT_TIMESTAMP
file_delete_reason = 'auto_deleted_after_download_block'
updated_at = CURRENT_TIMESTAMP
```

`delete_requested` はMVPでは自動削除対象に含めない。

## テストデータ削除

必要に応じてD1とR2のテストデータを削除する。

D1は外部キーがあるため、versionから順に削除する。

```sql
DELETE FROM post_logs WHERE detail LIKE '%Initial chart version created.%' OR error_code IS NOT NULL;
DELETE FROM versions WHERE title LIKE '%Phase 10-F%' OR title LIKE '%Phase10F%';
DELETE FROM charts WHERE chart_name IN ('[REJECTED]', '[NORMAL]', '[INVALID]');
DELETE FROM songs WHERE title LIKE '%Phase 10-F%' OR title LIKE '%Phase10F%';
```

R2は `charts/{chartId}/versions/root/` 配下のテストファイルをDashboardから削除する。

## 注意

Phase 10-Fでは、初回投稿APIの没譜面保存ルールとD1列追加のみを実装する。

追記API、Cron Trigger、R2自動削除処理、難易度表APIはまだ未実装のため、該当項目は仕様と将来テスト項目として確認する。
