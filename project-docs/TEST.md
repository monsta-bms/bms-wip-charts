# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、初回投稿、追記投稿UI、進捗マップUI、進捗サムネイル、分岐ツリー一覧表示、完成到達後の中間version折り畳み/展開表示、進捗PNGのR2保存、一覧での保存済みR2 PNG優先サムネイル表示を確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## PROG-04D-FIX4 確認項目

一覧描画で保存済みR2 PNGを確実に使う確認:

- `GET /api/charts` に `progressImage.url` または `progressImageUrl` があるversionでは、DOMに `.progress-thumbnail.has-progress-image` が生成されること。
- `GET /api/charts` に `progressImage.url` または `progressImageUrl` があるversionでは、DOMに `img.progress-thumbnail-image` が生成されること。
- DevTools Consoleで `document.querySelectorAll(".progress-thumbnail.has-progress-image").length` が1以上になること。
- DevTools Consoleで `document.querySelectorAll("img.progress-thumbnail-image").length` が1以上になること。
- `img.progress-thumbnail-image` の `src` が本番Workerの `/api/progress-images/:versionId` 絶対URLになること。
- `progressImage.url` が相対URLでも `API_BASE_URL` と結合されること。
- `progressImage.url` があるversionでは、最初から `progressMap` 再描画を選ばず、まずR2 PNG用の `img` を作ること。
- Chrome DevTools Networkで `progress-images` を検索したとき、`/api/progress-images/:versionId` のリクエストが出ること。
- `/api/progress-images/:versionId` のStatusが `200` になること。
- `/api/progress-images/:versionId` のTypeが `png` になること。
- NetworkのInitiatorが `progress-thumbnail-list.js` になること。
- `img.onerror` の場合だけ `progressMap` 再描画へfallbackすること。
- `progressImage.url` がない古い投稿では、従来通り `progressMap` fallbackが使われること。
- `branch-tree-list.js` のツリー表示後でも、R2 PNG優先表示が維持されること。
- `blob:` URLは一覧サムネイルでは使われないこと。

## PROG-04D-FIX2 確認項目

一覧サムネイルでR2保存済みPNGを確実に使う確認:

- `GET /api/charts` のversionに `progressImage.url` があることを確認する。
- 一覧サムネイルでは `blob:` URLを使わないこと。
- `blob:` URLはフォーム内PNGプレビュー用途だけであり、一覧サムネイルのURLに出ないこと。
- `progressImage.url` があるversionでは、一覧DOM内に `img.progress-thumbnail-image` が実際に挿入されること。
- `img.progress-thumbnail-image` の `src` が `https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/progress-images/:versionId` 形式になること。
- Chrome DevTools Networkで `progress-images` を検索したとき、`/api/progress-images/:versionId` のリクエストが出ること。
- `/api/progress-images/:versionId` のStatusが `200` になること。
- `/api/progress-images/:versionId` のTypeが `png` になること。
- NetworkのInitiatorが `progress-thumbnail-list.js` になること。
- `progressImage.url` がある場合、console.debugに `[progress-thumbnail-image]` と最終 `src` が出ること。
- `img.onload` 時はR2 PNG表示のままになること。
- `img.onerror` 時だけ `progressMap` 再描画へfallbackすること。
- `progressImage.url` があるのに `img` を作れない場合はconsole.warnで理由が出ること。
- `progressImage.url` がない古い投稿では、従来通り `progressMap` 再描画サムネイルが表示されること。
- `progressImage.url` も `progressMap` もない投稿では、一覧全体が壊れないこと。
- 分岐ツリー表示のDOM組み替え後でも、最終DOM上でR2 PNGの `img.src` が設定されること。

## PROG-04D-FIX 確認項目

保存済みR2 PNGを確実に使う確認:

- `GET /api/charts` のversionに `progressImage.url` があることを確認する。
- `progressImage.url` があるversionでは、一覧DOM内に `img.progress-thumbnail-image` が実際に挿入されること。
- `img.progress-thumbnail-image` の `src` が `API_BASE_URL` と結合済みの絶対URLになっていること。
- Chrome DevTools Networkで `/api/progress-images/:versionId` のリクエストが出ること。
- `/api/progress-images/:versionId` のレスポンスが `200 OK` / `image/png` になること。
- PNG読み込み成功時は、最初から `progressMap` 再描画を選ばず、`img` 表示になること。
- `progressImage.url` がある場合、console.debugに `[progress-thumbnail-image]` と最終 `src` が出ること。
- `img.onerror` の場合だけ `progressMap` 再描画へfallbackすること。
- `progressImage.url` がない古い投稿では、従来通り `progressMap` 再描画サムネイルが表示されること。
- `progressImage.url` も `progressMap` もない投稿では、一覧全体が壊れないこと。

## PROG-04D 確認項目

一覧サムネイルのR2 PNG優先表示:

- `progressImage.url` があるversionでは、一覧の進捗サムネイルがR2保存済みPNGの `img` として表示されること。
- `progressImage.url` が `/api/progress-images/:versionId` の相対URLでも、GitHub Pages側で `API_BASE_URL` と結合されて表示されること。
- R2 PNG表示時も `progress xx%` 表示が維持されること。
- 画像サイズが一覧行の高さや列揃えを崩さないこと。
- 数字パス版ラベル、難易度、作者、進捗、サムネイル、コメント、操作列の位置がずれないこと。
- 中間履歴折り畳み/展開表示でもサムネイル列が崩れないこと。
- DLボタンと追記投稿ボタンが従来通り動作すること。

fallback:

- `progressImage.url` がない古い投稿では、従来通り `progressMap` から簡易サムネイルが再描画されること。
- `progressImage.url` の画像読み込みに失敗した場合、`progressMap` から再描画した簡易サムネイルへfallbackすること。
- 画像読み込み失敗時に画面全体が壊れないこと。
- `progressImage.url` も `progressMap` もない投稿では、サムネイルなしでも一覧が壊れないこと。
- 画像読み込み失敗時はconsole.warnに `[progress-thumbnail-render]` の処理段階名付きで確認できること。

## PROG-04C-C 確認項目

曲終端基準の進捗範囲:

- `bas3.bms` のように、最後のプレイノート後にもBGM/BPM/STOP/小節長イベントが残る譜面を選択する。
- 進捗マップの表示終端が最後のプレイノート小節ではなく、曲終端小節まで伸びること。
- 曲頭側の完全な空白小節は通常表示に混ざらないこと。
- BGAのみの後ろ余白では進捗対象が延びないこと。
- BGM `01` が後ろにある場合は曲終端候補として扱われること。
- BPM `03` / `08` が後ろにある場合は曲終端候補として扱われること。
- STOP `09` が後ろにある場合は曲終端候補として扱われること。
- 小節長 `02` が後ろにある場合は曲終端候補として扱われること。
- 進捗マップ下段のブロック数が曲終端基準の表示範囲に対応すること。
- progress計算が、最後のプレイノートまでではなく曲終端までのブロック数を分母にしていること。
- `progressMap.blocks` が曲終端まで作成されること。
- `progressMap.firstMeasure` / `progressMap.lastMeasure` が表示範囲を示すこと。
- Worker保存後の `measureNotes.schemaVersion` が `2` であること。
- Worker保存後の `measureNotes.firstPlayableMeasure` / `lastPlayableMeasure` がプレイノート範囲を示すこと。
- Worker保存後の `measureNotes.displayFirstMeasure` / `displayLastMeasure` が表示・進捗対象範囲を示すこと。
- `targetMeasureCount` が `displayFirstMeasure` から `displayLastMeasure` までの小節数になること。
- 生成した進捗PNGが、進捗マップと同じ曲終端まで表示されること。
- 一覧サムネイルが、保存された `progressMap.blocks` に従って曲終端まで表示されること。
- 追記投稿フォームでは、親versionの曲終端基準 `progressMap.blocks` を引き継ぐこと。
- 既存投稿済みデータや既存PNGは自動再生成されないこと。
- `bas3.bms` は確認用ファイルとして使い、リポジトリへ恒久追加しないこと。

## PROG-04C-B 確認項目

進捗PNG送信:

- 初回投稿時に `FormData` へ `progressImage` が添付されること。
- 追記投稿時に `FormData` へ `progressImage` が添付されること。
- `progressImage` のMIMEが `image/png` であること。
- filenameが `progress.png` であること。
- 既存の `progressMap` 送信が維持されていること。
- 進捗PNG生成に失敗した場合でも、投稿自体は `progressImage` なしで継続し、console.warnで原因を確認できること。

Worker / R2 / D1:

- Worker側で `progressImage` が検証されること。
- `image/png` 以外では `INVALID_PROGRESS_IMAGE` が返ること。
- 空ファイルでは `INVALID_PROGRESS_IMAGE` が返ること。
- 1MB超過では `PROGRESS_IMAGE_TOO_LARGE` が返ること。
- 正常なPNGはR2へ `charts/{chartId}/versions/{versionId}/progress/progress.png` 形式で保存されること。
- `versions.progress_image_key` が保存されること。
- `versions.progress_image_mime` が `image/png` で保存されること。
- `versions.progress_image_size` が保存されること。
- `versions.progress_image_sha256` が保存されること。
- `versions.progress_image_created_at` が保存されること。
- `post_logs.detail` に `progressImageUploaded=true` とkey/size/sha256が追記されること。
- `progressImage` が未送信の投稿でも従来通り成功すること。

GET API:

- `GET /api/charts` のversionに `progressImage` objectが返ること。
- `progressImage.url` が `/api/progress-images/:versionId` 形式であること。
- 進捗画像がないversionでは `progressImage: null` になること。
- `GET /api/progress-images/:versionId` でPNG本体が返ること。
- 取得レスポンスの `Content-Type` が `image/png` であること。
- 取得レスポンスに短めの `Cache-Control` が付くこと。
- `progress_image_key` がないversionでは `PROGRESS_IMAGE_NOT_FOUND` が返ること。
- versionまたはchartが非表示の場合は `PROGRESS_IMAGE_UNAVAILABLE` が返ること。
- D1 metadataはあるがR2 objectがない場合は `PROGRESS_IMAGE_R2_NOT_FOUND` が返ること。
- 譜面ファイル本体の `downloadBlocked=true` や将来の `file_deleted_at` は進捗画像表示を妨げないこと。

既存機能回帰:

- 初回投稿フォームが従来通り表示されること。
- 初回投稿が従来通り `POST /api/charts` へ送信されること。
- 追記投稿フォームが従来通り表示されること。
- 追記投稿が従来通り `POST /api/charts/:chartId/versions` へ送信されること。
- BMSメタデータ自動読取が壊れていないこと。
- 想定難易度UIが壊れていないこと。
- 進捗マップ編集が壊れていないこと。
- 完成版にするボタンが壊れていないこと。
- 没譜面ON時の `progress=100` 固定が壊れていないこと。
- `progressMap` 保存が壊れていないこと。
- 一覧の既存 `progressMap` サムネイル表示が壊れていないこと。
- DLリンクが壊れていないこと。
- 中間履歴折り畳み/展開が壊れていないこと。
- 数字パス方式の版ラベルが維持されていること。

## GitHub Pagesでの確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 投稿フォームで単体 `.bms` / `.bme` / `.bml` を選択する。
3. 進捗マップが表示されることを確認する。
4. `bas3.bms` のような曲終端イベントが長い譜面では、最後のプレイノート後の空白・BGM区間も進捗対象として表示されることを確認する。
5. 進捗マップを一部塗る。
6. `進捗画像を確認` を押し、PNGプレビューが進捗マップと同じ終端まで表示されることを確認する。
7. Networkタブを開き、投稿時の `POST /api/charts` のFormDataに `progressMap` と `progressImage` が含まれることを確認する。
8. 投稿成功後、`GET /api/charts` のversionに `progressImage.url` が返ることを確認する。
9. 一覧の進捗サムネイルが `progressImage.url` のPNG画像として表示されることを確認する。
10. Networkタブで `/api/progress-images/:versionId` が取得されていることを確認する。
11. Elementsタブで一覧サムネイルに `img.progress-thumbnail-image` が挿入され、`src` が本番Workerの絶対URLになっていることを確認する。
12. Consoleで `[progress-thumbnail-image]` のdebug出力に最終 `src` が出ることを確認する。
13. Networkタブで、一覧サムネイルのPNGが `blob:` ではなく `/api/progress-images/:versionId` から取得されていることを確認する。
14. `GET /api/charts` の `measureNotes` で `firstPlayableMeasure` / `lastPlayableMeasure` と `displayFirstMeasure` / `displayLastMeasure` が分かれていることを確認する。
15. `progressImage.url` を開き、PNGが表示またはダウンロードされることを確認する。
16. 画像URLを一時的にブロックする、またはテストデータで存在しないURLにして、progressMap簡易サムネイルへfallbackすることを確認する。
17. 一覧の `追記投稿` を押す。
18. 追記モードで親layerと今回layerが進捗マップに表示されることを確認する。
19. 今回追記分を塗る。
20. `進捗画像を確認` を押し、親layerと今回layerの色がPNGで見分けられることを確認する。
21. Networkタブで `POST /api/charts/:chartId/versions` のFormDataに `progressMap` と `progressImage` が含まれることを確認する。
22. 追記成功後、`GET /api/charts` の新versionに `progressImage.url` が返ることを確認する。
23. `GET /api/progress-images/:versionId` で追記versionのPNGが返ることを確認する。
24. 一覧の保存済みR2 PNGサムネイル、またはfallbackのprogressMapサムネイルが表示されることを確認する。

## curl確認例

進捗画像取得:

```powershell
curl.exe -i "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/progress-images/version_xxx"
```

期待:

- `HTTP/1.1 200 OK`
- `Content-Type: image/png`
- PNGバイナリが返る。

画像なしversion:

```powershell
curl.exe -i "https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/progress-images/version_without_image"
```

期待:

```json
{
  "code": "PROGRESS_IMAGE_NOT_FOUND",
  "message": "進捗画像が見つかりません。",
  "detail": "..."
}
```

## ローカル確認

Worker:

```bash
cd worker
npm install
npx wrangler dev
```

静的ファイル:

```bash
cd docs
python -m http.server 8000
```

ローカル静的ページからローカルWorkerへ接続したい場合は、`docs/app.js` の `API_BASE_URL` を一時的に `http://localhost:8787` へ変えるか、ブラウザコンソール/ローカル差分で確認する。CORS用に `ALLOWED_ORIGINS` へローカルOriginも含める。

## 注意

同じ譜面ファイルを再投稿すると `DUPLICATE_FILE` になる。再テスト時はファイル内容を少し変更するか、テスト用D1/R2を初期化する。

PROG-04Dでは、一覧サムネイルは保存済み `progressImage.url` のPNGを優先し、画像がない・読めない場合に `progressMap` からの再描画へfallbackする。
