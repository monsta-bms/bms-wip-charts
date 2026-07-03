# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、D1 migration、BMS解析、進捗マップUI、仕様ドキュメントを確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## 今回確認するもの

PROG-03A フロント側進捗マップUI:

- 投稿フォームの `進捗・管理` セクションに `進捗マップ` が表示されること
- 単体BMS選択後に進捗マップが表示されること
- 小節ごとのプレイノート数が折れ線グラフで表示されること
- グラフ上に小節ブロックが重なっていること
- ブロックをクリックすると塗られること
- ブロックをドラッグすると連続して塗れること
- 塗られた小節数からprogressが算出されること
- progressが既存の進捗度欄に反映されること
- firstMeasureから8小節ごとに黒線が表示されること
- 途中の非プレイノート小節も進捗対象に含まれること
- progress>=80で完成版にするボタンが有効になること
- 完成版にするボタンで未塗り小節が全て塗られ、progress=100になること
- 没譜面ONで全塗り扱いになり、progress=100になること
- zip選択時は進捗マップ未対応として破綻しないこと
- プレイノートなしBMSでエラー表示または非表示になること
- 既存投稿処理が壊れていないこと
- 想定難易度UIが壊れていないこと

PROG-02 Worker側BMS解析:

- 単体 `.bms` / `.bme` / `.bml` 投稿時にWorker側でBMS解析が実行されること
- `POST /api/charts` 成功レスポンスに `analysis` が含まれること
- `GET /api/charts` のversionレスポンスに `playNotes`, `firstNoteMeasure`, `lastNoteMeasure`, `targetMeasureCount`, `measureNotes` が返ること
- BGM/BPM/STOP/BGA/メタ情報がプレイノート数に含まれないこと
- LNの扱いがMVP方針 `count_start_only` になっていること

既存投稿処理:

- 譜面ファイル選択が壊れていないこと
- BMSメタデータ自動読取が壊れていないこと
- 曲名/アーティスト自動入力が壊れていないこと
- `difficulty` と `level` が正しく送信されること
- 管理パスワード保存が壊れていないこと
- APIエラーの `code`, `message`, `detail` が画面上部に表示されること
- 送信中に投稿ボタンがdisabledになり、二重送信を防げること
- 投稿成功後に `GET /api/charts` を再取得して一覧が更新されること

## 今回確認しないもの

- `progress_map_json` のAPI保存
- 進捗画像PNGのR2保存
- Worker側BMS解析の変更
- D1 schema変更
- ZIP内部のBMS解析
- `POST /api/charts/:chartId/versions`
- 追記投稿
- 取り下げ
- 削除申請
- 難易度表API
- 一覧への進捗画像表示
- 完成到達後の折り畳み表示
- お気に入り★
- Cron Trigger
- R2自動削除処理

## PROG-03A テスト用BMSファイル

PowerShellで作成する。

```powershell
@"
#PLAYER 1
#TITLE Progress Map Test
#ARTIST Test Artist
#BPM 120
#00111:0102
#00211:0000
#00311:01000002
#00411:00000000
#00511:0100000000000002
#00911:01
#00301:01010101
#00303:120
"@ | Set-Content -Encoding UTF8 .\prog03a-progress-map-test.bms
```

期待される解析結果:

- `#00111:0102` は2ノート
- `#00211:0000` は0ノート
- `#00311:01000002` は2ノート
- `#00411:00000000` は0ノート
- `#00511:0100000000000002` は2ノート
- `#00911:01` は1ノート
- `#00301:01010101` はBGMなのでカウントしない
- `#00303:120` はBPMなのでカウントしない
- `playNotes=7`
- `firstMeasure=1`
- `lastMeasure=9`
- `targetMeasureCount=9`
- 2小節、4小節、6〜8小節も進捗対象に含まれる
- 1小節目と9小節目に8小節線が表示される

## GitHub PagesでのPROG-03A確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 投稿フォームの `進捗・管理` セクションに `進捗マップ` があることを確認する。
3. 初期表示で `譜面ファイル選択後に進捗マップを表示します` が表示されることを確認する。
4. `prog03a-progress-map-test.bms` を選択する。
5. 曲名とアーティストが自動入力されることを確認する。
6. 進捗マップに折れ線グラフが表示されることを確認する。
7. グラフ上に小節ごとの透明ブロックが重なっていることを確認する。
8. `play notes: 7 / measures: 1-9 / progress: 0%` 相当の概要が表示されることを確認する。
9. 小節ブロックを1つクリックし、進捗度欄が約11%になることを確認する。
10. 複数小節をドラッグして、進捗度欄が塗られた小節数に応じて更新されることを確認する。
11. 8小節ごとの黒線が表示されることを確認する。
12. 8小節以上、つまり9小節中8小節以上を塗ると `完成版にする` ボタンが有効になることを確認する。
13. `完成版にする` を押す。
14. 未塗り小節がすべて塗られ、進捗度欄が `100` になることを確認する。

## 没譜面との連動確認

1. `prog03a-progress-map-test.bms` を選択する。
2. 没譜面チェックをONにする。
3. 進捗マップが全塗り扱いになることを確認する。
4. 進捗度欄が `100` になることを確認する。
5. 進捗度欄が編集不可に見えることを確認する。
6. 没譜面チェックをOFFにする。
7. 進捗度欄が編集可能に戻ることを確認する。
8. 進捗マップ操作が通常状態に戻ることを確認する。

API側でも `isRejected=true` の場合は `progress=100` に強制されるため、ブラウザ側の表示は補助扱いとする。

## ZIP未対応確認

1. `.zip` ファイルを選択する。
2. `単体BMSのみ進捗マップを表示します` と表示されることを確認する。
3. 投稿フォーム全体が崩れないことを確認する。
4. 進捗度欄は従来通り手入力できることを確認する。

## プレイノートなしBMS確認

PowerShellで作成する。

```powershell
@"
#PLAYER 1
#TITLE No Notes
#ARTIST Test Artist
#BPM 120
#00101:01010101
#00103:120
"@ | Set-Content -Encoding UTF8 .\prog03a-no-notes.bms
```

確認手順:

1. `prog03a-no-notes.bms` を選択する。
2. `プレイノートを検出できませんでした` と表示されることを確認する。
3. 投稿フォーム全体が崩れないことを確認する。
4. 進捗度欄は従来通り手入力できることを確認する。

## 想定難易度UI確認

1. 初期表示で `★` タブが選択状態、数字は未選択、プレビューが `未選択` であることを確認する。
2. `★` タブで数字が1〜25すべて表示され、disabledがないことを確認する。
3. PC幅で数字チップが `1〜10`, `11〜20`, `21〜25` の3行に分かれることを確認する。
4. `★★` タブに切り替え、1〜7が選択可能で8〜25がdisabledになることを確認する。
5. `sl` タブに切り替え、1〜12が選択可能で13〜25がdisabledになることを確認する。
6. `st` タブに切り替え、1〜15が選択可能で16〜25がdisabledになることを確認する。
7. `★25` を選択した後に `★★` へ切り替え、プレビューが `★★7` になることを確認する。
8. 手入力に切り替えても想定難易度ブロックの外枠高さが変わらないことを確認する。
9. `overjoy` を入力し、プレビューが `overjoy` になることを確認する。
10. 一覧の想定難易度が `difficulty` のみで表示され、`★12 / 12` のような `level` 併記にならないことを確認する。

## GitHub Pagesから初回投稿確認

1. GitHub Pages画面を開く。
2. `prog03a-progress-map-test.bms` を選択する。
3. 曲名とアーティストが自動入力されることを確認する。
4. 差分情報セクションで想定難易度、仮差分名、差分作者を入力する。
5. 進捗マップでいくつかの小節を塗り、進捗度欄が更新されることを確認する。
6. 管理パスワード、必要ならコメントを入力する。
7. 「投稿する」を押す。
8. 送信中は投稿ボタンがdisabledになることを確認する。
9. 投稿成功後、一覧が再取得され、新しい投稿が表示されることを確認する。
10. 一覧の進捗度が投稿時の `progress` と一致することを確認する。

## PROG-02 curl.exe確認

ローカルWorkerを起動する。

```bash
cd worker
npx wrangler dev
```

別ターミナルで投稿する。

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\prog03a-progress-map-test.bms;type=text/plain" `
  -F "title=Progress Map Test" `
  -F "subtitle=" `
  -F "artist=Test Artist" `
  -F "subartist=" `
  -F "chartName=PROG-03A Test" `
  -F "difficulty=★12" `
  -F "level=12" `
  -F "author=tester" `
  -F "progress=50" `
  -F "comment=PROG-03A test" `
  -F "isRejected=false" `
  -F "password=test-password"
```

期待レスポンス:

- HTTP 201
- `analysis.playNotes` が `7`
- `analysis.firstNoteMeasure` が `1`
- `analysis.lastNoteMeasure` が `9`
- `analysis.targetMeasureCount` が `9`

同じファイルを再投稿した場合は既存仕様通り `DUPLICATE_FILE` になるため、再確認時はファイル内容を少し変えるかD1/R2を初期化する。

## APIエラー表示確認

意図的に重複ファイルを投稿するなどしてAPIエラーを発生させる。

期待表示例:

```text
code: DUPLICATE_FILE
message: 同じファイルは投稿できません。
detail: A version with the same file_sha256 already exists.
```
