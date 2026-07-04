# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、D1 migration、BMS解析、進捗マップUI、進捗マップ保存、追記投稿API、仕様ドキュメントを確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## 今回確認するもの

BRANCH-01A 追記投稿API:

- `POST /api/charts/:chartId/versions` が `multipart/form-data` を受け付けること
- `POST /api/charts/:chartId/versions` が `worker/src/routes/chartVersions.ts` の本実装へ到達すること
- Phase 9 stubの `mode=stub` や `Version append is accepted only as a Phase 9 stub` が返らないこと
- 必須項目 `file`, `parentVersionId`, `author`, `progressMap`, `password` が不足した場合に `INVALID_FORM` を返すこと
- 任意項目 `difficulty`, `level`, `comment` が送信できること
- `difficulty` / `level` 未送信時は親versionの値を継承すること
- `isRejected=true` を送ると `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` を返すこと
- 親versionが `is_rejected=1` の場合は `REJECTED_CHART_CANNOT_BE_EXTENDED` を返すこと
- 存在しないchartは `CHART_NOT_FOUND` を返すこと
- 存在しない親versionは `PARENT_VERSION_NOT_FOUND` を返すこと
- 親versionが指定chartに属していない場合は `PARENT_VERSION_CHART_MISMATCH` を返すこと
- 非表示の親versionは追記できないこと
- 単体BMSの `#TITLE` / `#ARTIST` が追記先songと一致しない場合は `TITLE_ARTIST_MISMATCH` を返すこと
- 同一 `file_sha256` は `DUPLICATE_FILE` で拒否されること
- 許可拡張子 `.bms`, `.bme`, `.bml`, `.zip` 以外は拒否されること
- 単体譜面2MB超過、zip5MB超過が拒否されること
- `progressMap` が不正JSONの場合は `INVALID_PROGRESS_MAP` を返すこと
- `progressMap.schemaVersion` が `2` 以外なら `INVALID_PROGRESS_MAP` を返すこと
- `progressMap.blockMode` が `standardized_measure` 以外なら `INVALID_PROGRESS_MAP` を返すこと
- `progressMap.blocks.length` と `targetBlockCount` が一致しない場合は `PROGRESS_MAP_BLOCK_COUNT_MISMATCH` を返すこと
- `progressMap.layers[].ranges` が範囲外の場合は `PROGRESS_MAP_OUT_OF_RANGE` を返すこと
- 親versionの塗り範囲unionと同じ場合は `PROGRESS_MAP_UNCHANGED` を返すこと
- Worker側で `progressMap` のunionから `progress` が再計算されること
- 成功時に `versions.progress_map_json` へ正規化済みJSONが保存されること
- 追記時に既存layersが維持され、最後のlayerの `versionId` が新しいversion IDへ置き換わること
- 成功時に `song / chart / parent / version / file` の関連が壊れないこと
- 成功時にR2へ安全な `r2_key` でファイルが保存されること
- D1登録失敗時はR2孤児ファイル削除を試みること
- 成功/失敗ともに可能な範囲で `post_logs.action='append_version'` が記録されること
- `console.error` に処理段階名が含まれること
- APIエラーが必ず `code`, `message`, `detail` のJSONになること

BRANCH-01A-CHECK スクリプト確認:

- 初回投稿済みchartに対して `scripts/test-append-version.ps1` で追記投稿できること
- スクリプトが `ApiBaseUrl`, `ChartId`, `ParentVersionId`, `FilePath` を引数で受け取れること
- `ApiBaseUrl` を省略した場合に `http://localhost:8787` が使われること
- スクリプトが `GET /api/charts` から親versionの `progressMap` を取得すること
- 親versionの `progressMap` を複製し、未塗りブロックを少なくとも1つ追加して送信すること
- 追加できる未塗りブロックが無い場合、分かりやすいエラーを表示すること
- `progressMap` は `ConvertTo-Json -Depth 50 -Compress` でJSON文字列化されること
- 送信前に `progressMapJson | ConvertFrom-Json` でvalid JSON確認が行われること
- `progressMap.layers` は1件だけでもJSON配列として出力されること
- `progressMap.layers[0].ranges` は1件だけでも配列の配列として出力されること
- PowerShellでは単一要素配列が潰れやすいため、JSON化後に `layers` / `ranges` を再検証してからPOSTすること
- JSON化後の `layers` / `ranges` 検証に失敗した場合、POSTせず原因が分かるエラーで停止すること
- 送信前に `progressMapJson` の先頭200文字が表示され、`{"schemaVersion"` のようなJSON形式になっていること
- 送信前に `progressMapJson layers array: True; layers count: ...; first ranges array: True; first range length: 2` のような配列検証結果が表示されること
- 必要に応じて `-WriteDebugProgressMap` を付けると `scripts/debug-progressMap.json` に確認用JSONを出力できること
- PowerShellオブジェクト表記の `@{schemaVersion=2; ...}` はJSONではないため送信しないこと
- スクリプトはPowerShellの `MultipartFormDataContent` ではなく `curl.exe -F` でmultipart送信すること
- 長いJSONフォーム値は一時JSONファイルに保存し、`curl.exe -F "progressMap=<file;type=application/json"` でフォーム項目として送ること
- `progressMap` はファイルアップロードではなくJSON本文のフォーム項目なので、`@` ではなく `<` を使うこと
- `Content-Disposition header in FormData part is missing a name` が出る場合は、確認スクリプトのmultipart生成方式を疑うこと
- `INVALID_PROGRESS_MAP` が出る場合は、送信前の `progressMapJson preview` と一時JSONの生成処理を確認すること
- `INVALID_PROGRESS_MAP` かつ `progressMap.layers must be an array` が出る場合は、`layers` が `[{...}]` ではなく `{...}` に潰れていないか確認すること
- 成功時にレスポンスJSON全文が整形表示されること
- 成功時に `versionId`, `branchPath`, `progress` が返っていれば表示されること
- 成功レスポンスに `versionId`, `branchPath`, `progress` が無い場合でも `<not returned>` と表示し、スクリプト自体は失敗扱いにしないこと
- レスポンスに `mode="stub"` が含まれる場合は `API returned stub response. Deploy or route implementation is not active.` と表示し、スクリプトを失敗扱いにすること
- 失敗時に `code`, `message`, `detail` が表示されること
- `branchPath` が `root/a` などで返ること
- `GET /api/charts` で新versionが増えていること
- 実際の成功確認は `GET /api/charts` で対象chartの `versions` が増えたか確認すること
- 同じ親versionへもう一度追記すると `root/b` になること
- 親とprogressMapが同一の場合は `PROGRESS_MAP_UNCHANGED` になること
- Windows PowerShell 5.1ではスクリプト内メッセージをASCII英語にして文字化けを避けること
- `ConvertFrom-Json` 由来の `progressMap.layers` / `ranges` は固定サイズ配列になる場合があるため、`.Add()` で直接追加せず、配列再代入または `ArrayList` / `List` 変換で加工すること

分岐生成:

- 親 `root` への1件目の追記が `branch_path=root/a` になること
- 親 `root` への2件目の追記が `branch_path=root/b` になること
- 親 `root/a` への1件目の追記が `branch_path=root/a/a` になること
- `version_number` が `parent.version_number + 1` になること
- `displayVersion` がAPI側で生成されること
- 同時投稿などで `branch_path` が競合した場合はDB unique制約で失敗し、`BRANCH_CREATE_FAILED` になること

progress=100到達時のDL制御:

- 新しく作成された `progress=100` version自体はDL可能なこと
- 同一分岐上の祖先のうち `progress BETWEEN 1 AND 99` のversionだけが `download_blocked=1` になること
- DL不可化された祖先に `download_block_reason='superseded_by_completed_descendant'` が保存されること
- DL不可化された祖先に `download_blocked_at` が保存されること
- DL不可化された祖先に `collapsed_by_completion=1` が保存されること
- DL不可化された祖先に `collapsed_reason='superseded_by_completed_descendant'` が保存されること
- DL不可化された祖先に `collapsed_by_version_id=<完成version id>` が保存されること
- `progress=100` の祖先versionはDL不可化されないこと
- 他分岐のversionはDL不可化されないこと
- D1行やR2ファイルが物理削除されないこと

既存機能回帰:

- `GET /api/health` が `status=ok` を返すこと
- `GET /api/charts` が既存通り `song -> chart -> versions` を返すこと
- `POST /api/charts` 初回投稿が既存通り動くこと
- 初回投稿時の `progressMap` 保存が壊れていないこと
- Worker側BMS解析が壊れていないこと
- `GET /api/files/:fileId` が既存通りDL可否を判定すること
- GitHub Pages の初回投稿フォームが壊れていないこと
- 一覧の `progressMap` サムネイルが壊れていないこと
- 想定難易度UIが壊れていないこと
- 没譜面ON時の `progress=100` 強制が壊れていないこと

## 今回確認しないもの

- 追記投稿UI
- 進捗画像PNGのR2保存
- ZIP内部のBMS解析
- 取り下げAPI
- 削除申請API
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理
- Turnstile
- 完成到達後の一覧折り畳みUI
- お気に入り★
- 本格的な譜面ミニビュー

## テスト用BMSファイル

PowerShellで基本確認用ファイルを作成する。

初回投稿用:

```powershell
@"
#PLAYER 1
#TITLE Branch Test
#ARTIST Test Artist
#BPM 120
#00111:0102
#00211:0000
#00311:01000002
"@ | Set-Content -Encoding UTF8 .\branch-parent.bms
```

追記投稿用:

```powershell
@"
#PLAYER 1
#TITLE Branch Test
#ARTIST Test Artist
#BPM 120
#00111:0102
#00211:0101
#00311:01000002
"@ | Set-Content -Encoding UTF8 .\branch-append.bms
```

タイトル不一致確認用:

```powershell
@"
#PLAYER 1
#TITLE Other Song
#ARTIST Other Artist
#BPM 120
#00111:0102
"@ | Set-Content -Encoding UTF8 .\branch-mismatch.bms
```

## ローカルWorker確認

ローカルWorkerを起動する。

```bash
cd worker
npx wrangler dev
```

前提として、ローカルD1にmigrationが適用済みで、`HASH_SECRET` が設定されていることを確認する。

```bash
npx wrangler d1 migrations apply wip-bms-charts-db --local
npx wrangler secret put HASH_SECRET
```

## 初回投稿で親versionを作る

```powershell
$initialMap = '{"schemaVersion":2,"blockMode":"standardized_measure","firstMeasure":1,"lastMeasure":3,"targetBlockCount":3,"blocks":[{"index":0,"startMeasure":1,"endMeasure":1,"startTimeSec":0,"endTimeSec":1,"playNotes":2},{"index":1,"startMeasure":2,"endMeasure":2,"startTimeSec":1,"endTimeSec":2,"playNotes":0},{"index":2,"startMeasure":3,"endMeasure":3,"startTimeSec":2,"endTimeSec":3,"playNotes":2}],"layers":[{"versionId":"pending","color":"#1f7a5c","kind":"initial","ranges":[[0,0]]}],"progress":33}'

curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\branch-parent.bms;type=text/plain" `
  -F "title=Branch Test" `
  -F "subtitle=" `
  -F "artist=Test Artist" `
  -F "subartist=" `
  -F "chartName=BRANCH-01A Parent" `
  -F "difficulty=★12" `
  -F "level=12" `
  -F "author=parent-author" `
  -F "progress=0" `
  -F "progressMap=$initialMap" `
  -F "comment=parent" `
  -F "isRejected=false" `
  -F "password=test-password"
```

期待:

- HTTP 201
- `chartId`, `versionId`, `fileId` が返る
- `progress=33`
- `progressMap.layers[0].versionId` が実version IDになる

返った `chartId` と `versionId` を以降の `$chartId`, `$parentVersionId` に使う。

## 追記投稿スクリプト確認

長いcurlを手打ちせず、`scripts/test-append-version.ps1` を使って追記投稿を確認する。

ローカル確認例:

```powershell
.\scripts\test-append-version.ps1 `
  -ChartId $chartId `
  -ParentVersionId $parentVersionId `
  -FilePath .\branch-append.bms `
  -Author append-author `
  -Password test-password
```

Windows PowerShell 5.1確認例:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-append-version.ps1 `
  -ApiBaseUrl "http://localhost:8787" `
  -ChartId "chart_xxx" `
  -ParentVersionId "version_xxx" `
  -FilePath ".\branch-append.bms" `
  -Author "append-author" `
  -Password "test-password"
```

期待:

- `API_BASE_URL: http://localhost:8787` が表示される
- 親versionの `progressMap` から未塗りブロックが1つ追加される
- `progressMapJson preview:` にJSON先頭200文字が表示される
- previewが `{` で始まり、`"schemaVersion"` のようにキーがダブルクォート付きである
- `progressMapJson layers array: True; layers count: ...; first ranges array: True; first range length: 2` が表示される
- JSON化後の `layers` が配列でない場合、POSTせずにスクリプトが停止する
- JSON化後の `ranges` が配列の配列でない場合、POSTせずにスクリプトが停止する
- スクリプトが `curl.exe -F` でmultipart送信する
- `progressMap` は一時JSONファイルから `-F "progressMap=<temp.json;type=application/json"` で送信される
- 必要に応じて `-WriteDebugProgressMap` 付きで実行し、`scripts/debug-progressMap.json` の `layers` が `[{...}]`、`ranges` が `[[0,0]]` になっていることを確認できる
- HTTP 201で成功する
- 成功レスポンスJSON全文が表示される
- `versionId`, `branchPath`, `progress` が返っていれば表示される
- 返っていない項目は `<not returned>` と表示され、スクリプト自体は成功終了する
- `mode=stub` が返った場合はスクリプトが失敗終了し、デプロイまたはルーティングが有効でないことが分かる
- `Content-Disposition header in FormData part is missing a name` が出る場合は、PowerShell側のmultipart生成方式を疑う
- `INVALID_PROGRESS_MAP` が出る場合は、`progressMapJson preview` が `@{...}` ではなくJSON形式になっているか確認する
- `progressMap.layers must be an array` が出る場合は、`progressMapJson layers array` の表示とデバッグJSONを確認する
- 1回目の `branchPath` が `root/a` 相当になるかは、レスポンスまたは `GET /api/charts` で確認する
- Windows PowerShell 5.1でもスクリプト内メッセージが文字化けせず、ParserErrorにならない

本番確認例:

```powershell
.\scripts\test-append-version.ps1 `
  -ApiBaseUrl "https://bms-wip-charts-worker.monsta3228gsl.workers.dev" `
  -ChartId $chartId `
  -ParentVersionId $parentVersionId `
  -FilePath .\branch-append.bms `
  -Author append-author `
  -Comment "production append test" `
  -Password "your-password"
```

期待:

- 本番Workerへmultipart投稿される
- 成功時にレスポンスJSON全文が表示される
- `versionId`, `branchPath`, `progress` が返っていれば表示される
- 返っていない項目は `<not returned>` と表示される
- `mode=stub` が返った場合は失敗扱いになり、`API returned stub response. Deploy or route implementation is not active.` と表示される
- 失敗時に `code`, `message`, `detail` が表示される

同じ親versionへ2回目の追記確認:

```powershell
.\scripts\test-append-version.ps1 `
  -ChartId $chartId `
  -ParentVersionId $parentVersionId `
  -FilePath .\branch-append.bms `
  -Author append-author-2 `
  -Password test-password
```

期待:

- 別内容のファイルを使った場合、2回目の `branchPath` が `root/b` 相当になる
- 同じファイル内容を使った場合は、既存仕様通り `DUPLICATE_FILE` になる

GET確認:

```powershell
curl.exe "http://localhost:8787/api/charts?page=1&pageSize=200"
```

期待:

- 追記投稿後に対象chartの `versions` が増えている
- 新versionの `parentVersionId` が指定した親version IDになっている
- 新versionの `branchPath` が `root/a` や `root/b` になっている
- 新versionの `progressMap` が返る

## 追記投稿の正常系curl例

スクリプトを使わずに直接確認したい場合の例。

```powershell
$chartId = "chart_xxx"
$parentVersionId = "version_parent"
$appendMapObject = '{"schemaVersion":2,"blockMode":"standardized_measure","firstMeasure":1,"lastMeasure":3,"targetBlockCount":3,"blocks":[{"index":0,"startMeasure":1,"endMeasure":1,"startTimeSec":0,"endTimeSec":1,"playNotes":2},{"index":1,"startMeasure":2,"endMeasure":2,"startTimeSec":1,"endTimeSec":2,"playNotes":2},{"index":2,"startMeasure":3,"endMeasure":3,"startTimeSec":2,"endTimeSec":3,"playNotes":2}],"layers":[{"versionId":"version_parent","color":"#1f7a5c","kind":"initial","ranges":[[0,0]]},{"versionId":"pending","color":"#2563eb","kind":"followup","ranges":[[1,1]]}],"progress":67}' | ConvertFrom-Json
$appendMap = $appendMapObject | ConvertTo-Json -Depth 50 -Compress
$appendMap | ConvertFrom-Json | Out-Null
$tempProgressMap = Join-Path $env:TEMP "append-progress-map.json"
[System.IO.File]::WriteAllText($tempProgressMap, $appendMap, [System.Text.UTF8Encoding]::new($false))

curl.exe -sS -w "`nHTTP_STATUS:%{http_code}" -X POST "http://localhost:8787/api/charts/$chartId/versions" `
  -F "file=@.\branch-append.bms;type=application/octet-stream" `
  -F "parentVersionId=$parentVersionId" `
  -F "difficulty=★12" `
  -F "level=12" `
  -F "author=append-author" `
  -F "progressMap=<$tempProgressMap;type=application/json" `
  -F "comment=append test" `
  -F "password=test-password"
```

期待:

- HTTP 201
- `displayVersion` が `ver2.0-a` 相当になる
- `branchPath` が `root/a` 相当になる
- `progress=67`
- `progressMap.layers` が2件ある
- 最後のlayerの `versionId` が新しい `versionId` になっている
- `file.downloadUrl` が `/api/files/<fileId>` になる
- `analysis.playNotes` が返る

## 2本目分岐の確認

同じ `$parentVersionId` に、別内容のBMSファイルを使ってもう一度追記する。

期待:

- `branchPath` が `root/b` 相当になる
- 1本目の `root/a` が壊れない
- `GET /api/charts` で両方のbranchが返る

## 入れ子分岐の確認

1本目追記の `versionId` を `$nestedParentVersionId` として、さらに追記する。

期待:

- `version_number` が親+1になる
- `branchPath` が `root/a/a` 相当になる
- `displayVersion` が分岐suffix付きになる

## progress=100完成追記の確認

```powershell
$completeMap = '{"schemaVersion":2,"blockMode":"standardized_measure","firstMeasure":1,"lastMeasure":3,"targetBlockCount":3,"blocks":[{"index":0,"startMeasure":1,"endMeasure":1,"startTimeSec":0,"endTimeSec":1,"playNotes":2},{"index":1,"startMeasure":2,"endMeasure":2,"startTimeSec":1,"endTimeSec":2,"playNotes":2},{"index":2,"startMeasure":3,"endMeasure":3,"startTimeSec":2,"endTimeSec":3,"playNotes":2}],"layers":[{"versionId":"version_parent","color":"#1f7a5c","kind":"initial","ranges":[[0,0]]},{"versionId":"pending","color":"#2563eb","kind":"completion_fill","ranges":[[1,2]]}],"progress":100}'

curl.exe -X POST "http://localhost:8787/api/charts/$chartId/versions" `
  -F "file=@.\branch-append.bms;type=text/plain" `
  -F "parentVersionId=$parentVersionId" `
  -F "author=complete-author" `
  -F "progressMap=$completeMap" `
  -F "comment=complete append" `
  -F "password=test-password"
```

期待:

- HTTP 201
- 新versionの `progress=100`
- 新version自体は `download_blocked=0`
- 同一分岐上の `progress BETWEEN 1 AND 99` の祖先だけが `download_blocked=1` になる
- 祖先の `download_block_reason='superseded_by_completed_descendant'`
- 祖先の `collapsed_by_completion=1`
- 他分岐のversionは変更されない
- `GET /api/files/<完成versionのfileId>` はDL可能
- `GET /api/files/<DL不可化された祖先fileId>` は `FILE_DOWNLOAD_BLOCKED` を返す

## エラー系確認

progressMapなし:

```powershell
curl.exe -X POST "http://localhost:8787/api/charts/$chartId/versions" `
  -F "file=@.\branch-append.bms;type=text/plain" `
  -F "parentVersionId=$parentVersionId" `
  -F "author=append-author" `
  -F "password=test-password"
```

期待:

- HTTP 400
- `code=INVALID_FORM` または `INVALID_PROGRESS_MAP`
- `detail` に不足項目またはprogressMap必須の理由が入る

`isRejected=true`:

```powershell
curl.exe -X POST "http://localhost:8787/api/charts/$chartId/versions" `
  -F "file=@.\branch-append.bms;type=text/plain" `
  -F "parentVersionId=$parentVersionId" `
  -F "author=append-author" `
  -F "progressMap=$appendMap" `
  -F "isRejected=true" `
  -F "password=test-password"
```

期待:

- HTTP 400
- `code=INVALID_REJECTED_FLAG_FOR_FOLLOWUP`

タイトル/アーティスト不一致:

```powershell
curl.exe -X POST "http://localhost:8787/api/charts/$chartId/versions" `
  -F "file=@.\branch-mismatch.bms;type=text/plain" `
  -F "parentVersionId=$parentVersionId" `
  -F "author=append-author" `
  -F "progressMap=$appendMap" `
  -F "password=test-password"
```

期待:

- HTTP 409
- `code=TITLE_ARTIST_MISMATCH`

親と同じ塗り範囲:

```powershell
$sameMap = '{"schemaVersion":2,"blockMode":"standardized_measure","firstMeasure":1,"lastMeasure":3,"targetBlockCount":3,"blocks":[{"index":0,"startMeasure":1,"endMeasure":1,"startTimeSec":0,"endTimeSec":1,"playNotes":2},{"index":1,"startMeasure":2,"endMeasure":2,"startTimeSec":1,"endTimeSec":2,"playNotes":0},{"index":2,"startMeasure":3,"endMeasure":3,"startTimeSec":2,"endTimeSec":3,"playNotes":2}],"layers":[{"versionId":"version_parent","color":"#1f7a5c","kind":"initial","ranges":[[0,0]]}],"progress":33}'

curl.exe -X POST "http://localhost:8787/api/charts/$chartId/versions" `
  -F "file=@.\branch-append.bms;type=text/plain" `
  -F "parentVersionId=$parentVersionId" `
  -F "author=append-author" `
  -F "progressMap=$sameMap" `
  -F "password=test-password"
```

期待:

- HTTP 409
- `code=PROGRESS_MAP_UNCHANGED`

## GitHub Pagesでの確認

BRANCH-01Aでは追記投稿UIはまだ実装しない。

GitHub Pagesでは以下だけ確認する。

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 初回投稿フォームが従来通り表示される。
3. 初回投稿が従来通り成功する。
4. 一覧取得が従来通り成功する。
5. 追記投稿ボタンが表示されていても、まだ追記UIとしては動作対象外である。
6. 追記API実装により、初回投稿フォームや一覧サムネイルが壊れていない。

## 本番Worker確認

本番へdeploy後に、ローカル確認と同じcurlまたは `scripts/test-append-version.ps1` を本番URLへ向けて実行する。

```powershell
.\scripts\test-append-version.ps1 `
  -ApiBaseUrl "https://bms-wip-charts-worker.monsta3228gsl.workers.dev" `
  -ChartId $chartId `
  -ParentVersionId $parentVersionId `
  -FilePath .\branch-append.bms `
  -Author append-author `
  -Comment "production append test" `
  -Password "your-password"
```

期待:

- CORS設定が既存のGitHub Pages Originを壊していない
- HTTP 201
- 成功レスポンスJSON全文が表示される
- `versionId`, `branchPath`, `progress` が無いレスポンスでもスクリプト自体は成功終了する
- `mode=stub` が返った場合はスクリプトが失敗し、Worker本体のdeployまたはroute実装が有効でないことを判断できる
- `GET /api/charts` で追記versionが表示される
- `GET /api/files/:fileId` で新versionのファイルを取得できる

## 注意

同じファイルを再投稿すると `DUPLICATE_FILE` になる。再テスト時はファイル内容を少し変更するか、ローカルD1/R2を初期化する。