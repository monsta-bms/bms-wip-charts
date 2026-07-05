# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、初回投稿、追記投稿UI、進捗マップUI、進捗サムネイル、分岐ツリー一覧表示を確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## 今回確認するもの

BRANCH-01C 分岐ツリー一覧表示:

- chartカード見出しに曲名・アーティストが表示されること
- version行では曲名・アーティスト・サブタイトル・サブアーティストが重複表示されないこと
- root versionがツリーの起点として表示されること
- `root/a` が `root` の子として表示されること
- `root/b` が `root` から分かれた別分岐として表示されること
- `root/a/a` が `root/a` の子として表示されること
- `branchPath` に応じてversion行がインデントされること
- 薄いツリー線またはコネクタで親子関係が分かること
- 同じ親からの分岐が並んで見えること
- 表示順が `root`, `root/a`, `root/a/a`, `root/b` のような自然なツリー順になること
- 各version行に `displayVersion`, `branchPath`, `author`, `progress`, `difficulty`, progressMapサムネイル, DL, 追記投稿が表示されること
- progressMapサムネイルがツリー表示でも崩れないこと
- `progress=100` または `completed=true` のversionが完成バッジや薄い緑背景で分かりやすく表示されること
- `progress=100` のversion自体では、`downloadBlocked` でない限りDLが有効なままであること
- `downloadBlocked=true` のversionではDLボタンが `DL不可` 表示になり、クリックできないこと
- `downloadBlockReason` がある場合、DL不可表示のtitle属性などで理由を確認できること
- `collapsedByCompletion=true` のversionが返る場合、完全非表示ではなく薄い表示になること
- 追記投稿ボタンが各versionの正しい `parentVersionId` で動くこと
- 子versionから追記投稿を開始した場合、その子versionが追記元としてフォームに表示されること
- `isRejected=true` の没譜面versionでは追記投稿できない表示が維持されること
- スマホ幅でversion行が大きく崩れず、親子関係が最低限分かること
- 既存の初回投稿と追記投稿が壊れていないこと

BRANCH-01B 追記投稿UI:

- 一覧の各version行に `追記投稿` ボタンが表示されること
- `追記投稿` ボタンを押すと投稿フォームが追記モードへ切り替わること
- 追記モードで `追記投稿: verX.0 から` のように表示されること
- 追記元の `displayVersion` と `branchPath` が表示されること
- 追記元の曲名、アーティスト、仮差分名が読み取り専用情報として表示されること
- 追記モードでは楽曲情報入力欄と仮差分名入力欄が通常入力対象から外れること
- 親versionの `difficulty` / `level` が想定難易度UIへ初期反映されること
- 想定難易度は追記モードでも編集できること
- 親versionの `progressMap` が進捗マップへ読み込まれること
- 親versionまでのlayerが薄い親レイヤーとして表示されること
- 今回追記分のlayerが青系で表示されること
- 親だけで塗られているブロックを解除できないこと
- 親だけで塗られているブロックへ重ね塗りできること
- 今回追記layerのブロックはクリックで塗れること
- 今回追記layerの塗り済みブロックはクリックで解除できること
- ドラッグで今回追記layerの範囲塗り/範囲解除ができること
- progressが親layerと今回layerのunionから計算されること
- 計算されたprogressが既存の進捗度欄に反映されること
- 今回追記layerが空のまま送信すると `追記範囲が追加されていません。` が表示され、APIへ送信されないこと
- `progress>=80` かつ `progress<100` で「完成版にする」ボタンが有効になること
- 「完成版にする」ボタンで未塗りブロックが今回layerへ追加され、progress=100になること
- `progressMap` がない古いversionでは追記ボタンがdisabledになり、画面から追記できないこと
- `isRejected=true` の没譜面versionでは追記ボタンがdisabledになり、`没譜面は追記できません` が表示されること
- `progress=100` の親versionから追記しようとした場合に確認ダイアログが表示されること
- 追記モードのキャンセルで初回投稿フォームへ戻ること

追記投稿API送信:

- 追記フォーム送信時に `POST /api/charts/:chartId/versions` が呼ばれること
- 送信形式が `multipart/form-data` であること
- 送信項目に `file`, `parentVersionId`, `author`, `progressMap`, `password`, `difficulty`, `level`, `comment` が含まれること
- `isRejected` が送信されないこと
- `title` が送信されないこと
- `artist` が送信されないこと
- `chartName` が送信されないこと
- `progressMap.layers` が親layersを維持し、最後に今回追記layerを追加したJSONになること
- 今回追記layerが `versionId="pending"`, `color="#2563eb"`, `kind="followup"` になること
- Worker側で成功した場合、追記モードが閉じること
- 成功後に `GET /api/charts` が再取得されること
- 新しいversionが一覧に表示されること
- 新しいversionの `displayVersion` / `branchPath` / `progress` が表示に反映されること
- 新しいversionの `progressMap` サムネイルが一覧に表示されること
- APIエラー時は `code`, `message`, `detail` が画面上部に表示されること
- APIエラー時はフォーム入力状態が維持されること

BMSメタデータ警告:

- 追記モードで `.bms` / `.bme` / `.bml` を選択したとき、`#TITLE` / `#ARTIST` を読める場合は追記元と簡易比較されること
- 追記元と一致しない可能性がある場合、`選択ファイルの曲名/アーティストが追記先と一致しない可能性があります。` が表示されること
- 最終判定はAPI側で行われ、画面警告だけでは投稿を確定拒否しないこと
- `.zip` 選択時はフロント側メタデータ比較で破綻しないこと

既存機能回帰:

- 初回投稿フォームが従来通り表示されること
- 初回投稿が従来通り `POST /api/charts` へ送信されること
- 初回投稿では `title`, `artist`, `chartName`, `isRejected` が従来通り送信されること
- 譜面ファイル選択時のBMSメタデータ自動読取が壊れていないこと
- 初回投稿の進捗マップ編集が壊れていないこと
- 想定難易度UIが壊れていないこと
- 没譜面ON時の `progress=100` 固定が壊れていないこと
- 管理パスワード保存が壊れていないこと
- 一覧のDLリンクが壊れていないこと
- 一覧の `progressMap` サムネイルが壊れていないこと
- APIエラー表示が壊れていないこと
- スマホ幅でもフォームと一覧が横スクロールせず表示されること

## 今回確認しないもの

- 取り下げAPI
- 削除申請API
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理
- Turnstile
- 進捗画像PNGのR2保存
- 完成到達後の本格的な折り畳み/展開UI
- お気に入り★
- 本格的な譜面ミニビュー

## テスト用BMSファイル

初回投稿用:

```powershell
@"
#PLAYER 1
#TITLE Branch UI Test
#ARTIST Test Artist
#BPM 120
#00111:0102
#00211:0000
#00311:01000002
"@ | Set-Content -Encoding UTF8 .\branch-ui-parent.bms
```

追記投稿用:

```powershell
@"
#PLAYER 1
#TITLE Branch UI Test
#ARTIST Test Artist
#BPM 120
#00111:0102
#00211:0101
#00311:01000002
"@ | Set-Content -Encoding UTF8 .\branch-ui-append.bms
```

タイトル不一致確認用:

```powershell
@"
#PLAYER 1
#TITLE Other Song
#ARTIST Other Artist
#BPM 120
#00111:0102
"@ | Set-Content -Encoding UTF8 .\branch-ui-mismatch.bms
```

## GitHub Pagesでの確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 初回投稿フォームから `branch-ui-parent.bms` を選択する。
3. 曲名/アーティストが自動入力されることを確認する。
4. 想定難易度、仮差分名、差分作者、管理パスワードを入力する。
5. 進捗マップで一部だけ塗る。
6. 初回投稿する。
7. 投稿成功後、一覧にroot versionが表示されることを確認する。
8. root version行に曲名・アーティストが重複表示されず、chartカード見出し側にまとまっていることを確認する。
9. 一覧のroot versionの `追記投稿` ボタンを押す。
10. フォームが追記モードになり、親情報が表示されることを確認する。
11. `branch-ui-append.bms` を選択する。
12. 今回追記分として未塗りブロックを1つ以上塗る。
13. 差分作者と管理パスワードを入力する。
14. 追記投稿する。
15. 成功後に一覧が再取得され、新versionがrootの子としてインデント表示されることを確認する。
16. rootへもう一度追記し、`root/a` と `root/b` が別分岐として並ぶことを確認する。
17. `root/a` の `追記投稿` ボタンから追記し、`root/a/a` が `root/a` の子として表示されることを確認する。
18. 新versionのサムネイルが追加後のprogressを反映していることを確認する。
19. `progress=100` にしたversionが完成表示になり、`downloadBlocked` でない限りDL可能なままであることを確認する。
20. ブラウザ幅を狭め、スマホ幅でもツリー表示と追記ボタンが大きく崩れないことを確認する。

## エラー表示確認

追記範囲なし:

1. 一覧から追記モードを開く。
2. ファイル、差分作者、管理パスワードを入力する。
3. 進捗マップを何も塗らずに送信する。
4. `追記範囲が追加されていません。` が表示されることを確認する。
5. Networkタブで `POST /api/charts/:chartId/versions` が送信されていないことを確認する。

曲名/アーティスト警告:

1. 追記モードで `branch-ui-mismatch.bms` を選択する。
2. `選択ファイルの曲名/アーティストが追記先と一致しない可能性があります。` が表示されることを確認する。

APIエラー:

1. 誤った管理パスワード、またはAPI側で拒否されるファイルを使って送信する。
2. 画面上部に `code`, `message`, `detail` が表示されることを確認する。
3. フォーム入力が消えないことを確認する。

DL不可表示:

1. `GET /api/charts` のレスポンスに `downloadBlocked=true` のversionがある状態で一覧を開く。
2. 該当versionのDLが `DL不可` 表示になり、通常のDLリンクとしてクリックできないことを確認する。
3. `downloadBlockReason` がある場合、title属性などで理由を確認できることを確認する。

## ローカル確認

ローカルで確認する場合は、静的ファイルサーバーとWorkerを別々に起動する。

Worker:

```bash
cd worker
npx wrangler dev
```

静的ファイル:

```bash
cd docs
python -m http.server 8000
```

ローカル静的ページから本番Workerへ接続する場合はCORS Originが異なるため、必要に応じてWorkerの `ALLOWED_ORIGINS` にローカルOriginを追加する。

## TREE-01A 追加確認

- `branchPath` が通常表示で目立ちすぎないこと
- version名の下に `from verX.X` または `起点` が表示され、親versionが分かること
- `root/a`, `root/a/b` などの内部branchPathは、version表示付近のhover/titleで確認できること
- root versionがツリーの起点として表示されること
- `root/a` がrootの子として表示されること
- `root/b` がrootの別分岐として表示されること
- `root/a/a` がroot/aの子として表示されること
- 子を持たないversionに `末端` バッジが出ること
- `progress=100` または `completed=true` のversionに `完成` バッジが出ること
- `isRejected=true` のversionに没譜面バッジまたは追記不可表示が出ること
- DLがテキストリンクではなくボタン風に表示されること
- `downloadBlocked=true` のversionではDLボタンがdisabled表示になること
- PC表示で `想定難易度`, `差分作者`, `進捗度`, `コメント` などの行内ラベルの重複が減っていること
- スマホ幅ではラベル付き表示に戻り、大きく崩れないこと
- 追記投稿ボタンが正しい `parentVersionId` で動くこと
- progressMapサムネイルがツリー線やボタンと重ならないこと
- 既存の初回投稿と追記投稿が壊れていないこと

## 注意

同じファイルを再投稿すると `DUPLICATE_FILE` になる。再テスト時はファイル内容を少し変更するか、テスト用D1/R2を初期化する。
