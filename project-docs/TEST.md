# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、初回投稿、追記投稿UI、進捗マップUI、進捗サムネイル、分岐ツリー一覧表示、完成到達後の中間version折り畳み/展開表示、進捗PNGのR2保存、一覧でのprogressMapベース密度サムネイル表示とprogressImage fallback表示を確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## UI-LIST-THUMB-03 確認項目

一覧用進捗サムネイルの視認性、凡例、tooltip、情報量を確認する:

- サムネイルで棒の高さがノーツ密度を表すこと。
- サムネイルで棒の色が、そのblockを最後に塗ったlayer/投稿者を表すこと。
- 密度は色の濃淡ではなく、高さで表現されること。
- 未着手blockが薄い緑/ミントで見えること。
- 0ノーツblockでも最低高さが表示されること。
- 塗り済み0ノーツblockは未着手0ノーツblockより見分けやすいこと。
- 複数投稿者のlayerが緑、青、紫、橙、赤系の色で区別できること。
- サムネイルhoverで、進捗、作成済みblock数、参加者数が確認できること。
- サムネイルhoverで、色と投稿者/追記者の対応が確認できること。
- `progressMap.layers[].versionId` と同じchart内のversion authorが対応付けられること。
- authorが引けないlayerでは `初回` / `追記1` / `追記2` / `layer n` などのfallback表示になること。
- サムネイル下の表示が `32/81 blocks · 3 users` のように整理されていること。
- サムネイル下に `progress 40%` のような進捗率重複表示が出ないこと。
- 進捗率は進捗列のチップで分かること。
- densityScaleが現在読み込んでいる一覧内で共通になっていること。
- 極端な高密度譜面に引っ張られすぎないよう、95パーセンタイル相当のスケールになること。
- 密度の低い譜面と高い譜面を見比べたとき、棒の高さ差が出ること。
- `window.debugProgressThumbnails()` で `densityScaleSamples` が確認できること。
- progressMapがない投稿でも一覧が壊れないこと。
- 中間履歴行でもサムネイル、作者、難易度、進捗が読めること。
- 版ラベルとfrom表示が省略されず読めること。
- DL/追記投稿ボタンが壊れていないこと。

## UI-LIST-THUMB-04 確認項目

一覧のツリー線、進捗サムネイル整列、未着手領域の視認性を確認する:

- ツリー線が以前より見やすくなっていること。
- ツリー線が濃すぎて版ラベル、難易度、作者を邪魔していないこと。
- ツリー線が版列内で完結し、展開ガターや操作列に干渉しないこと。
- 上段密度バーと下段レールのX位置が一致していること。
- 先頭block、中央block、末尾blockで上段と下段のズレがないこと。
- block数が20、72、81、100以上でも上段と下段のズレがないこと。
- 横幅が変わっても上段と下段のズレがないこと。
- 未塗りblockが薄緑で視認できること。
- 未塗り領域が連続していても背景に溶けないこと。
- 未塗り0ノーツblockでも最低高さが表示されること。
- 塗り済み0ノーツblockでも色付き最低高さが表示されること。
- 低密度blockでも最低高さが表示されること。
- 曲後半の未作成領域がサムネイル上で分かること。
- 一覧表示と新規生成PNGで、未塗り色、最低高さ、上段/下段の位置関係が大きくズレないこと。
- 既存R2 PNGは自動再生成されないこと。
- 中間履歴行でもサムネイルが読めること。
- サムネイル下の `32/81 blocks · 3 users` 表示が維持されること。
- DL/追記投稿ボタンが壊れていないこと。

## UI-TREE-PROGRESS-POLISH-02 確認項目

一覧ツリー表示と進捗サムネイルの追加改善を確認する:

- 末端ノードで不要な下方向縦線が消えていること。
- 途中ノードでは必要な接続だけ残ること。
- 最後の可視子孫以降に縦線が出ないこと。
- 折り畳み状態でも末端ノードの線が下へ残らないこと。
- 分岐線と版ラベルの位置関係が自然であること。
- 分岐線の接続点が版ラベルブロックの視覚中心に合っていること。
- BASE起点マークが不自然でないこと。
- BASEには上から入る線が表示されないこと。
- 分岐線がなだらかにつながること。
- 展開/縮小ボタンと分岐線が被っていないこと。
- 左側が toggle zone / tree zone / label zone に分離されていること。
- 進捗サムネ上段が密度棒グラフに見えること。
- 進捗サムネ下段が連続進捗レールに見えること。
- 下段レールに白いブロック区切り線がないこと。
- 未着手領域が適度に見えること。
- 既存のDL/追記投稿/折り畳み/投稿フォームが壊れていないこと。

## GitHub Pagesでの確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 投稿フォームで単体 `.bms` / `.bme` / `.bml` を選択する。
3. 進捗マップが表示されることを確認する。
4. `bas3.bms` のような曲終端イベントが長い譜面では、最後のプレイノート後の空白・BGM区間も進捗対象として表示されることを確認する。
5. 進捗マップを一部塗る。
6. `進捗画像を確認` を押し、PNGプレビューが進捗マップと同じ終端まで表示されることを確認する。
7. Networkタブを開き、投稿時の `POST /api/charts` のFormDataに `progressMap` と `progressImage` が含まれることを確認する。
8. 投稿成功後、`GET /api/charts` のversionに `progressImage.url` が返ることを確認する。
9. 一覧の進捗サムネイルが、progressMapがあるversionでは密度棒グラフとして表示されることを確認する。
10. サムネイルの棒の高さが密度、棒の色が最後に塗ったlayer/投稿者を表していることを確認する。
11. サムネイル上段の密度バーと下段レールの先頭、中央、末尾blockのX位置が揃っていることを確認する。
12. 未塗り領域や0ノーツ区間が薄緑の最低高さとして見えることを確認する。
13. サムネイルにhoverし、色と投稿者/追記者の対応がtooltipで確認できることを確認する。
14. サムネイル下が `32/81 blocks · 3 users` のような表示になり、進捗率は進捗列で確認できることを確認する。
15. Consoleで `window.debugProgressThumbnails()` を実行し、`densityScaleSamples` が確認できることを確認する。
16. 一覧ツリーの末端ノードで、版ラベル中心より下に不要な縦線が残っていないことを確認する。
17. BASE行に上から入る線が出ず、子がある場合だけ下方向へ接続していることを確認する。
18. 左端の展開ボタン、ツリー線、版ラベルがそれぞれ別の領域に見えることを確認する。
19. 下段サムネイルが白いブロック区切りのない連続した進捗レールに見えることを確認する。
20. `GET /api/charts` の `measureNotes` で `firstPlayableMeasure` / `lastPlayableMeasure` と `displayFirstMeasure` / `displayLastMeasure` が分かれていることを確認する。
21. `progressImage.url` を開き、PNGが表示またはダウンロードされることを確認する。
22. progressMapがない古い投稿では、保存済みR2 PNGまたは空表示へfallbackしても一覧が壊れないことを確認する。
23. 一覧の `追記投稿` を押す。
24. 追記モードで親layerと今回layerが進捗マップに表示されることを確認する。
25. 今回追記分を塗る。
26. `進捗画像を確認` を押し、親layerと今回layerの色、未塗り領域、上段/下段の位置関係が一覧サムネイルと大きくズレないことを確認する。
27. Networkタブで `POST /api/charts/:chartId/versions` のFormDataに `progressMap` と `progressImage` が含まれることを確認する。
28. 追記成功後、`GET /api/charts` の新versionに `progressImage.url` が返ることを確認する。
29. `GET /api/progress-images/:versionId` で追記versionのPNGが返ることを確認する。
30. 一覧のprogressMap密度サムネイル、またはfallbackの保存済みR2 PNGサムネイルが表示されることを確認する。

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

PROG-04Dでは、一覧サムネイルは保存済み `progressImage.url` のPNGを優先し、画像がない・読めない場合に `progressMap` からの再描画へfallbackする。UI-LIST-THUMB-03以降は、一覧比較性を優先し、有効な `progressMap` があるversionではprogressMapベースの密度サムネイルを優先する。保存済みR2 PNGはprogressMapがない、または再描画できない場合のfallbackとして扱う。
