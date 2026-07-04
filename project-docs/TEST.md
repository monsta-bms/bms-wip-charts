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
- スクリプトが `API_BASE_URL`, `chartId`, `parentVersionId`, `filePath` を引数で受け取れること
- `API_BASE_URL` を省略した場合に `http://localhost:8787` が使われること
- スクリプトが `GET /api/charts` から親versionの `progressMap` を取得すること
- 親versionの `progressMap` を複製し、未塗りブロックを少なくとも1つ追加して送信すること
- 追加できる未塗りブロックが無い場合、分かりやすいエラーを表示すること
- 成功時に `versionId`, `branchPath`, `progress` が表示されること
- 失敗時に `code`, `message`, `detail` が表示されること
- `branchPath` が `root/a` などで返ること
- `GET /api/charts` で新versionが増えていること
- 同じ親versionへもう一度追記すると `root/b` になること
- 親とprogressMapが同一の場合は `PROGRESS_MAP_UNCHANGED` になること

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
  -chartId $chartId `
  -parentVersionId $parentVersionId `
  -filePath .\branch-append.bms `
  -author append-author `
  -password test-password
```

期待:

- `API_BASE_URL: http://localhost:8787` が表示される
- 親versionの `progressMap` から未塗りブロックが1つ追加される
- HTTP 201で成功する
- `versionId`, `branchPath`, `progress` が表示される
- 1回目の `branchPath` が `root/a` 相当になる

本番確認例:

```powershell
.\scripts\test-append-version.ps1 `
  -API_BASE_URL "https://bms-wip-charts-worker.monsta3228gsl.workers.dev" `
  -chartId $chartId `
  -parentVersionId $parentVersionId `
  -filePath .\branch-append.bms `
  -author append-author `
  -comment "production append test" `
  -password "your-password"
```

期待:

- 本番Workerへmultipart投稿される
- 成功時に `versionId`, `branchPath`, `progress` が表示される
- 失敗時に `code`, `message`, `detail` が表示される

同じ親versionへ2回目の追記確認:

```powershell
.\scripts\test-append-version.ps1 `
  -chartId $chartId `
  -parentVersionId $parentVersionId `
  -filePath .\branch-append.bms `
  -author append-author-2 `
  -password test-password
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
$appendMap = '{"schemaVersion":2,"blockMode":"standardized_measure","firstMeasure":1,"lastMeasure":3,"targetBlockCount":3,"blocks":[{"index":0,"startMeasure":1,"endMeasure":1,"startTimeSec":0,"endTimeSec":1,"playNotes":2},{"index":1,"startMeasure":2,"endMeasure":2,"startTimeSec":1,"endTimeSec":2,"playNotes":2},{"index":2,"startMeasure":3,"endMeasure":3,"startTimeSec":2,"endTimeSec":3,"playNotes":2}],"layers":[{"versionId":"version_parent","color":"#1f7a5c","kind":"initial","ranges":[[0,0]]},{"versionId":"pending","color":"#2563eb","kind":"followup","ranges":[[1,1]]}],"progress":67}'

curl.exe -X POST "http://localhost:8787/api/charts/$chartId/versions" `
  -F "file=@.\branch-append.bms;type=text/plain" `
  -F "parentVersionId=$parentVersionId" `
  -F "difficulty=★12" `
  -F "level=12" `
  -F "author=append-author" `
  -F "progressMap=$appendMap" `
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
  -API_BASE_URL "https://bms-wip-charts-worker.monsta3228gsl.workers.dev" `
  -chartId $chartId `
  -parentVersionId $parentVersionId `
  -filePath .\branch-append.bms `
  -author append-author `
  -comment "production append test" `
  -password "your-password"
```

期待:

- CORS設定が既存のGitHub Pages Originを壊していない
- HTTP 201
- `branchPath`, `progress`, `progressMap`, `file.downloadUrl` が返る
- `GET /api/charts` で追記versionが表示される
- `GET /api/files/:fileId` で新versionのファイルを取得できる

## 注意

同じファイルを再投稿すると `DUPLICATE_FILE` になる。再テスト時はファイル内容を少し変更するか、ローカルD1/R2を初期化する。