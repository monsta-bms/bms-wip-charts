# テスト手順

## Phase 10-Eの対象

Phase 10-Eでは `GET /api/files/:fileId` のR2実ダウンロードを確認する。

今回確認するもの:

- `GET /api/files/:fileId` がD1からversion/file情報を取得すること
- fileIdに対応するversionがなければ `FILE_NOT_FOUND` を返すこと
- `versions.is_hidden=1` なら `FILE_NOT_AVAILABLE` を返すこと
- `charts.is_hidden=1` でも `FILE_NOT_AVAILABLE` を返すこと
- `versions.download_blocked=1` なら `FILE_DOWNLOAD_BLOCKED` を返すこと
- D1の `r2_key` からR2 objectを取得すること
- R2 objectがなければ `R2_FILE_NOT_FOUND` を返すこと
- 成功時はファイル本体を返すこと
- `Content-Type` が拡張子に応じて設定されること
- `Content-Disposition: attachment` で元ファイル名を使えること
- エラーが必ず `code`, `message`, `detail` のJSONになること

今回確認しないもの:

- `POST /api/charts/:chartId/versions`
- 取り下げAPI
- 削除申請API
- 難易度表API
- 高度な権限管理
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

## ローカルD1/R2で確認する場合

ローカルD1にmigrationを適用する。

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
```

Workerを起動する。

```bash
npm run dev
```

別ターミナルで確認する。

```bash
curl.exe http://localhost:8787/api/health
curl.exe http://localhost:8787/api/charts
```

`/api/health` の `phase` が `phase-10-e` であることを確認する。

## remote D1/R2で確認する場合

remote D1にはPhase 10-A改のmigrationが適用済みであること。

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
#TITLE Test Song Phase 10-E
#ARTIST Test Artist
#PLAYLEVEL 3
#BPM 120
#WAV01 dummy.wav
#00111:01
"@ | Set-Content -Encoding UTF8 .\phase10e-test.bms
```

## 初回投稿でfileIdを作る

Phase 10-Dの `POST /api/charts` を使って、D1 metadataとR2 objectを作る。

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10e-test.bms;type=text/plain" `
  -F "title=" `
  -F "subtitle=" `
  -F "artist=" `
  -F "subartist=" `
  -F "chartName=[ANOTHER]" `
  -F "difficulty=★3" `
  -F "level=3" `
  -F "author=tester" `
  -F "progress=30" `
  -F "comment=https://example.com/sound-source" `
  -F "isRejected=false" `
  -F "password=test-password"
```

レスポンスの `fileId`, `versionId`, `chartId` を控える。

一覧から確認する場合:

```powershell
curl.exe "http://localhost:8787/api/charts?page=1&pageSize=10"
```

`charts[0].versions[0].file.id` がDL確認に使う `fileId`。

## ファイルDL確認

`<fileId>` を実際のIDに置き換える。

```powershell
curl.exe -i -L "http://localhost:8787/api/files/<fileId>" -o .\downloaded-phase10e.bms
```

期待する主なヘッダー:

```text
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Content-Disposition: attachment; filename="phase10e-test.bms"; filename*=UTF-8''phase10e-test.bms
X-Content-Type-Options: nosniff
```

保存されたファイルを確認する。

```powershell
Get-Content .\downloaded-phase10e.bms
```

`.zip` の場合は `Content-Type: application/zip` になることを確認する。

## 存在しないfileId

```powershell
curl.exe "http://localhost:8787/api/files/file_not_found_test"
```

期待レスポンス:

```json
{
  "code": "FILE_NOT_FOUND",
  "message": "ファイルが見つかりません。",
  "detail": "No version exists for the requested fileId."
}
```

## download_blocked時の確認

対象versionをDLブロック状態にする。

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "UPDATE versions SET download_blocked = 1, download_block_reason = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP, download_blocked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE file_id = '<fileId>';"
```

remote確認の場合は `--local` を外す。

DLを試す。

```powershell
curl.exe "http://localhost:8787/api/files/<fileId>"
```

期待レスポンス:

```json
{
  "code": "FILE_DOWNLOAD_BLOCKED",
  "message": "このファイルはダウンロードできません。",
  "detail": "Download is blocked. reason=withdrawn"
}
```

元に戻す場合:

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "UPDATE versions SET download_blocked = 0, download_block_reason = NULL, withdrawn_at = NULL, download_blocked_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE file_id = '<fileId>';"
```

## version is_hidden時の確認

対象versionを非表示にする。

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "UPDATE versions SET is_hidden = 1, hidden_reason = 'test hidden', hidden_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE file_id = '<fileId>';"
```

DLを試す。

```powershell
curl.exe "http://localhost:8787/api/files/<fileId>"
```

期待レスポンス:

```json
{
  "code": "FILE_NOT_AVAILABLE",
  "message": "このファイルは現在利用できません。",
  "detail": "The version is hidden. reason=test hidden"
}
```

元に戻す場合:

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "UPDATE versions SET is_hidden = 0, hidden_reason = NULL, hidden_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE file_id = '<fileId>';"
```

## chart is_hidden時の確認

対象chartを非表示にする。

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "UPDATE charts SET is_hidden = 1, hidden_reason = 'test chart hidden', updated_at = CURRENT_TIMESTAMP WHERE id = '<chartId>';"
```

DLを試す。

```powershell
curl.exe "http://localhost:8787/api/files/<fileId>"
```

期待レスポンス:

```json
{
  "code": "FILE_NOT_AVAILABLE",
  "message": "このファイルは現在利用できません。",
  "detail": "The parent chart is hidden. reason=test chart hidden"
}
```

元に戻す場合:

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "UPDATE charts SET is_hidden = 0, hidden_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = '<chartId>';"
```

## R2_FILE_NOT_FOUNDの確認

D1 metadataだけ残してR2 objectを削除した場合、以下を返す。

```json
{
  "code": "R2_FILE_NOT_FOUND",
  "message": "保存済みファイルが見つかりません。",
  "detail": "D1 metadata exists, but the R2 object for r2_key was not found."
}
```

R2 object削除はDashboardで対象 `r2_key` を確認してから行う。

## DB確認

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT versions.file_id, versions.file_name, versions.file_size, versions.r2_key, versions.download_blocked, versions.is_hidden, charts.is_hidden AS chart_hidden FROM versions JOIN charts ON charts.id = versions.chart_id ORDER BY versions.created_at DESC LIMIT 5;"
```

remote確認の場合は `--local` を外す。

## テストデータ削除

必要に応じてD1とR2のテストデータを削除する。

D1は外部キーがあるため、versionから順に削除する。

```sql
DELETE FROM post_logs WHERE detail LIKE '%Initial chart version created.%' OR error_code IS NOT NULL;
DELETE FROM versions WHERE title LIKE '%Phase 10-E%' OR title LIKE '%Phase10E%';
DELETE FROM charts WHERE chart_name IN ('[ANOTHER]', '[HYPER]', '[NORMAL]');
DELETE FROM songs WHERE title LIKE '%Phase 10-E%' OR title LIKE '%Phase10E%';
```

R2は `charts/{chartId}/versions/root/` 配下のテストファイルをDashboardから削除する。

## 注意

Phase 10-Eでは `GET /api/files/:fileId` のDL可否判定とR2取得のみを実装する。

取り下げAPI、削除申請API、管理人非表示APIはまだ未実装のため、DLブロックや非表示の確認はD1を直接更新して行う。
