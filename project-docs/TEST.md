# テスト手順

## 対象

GitHub Pages の静的フロント画面、Worker API接続、D1 migration、BMS解析、進捗マップUI、進捗マップ保存、仕様ドキュメントを確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## 今回確認するもの

PROG-04A 進捗マップ保存:

- フロント側で塗った進捗マップが `progressMap` JSON文字列として `POST /api/charts` に送信されること
- `progressMap.schemaVersion` が `2` であること
- `progressMap.blockMode` が `standardized_measure` であること
- `progressMap.targetBlockCount` が下段の標準化ブロック数と一致すること
- `progressMap.blocks.length` が `targetBlockCount` と一致すること
- `progressMap.blocks` が下段の標準化ブロックと1対1対応していること
- 塗り済みブロックが `layers[0].ranges` に連続範囲として圧縮されること
- Worker側で `progressMap` のrangesから `progress` が再計算されること
- Worker側で再計算された `progress` が `versions.progress` に保存されること
- Worker側で正規化された `progressMap` が `versions.progress_map_json` に保存されること
- `POST /api/charts` 成功レスポンスに `progressMap` が含まれること
- 成功レスポンスの `progressMap.layers[0].versionId` が実際の `versionId` になること
- `GET /api/charts` のversionレスポンスに `progressMap` が返ること
- `progressMap` 未送信の場合は従来通り `progress` の値で投稿できること
- 不正なJSONを送ると `INVALID_PROGRESS_MAP` が返ること
- 範囲外indexを送ると `PROGRESS_MAP_OUT_OF_RANGE` が返ること
- `targetBlockCount` と `blocks.length` が一致しない場合は `PROGRESS_MAP_BLOCK_COUNT_MISMATCH` が返ること
- 没譜面ONでは、送信された `progressMap` に関係なく `progress=100` になること
- 没譜面ONでは、保存されるlayer kindが `rejected_auto_fill` になること
- `完成版にする` ボタンで全塗り後に投稿すると、layer kindが `completion_fill` になり、`progress=100` で保存されること

PROG-03C フロント側進捗マップUI:

- 投稿フォームの `進捗・管理` セクションに `進捗マップ` が表示されること
- 単体BMS選択後に進捗マップが表示されること
- 上段に標準化ブロックごとのプレイノート密度が棒グラフで表示されること
- 上段の棒本数と下段のブロック数が一致すること
- 上段の1本の棒が、下段の1ブロックと1対1対応すること
- 上段左端と下段左端が揃っていること
- 上段右端と下段右端が揃っていること
- 上段左側に不要な空白がないこと
- 上段の棒グラフが下段ブロックと同じ横幅単位で再集計されていること
- 高密度ブロックで棒が高く、低密度ブロックで棒が低く表示されること
- `playNotes / durationSec` が取れない場合でもfallbackで表示が壊れないこと
- 上段と下段の表示範囲が `first_note_measure` 〜 `last_note_measure` で揃っていること
- 上段の棒グラフと下段ブロックが横方向に対応していること
- `first_note_measure` が `004` の場合、表示左端も `004` 相当になること
- 曲頭の進捗対象外空白小節が通常表示に混ざらないこと
- 折れ線グラフが表示されないこと
- 下段に進捗編集用の標準化ブロックが表示されること
- 棒グラフと進捗編集ブロックが重ならず、上下に分かれていること
- 緑色が「作成済みブロック」だけを意味していること
- 緑が線ではなく塗り済み範囲の面として見えること
- 8ブロックごとの区切り線が濃いグレーで表示されること
- 通常のブロック境界線が薄く表示されること
- 8ブロック区切りの下に小節番号が表示されること
- 小節番号が3桁ゼロ埋めで表示されること
- 小節番号に `m` 接頭辞が表示されないこと
- 小節番号が縦線と重ならないこと
- 小節番号が1桁だけに切れないこと
- 小節番号が下段ブロックのクリック/ドラッグ操作を邪魔しないこと
- 小節番号が8ブロックごとの目安として読めること
- 表示幅が狭い場合は小節番号が適切に間引かれること
- 未塗りブロックをクリックすると塗れること
- 塗り済みブロックをクリックすると解除できること
- 未塗りブロックからドラッグすると範囲塗りできること
- ドラッグしすぎた後、左クリックを押したまま戻すと余分な塗りが解除されること
- 塗り済みブロックからドラッグすると範囲解除できること
- 範囲解除中に戻すと解除しすぎた部分が元に戻ること
- hoverで小節範囲、秒数範囲、notesが表示されること
- 右クリックで簡易情報ポップアップが出ること
- ブロック右クリック時に通常のブラウザメニューが出ないこと
- progressが `塗られた標準化ブロック数 / 標準化ブロック総数` で算出されること
- progressが既存の進捗度欄に反映されること
- 概要表示が `play notes: xxxx / blocks: xx / progress: xx%` 形式になっていること
- `#xxx02` の小節長変更が多いBMSでも縦線が過密になりすぎないこと
- BPM変更やBPMチャンネルを含むBMSでもグラフが破綻しないこと
- 通常譜面、BPM変動譜面、小節長変更ギミック譜面で上下の位置対応が崩れないこと
- progress>=80かつprogress<100で `完成版にする` ボタンが有効になること
- `完成版にする` ボタンで未塗りブロックがすべて塗られ、progress=100になること
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
- 本格的な譜面ミニビュー
- Cron Trigger
- R2自動削除処理

## PROG-03C/04A テスト用BMSファイル

PowerShellで基本確認用ファイルを作成する。

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
"@ | Set-Content -Encoding UTF8 .\prog03c-progress-map-test.bms
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
- 棒グラフと編集ブロックが上下に分離して表示される
- 上段の棒本数が下段の標準化ブロック数と一致する
- 上段の棒1本が下段の1ブロックと同じ横幅単位で対応する
- 標準化ブロックが表示され、progressはブロック数ベースで計算される
- 8ブロック区切りの小節番号が表示される
- 小節番号が `001` のように3桁ゼロ埋めで表示され、途中で切れない

## 表示範囲揃え確認用BMSファイル

曲頭に進捗対象外の空白小節があるBMSを作成する。

```powershell
@"
#PLAYER 1
#TITLE Progress Map Offset Test
#ARTIST Test Artist
#BPM 120
#00101:01010101
#00201:01010101
#00301:01010101
#00411:0100
#00511:0000
#00611:0001
#01211:01
"@ | Set-Content -Encoding UTF8 .\prog03c-offset-test.bms
```

期待される表示:

- `#00101` 〜 `#00301` はBGMなので進捗対象外として扱う
- `firstMeasure=4`
- `lastMeasure=12`
- 上段の棒グラフと下段ブロックの左端が同じ位置から始まる
- 上段の棒グラフと下段ブロックの右端が同じ位置で終わる
- 上段左側に不要な空白がない
- 上段の棒本数と下段の標準化ブロック数が一致する
- 表示左端の小節番号が `004` 相当になる
- 曲頭の空白小節やBGMのみの小節が通常表示の左側余白として混ざらない
- 上段の山と下段ブロックの横位置が対応して見える

## 添付BMSでの見た目確認

今回の依頼に添付された以下のBMSを使い、極端なBMSでも見た目が破綻しないことを確認する。

- `[LED]_hoshikuzu_apotosis_.bme`
- `_timeleapondo_7_a.bme`
- `mpf_Insane_delay.bms`

確認ポイント:

- `[LED]_hoshikuzu_apotosis_.bme` で、密度バーと編集ブロックが重ならないこと
- `_timeleapondo_7_a.bme` で、`#xxx02` 由来の縦線過密表示が改善していること
- `mpf_Insane_delay.bms` で、通常のBMSでもブロック表示が自然に見えること
- いずれのファイルでも、上段と下段の開始位置が揃っていること
- いずれのファイルでも、上段の棒グラフと下段ブロックが横方向に対応していること
- いずれのファイルでも、上段の棒本数と下段のブロック数が一致すること
- いずれのファイルでも、上段左側に不要な空白がないこと
- いずれのファイルでも、緑色が塗り済みブロック以外の意味に見えないこと
- いずれのファイルでも、小節番号が縦線と重ならず、3桁で読めること
- いずれのファイルでも、範囲塗りと範囲解除ができること
- hover/右クリックで位置情報を確認できること

## GitHub PagesでのPROG-04A確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 投稿フォームの `進捗・管理` セクションに `進捗マップ` があることを確認する。
3. 初期表示で `譜面ファイル選択後に進捗マップを表示します` が表示されることを確認する。
4. `prog03c-progress-map-test.bms` または添付BMSを選択する。
5. 曲名とアーティストが自動入力されることを確認する。
6. 上段に標準化ブロックごとのノート密度が棒グラフで表示されることを確認する。
7. 下段に進捗編集用の標準化ブロックが表示されることを確認する。
8. 上段の棒本数と下段のブロック数が一致することを確認する。
9. 未塗りブロックをいくつか塗り、進捗度欄が更新されることを確認する。
10. ブラウザ開発者ツールのNetworkで `POST /api/charts` のFormDataに `progressMap` が含まれることを確認する。
11. `progressMap` の `schemaVersion=2`, `blockMode=standardized_measure`, `targetBlockCount`, `blocks`, `layers[0].ranges` を確認する。
12. 想定難易度、仮差分名、差分作者、管理パスワードを入力する。
13. 「投稿する」を押す。
14. 送信中は投稿ボタンがdisabledになることを確認する。
15. 投稿成功後、一覧が再取得され、新しい投稿が表示されることを確認する。
16. `GET /api/charts?page=1&pageSize=100` のレスポンスで対象versionに `progressMap` が返ることを確認する。
17. `progressMap.layers[0].versionId` が `pending` ではなく、実際の `versionId` になっていることを確認する。
18. 一覧の進捗度がWorker側で再計算された `progress` と一致することを確認する。

## 完成版にする保存確認

1. 単体BMSを選択する。
2. 進捗が80%以上かつ100%未満になるようにブロックを塗る。
3. `完成版にする` ボタンが有効になることを確認する。
4. `完成版にする` を押す。
5. 未塗りブロックがすべて塗られ、進捗度欄が `100` になることを確認する。
6. 投稿する。
7. 成功レスポンスまたは `GET /api/charts` で、`progress=100` になっていることを確認する。
8. `progressMap.layers[0].kind` が `completion_fill` になっていることを確認する。

## 没譜面との連動確認

1. `prog03c-progress-map-test.bms` または添付BMSを選択する。
2. 没譜面チェックをONにする。
3. 進捗マップが全塗り扱いになることを確認する。
4. 進捗度欄が `100` になることを確認する。
5. 進捗度欄が編集不可に見えることを確認する。
6. 進捗マップのブロックが編集不可になることを確認する。
7. 投稿する。
8. 成功レスポンスまたは `GET /api/charts` で、`progress=100` になっていることを確認する。
9. `progressMap.layers[0].kind` が `rejected_auto_fill` になっていることを確認する。
10. 没譜面チェックをOFFにした通常操作では、進捗度欄が編集可能に戻ることを確認する。

API側でも `isRejected=true` の場合は `progress=100` に強制されるため、ブラウザ側の表示は補助扱いとする。

## ZIP未対応確認

1. `.zip` ファイルを選択する。
2. `単体BMSのみ進捗マップを表示します` と表示されることを確認する。
3. 投稿フォーム全体が崩れないことを確認する。
4. 進捗度欄は従来通り手入力できることを確認する。
5. `progressMap` 未送信でも従来通り投稿できることを確認する。

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
"@ | Set-Content -Encoding UTF8 .\prog03c-no-notes.bms
```

確認手順:

1. `prog03c-no-notes.bms` を選択する。
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

## PROG-04A curl.exe確認

ローカルWorkerを起動する。

```bash
cd worker
npx wrangler dev
```

別ターミナルで投稿する。

```powershell
$progressMap = '{"schemaVersion":2,"blockMode":"standardized_measure","firstMeasure":1,"lastMeasure":9,"targetBlockCount":9,"blocks":[{"index":0,"startMeasure":1,"endMeasure":1,"startTimeSec":0,"endTimeSec":1,"playNotes":2},{"index":1,"startMeasure":2,"endMeasure":2,"startTimeSec":1,"endTimeSec":2,"playNotes":0},{"index":2,"startMeasure":3,"endMeasure":3,"startTimeSec":2,"endTimeSec":3,"playNotes":2},{"index":3,"startMeasure":4,"endMeasure":4,"startTimeSec":3,"endTimeSec":4,"playNotes":0},{"index":4,"startMeasure":5,"endMeasure":5,"startTimeSec":4,"endTimeSec":5,"playNotes":2},{"index":5,"startMeasure":6,"endMeasure":6,"startTimeSec":5,"endTimeSec":6,"playNotes":0},{"index":6,"startMeasure":7,"endMeasure":7,"startTimeSec":6,"endTimeSec":7,"playNotes":0},{"index":7,"startMeasure":8,"endMeasure":8,"startTimeSec":7,"endTimeSec":8,"playNotes":0},{"index":8,"startMeasure":9,"endMeasure":9,"startTimeSec":8,"endTimeSec":9,"playNotes":1}],"layers":[{"versionId":"pending","color":"#1f7a5c","kind":"initial","ranges":[[0,3]]}],"progress":44}'

curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\prog03c-progress-map-test.bms;type=text/plain" `
  -F "title=Progress Map Test" `
  -F "subtitle=" `
  -F "artist=Test Artist" `
  -F "subartist=" `
  -F "chartName=PROG-04A Test" `
  -F "difficulty=★12" `
  -F "level=12" `
  -F "author=tester" `
  -F "progress=0" `
  -F "progressMap=$progressMap" `
  -F "comment=PROG-04A test" `
  -F "isRejected=false" `
  -F "password=test-password"
```

期待レスポンス:

- HTTP 201
- `progress` が `44` になること
- `progressMap.schemaVersion` が `2`
- `progressMap.layers[0].versionId` が実際の `versionId`
- `progressMap.layers[0].ranges` が `[[0,3]]`
- `analysis.playNotes` が `7`
- `analysis.firstNoteMeasure` が `1`
- `analysis.lastNoteMeasure` が `9`

続けて確認する。

```powershell
curl.exe "http://localhost:8787/api/charts?page=1&pageSize=100"
```

期待:

- 対象versionに `progressMap` が含まれる
- 対象versionの `progress` が `44`

不正JSON確認:

```powershell
curl.exe -X POST "http://localhost:8787/api/charts" `
  -F "file=@.\prog03c-progress-map-test.bms;type=text/plain" `
  -F "title=Progress Map Test Invalid" `
  -F "artist=Test Artist" `
  -F "chartName=PROG-04A Invalid" `
  -F "difficulty=★12" `
  -F "author=tester" `
  -F "progress=50" `
  -F "progressMap={invalid" `
  -F "isRejected=false" `
  -F "password=test-password"
```

期待:

- HTTP 400
- `code=INVALID_PROGRESS_MAP`

同じファイルを再投稿した場合は既存仕様通り `DUPLICATE_FILE` になるため、再確認時はファイル内容を少し変えるかD1/R2を初期化する。

## APIエラー表示確認

意図的に重複ファイルを投稿するなどしてAPIエラーを発生させる。

期待表示例:

```text
code: DUPLICATE_FILE
message: 同じファイルは投稿できません。
detail: A version with the same file_sha256 already exists.
```

## PROG-04B 一覧側progressMapサムネイル確認

- `progressMap` があるversionで、一覧に小さな進捗サムネイルが表示されること
- `progressMap.layers[].ranges` が塗り済み範囲として表示されること
- 未塗り範囲が薄い色で表示されること
- `progress xx%` の数値が表示されること
- 複数layerや重複rangeがある場合でも、unionとして塗り済み表示になること
- `progressMap` がないversionでも一覧表示が壊れないこと
- `progressMap` のJSONが不正でも画面全体が壊れないこと
- 不正な `progressMap` は画面エラーではなく、必要に応じて `console.warn` に留まること
- 一覧行が大きくなりすぎないこと
- 既存のDLリンクが壊れていないこと
- 既存の追記投稿ボタン表示が壊れていないこと
- 既存の投稿フォームが壊れていないこと

## GitHub PagesでのPROG-04B確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. PROG-04A以降に投稿した `progressMap` 付きversionが一覧に表示されることを確認する。
3. 対象version行に、緑/薄グレーの横長サムネイルバーと `progress xx%` が表示されることを確認する。
4. サムネイルの塗り済み範囲が、投稿時に塗った範囲と大きく矛盾しないことを確認する。
5. `progressMap` がない既存versionでは、サムネイルが表示されなくても進捗度・コメント・DLリンクが従来通り表示されることを確認する。
6. ブラウザ開発者ツールのConsoleで、不正な `progressMap` がある場合でも画面全体が停止せず、警告程度で済むことを確認する。
7. スマホ幅または狭い画面幅でも、一覧行が大きく崩れないことを確認する。
