# テスト手順

## Phase 10-Dの対象

Phase 10-Dでは `POST /api/charts` の初回投稿APIを確認する。

今回確認するもの:

- `POST /api/charts` が `multipart/form-data` を受け付けること
- `.bms`, `.bme`, `.bml`, `.zip` 以外を拒否すること
- 単体譜面2MB、zip5MBの上限を超えるファイルを拒否すること
- `progress` が0〜100の整数以外なら拒否すること
- `password` 未入力を拒否すること
- `HASH_SECRET` 未設定時に `SERVER_CONFIG_ERROR` を返すこと
- BMS/BME/BML単体投稿で `#TITLE` / `#ARTIST` を可能な範囲で読むこと
- BMS/BME/BML単体投稿でBMS本体MD5とfile_sha256を保存すること
- 同一file_sha256の重複投稿を拒否すること
- 初回投稿で `songs` / `charts` / `versions` / `post_logs` が作られること
- 既存chartへの初回投稿を `CHART_ALREADY_EXISTS` で拒否すること
- `progress=100` の場合 `completed_at` が入ること
- R2にファイルが保存されること
- D1登録失敗時にR2削除を試みる設計になっていること

今回確認しないもの:

- `POST /api/charts/:chartId/versions`
- 分岐追加
- progress=100到達時の親DL制御
- 取り下げAPI
- 削除申請API
- 難易度表API
- 高度なzip内検査
- Turnstile
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

## ローカルD1で確認する場合

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

`/api/health` の `phase` が `phase-10-d` であることを確認する。

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
#TITLE Test Song Phase 10-D
#ARTIST Test Artist
#PLAYLEVEL 3
#BPM 120
#WAV01 dummy.wav
#00111:01
"@ | Set-Content -Encoding UTF8 .\phase10d-test.bms
```

このファイルは音源そのものを含まず、BMSテキスト内に `#WAV` 定義があるだけなので、Phase 10-Dの単体譜面投稿ではアップロード対象として扱える。

## multipart投稿確認

PowerShellでの `curl.exe` 例:

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10d-test.bms;type=text/plain" `
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

期待する主なレスポンス:

```json
{
  "songId": "song_...",
  "chartId": "chart_...",
  "versionId": "version_...",
  "fileId": "file_...",
  "displayVersion": "ver1.0",
  "completed": false,
  "completedAt": null,
  "file": {
    "name": "phase10d-test.bms",
    "size": 123,
    "sha256": "...",
    "md5": "...",
    "downloadUrl": "/api/files/file_..."
  },
  "metadata": {
    "title": "Test Song Phase 10-D",
    "artist": "Test Artist",
    "encoding": "utf-8"
  },
  "warnings": []
}
```

投稿後に一覧で確認する。

```powershell
curl.exe "http://localhost:8787/api/charts?page=1&pageSize=10"
```

期待する確認点:

- `song.title` が `Test Song Phase 10-D` になる。
- `song.artist` が `Test Artist` になる。
- `chart.name` が `[ANOTHER]` になる。
- `versions[0].displayVersion` が `ver1.0` になる。
- `versions[0].progress` が `30` になる。
- `versions[0].file.sha256` が入る。
- `versions[0].md5` が入る。

## progress=100の確認

別の曲名または差分名で投稿する。

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10d-test.bms;type=text/plain" `
  -F "title=Completed Song Phase 10-D" `
  -F "artist=Completed Artist" `
  -F "chartName=[HYPER]" `
  -F "author=tester" `
  -F "progress=100" `
  -F "comment=completed" `
  -F "password=test-password"
```

同一ファイルのままだと `DUPLICATE_FILE` になるため、確認時はファイル本文を少し変えてから実行する。

期待する確認点:

- レスポンスの `completed` が `true`。
- レスポンスの `completedAt` が `null` ではない。
- 一覧のversionでも `completed: true` と `completedAt` が返る。

## DB確認

D1で登録内容を確認する。

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT id, title, artist FROM songs ORDER BY created_at DESC LIMIT 5;"
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT id, chart_name FROM charts ORDER BY created_at DESC LIMIT 5;"
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT id, version_number, branch_path, progress, md5, file_sha256, completed_at FROM versions ORDER BY created_at DESC LIMIT 5;"
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT action, result, error_code, file_sha256 FROM post_logs ORDER BY created_at DESC LIMIT 10;"
```

remote確認の場合は `--local` を外す。

## R2確認

DashboardまたはWranglerでR2 bucket `wip-bms-charts-files` を確認する。

期待する保存形式:

```text
charts/{chartId}/versions/root/{fileId}.{ext}
```

R2保存形式はStandardのみを想定する。

## 異常系の確認

### password未入力

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10d-test.bms;type=text/plain" `
  -F "title=Password Test" `
  -F "artist=Tester" `
  -F "chartName=[NORMAL]" `
  -F "author=tester" `
  -F "progress=10"
```

期待レスポンス:

```json
{
  "code": "PASSWORD_REQUIRED",
  "message": "管理パスワードを入力してください。",
  "detail": "password field is required."
}
```

### progress不正

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\phase10d-test.bms;type=text/plain" `
  -F "title=Progress Test" `
  -F "artist=Tester" `
  -F "chartName=[NORMAL]" `
  -F "author=tester" `
  -F "progress=101" `
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

### 拡張子不正

```powershell
"dummy" | Set-Content -Encoding UTF8 .\bad.txt
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\bad.txt;type=text/plain" `
  -F "title=Bad Extension" `
  -F "artist=Tester" `
  -F "chartName=[NORMAL]" `
  -F "author=tester" `
  -F "progress=10" `
  -F "password=test-password"
```

期待レスポンス:

```json
{
  "code": "INVALID_EXTENSION",
  "message": "投稿できないファイル形式です。",
  "detail": "Allowed extensions are .bms, .bme, .bml, and .zip. Audio files must not be uploaded."
}
```

### 重複ファイル

同じ `.bms` をもう一度投稿する。

期待レスポンス:

```json
{
  "code": "DUPLICATE_FILE",
  "message": "同じファイルは投稿できません。",
  "detail": "A version with the same file_sha256 already exists."
}
```

### 既存chartへの初回投稿

同じ曲情報、同じ `chartName` で、本文を少し変えた別ファイルを投稿する。

期待レスポンス:

```json
{
  "code": "CHART_ALREADY_EXISTS",
  "message": "同じ曲の同じ差分は既に存在します。",
  "detail": "Use POST /api/charts/:chartId/versions in a later phase to append to an existing chart."
}
```

## テストデータ削除

必要に応じてD1とR2のテストデータを削除する。

D1は外部キーがあるため、versionから順に削除する。

```sql
DELETE FROM post_logs WHERE detail LIKE '%Initial chart version created.%' OR error_code IS NOT NULL;
DELETE FROM versions WHERE title LIKE '%Phase 10-D%' OR title LIKE '%Phase10D%';
DELETE FROM charts WHERE chart_name IN ('[ANOTHER]', '[HYPER]', '[NORMAL]');
DELETE FROM songs WHERE title LIKE '%Phase 10-D%' OR title LIKE '%Phase10D%';
```

R2は `charts/{chartId}/versions/root/` 配下のテストファイルをDashboardから削除する。

## 注意

Phase 10-Dではzip内の音源拡張子検査はTODOであり、本格的なzip検査は後続Phaseで実装する。

`GET /api/files/:fileId` はまだR2実ダウンロード未実装のため、POST成功レスポンスの `downloadUrl` は設計上のURLとして扱う。
