# テスト手順

## 対象

GitHub Pages の静的フロント画面で、投稿フォームUIと本番Worker API接続を確認する。

本番Worker URL:

```text
https://bms-wip-charts-worker.monsta3228gsl.workers.dev
```

GitHub Pages URL:

```text
https://monsta-bms.github.io/bms-wip-charts/
```

## 今回確認するもの

- 資料AのUIから資料Bに近いUIへ変更されていること
- 必須項目に赤い `*` が表示されること
- `*項目は入力必須。` の説明が表示されること
- 初期表示時に赤エラーが出すぎないこと
- 曲名/アーティストに `一致していない場合修正してください。` が表示されること
- 想定難易度に `例: ★12 / st5 / sl8` が表示されること
- `level` 入力欄が通常フォームに表示されないこと
- 一覧で `difficulty` と `level` が重複表示されないこと
- 差分名が `仮差分名` として分かる表示になっていること
- 仮差分名に `[ANOTHER] / [ALITHER] / 仮差分` の入力例が表示されること
- 差分作者が `差分作者（別名義可）` になっていること
- 差分作者に `例: tester / anonymous` の入力例が表示されること
- 没譜面チェックに `追記されることがなくなります` の補足があること
- 没譜面チェックONで進捗度が `100` になること
- 没譜面チェックONで進捗度が編集不可になること
- 没譜面チェックOFFで進捗度が編集可能に戻ること
- 管理パスワードの補足説明が表示されること
- パスワード保存の注意文が表示されること
- コメント欄に `音源URL、作業メモ、注意点など` のplaceholderが出ること
- コメント欄に、音源ファイルはアップロードせずURLを貼る運用であることが表示されること
- 投稿フォームから `multipart/form-data` で `POST /api/charts` へ送信できること
- 投稿成功後に `GET /api/charts` を再取得して一覧が更新されること
- APIエラーの `code`, `message`, `detail` が画面上部に表示されること
- 送信中に投稿ボタンがdisabledになり、二重送信を防げること
- 管理パスワードをlocalStorageへ保存できること
- DLリンクが本番Worker URLへ向いていること
- CORSで `https://monsta-bms.github.io` が許可されていること

## 今回確認しないもの

- DB migration
- Worker API変更
- R2保存処理変更
- `POST /api/charts/:chartId/versions`
- 追記投稿
- 取り下げ
- 削除申請
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除処理

## GitHub Pages表示確認

1. `https://monsta-bms.github.io/bms-wip-charts/` を開く。
2. 投稿フォームが2カラムを維持したまま、資料Bのように入力誘導と補足文が追加されていることを確認する。
3. 初期表示時に上部エラー欄や各入力欄が赤エラーだらけになっていないことを確認する。
4. 譜面ファイル、曲名、アーティスト、仮差分名、想定難易度、差分作者、進捗度、管理パスワードに赤い `*` が表示されることを確認する。
5. `*項目は入力必須。` が表示されることを確認する。
6. 曲名とアーティストのplaceholderが `一致していない場合修正してください。` であることを確認する。
7. 想定難易度のplaceholderが `例: ★12 / st5 / sl8` であることを確認する。
8. 通常フォームに `level` 入力欄がないことを確認する。
9. 差分名が `仮差分名` として表示され、補足文で同じ曲の別差分を区別する名前だと分かることを確認する。
10. 差分作者のラベルが `差分作者（別名義可）` であることを確認する。
11. コメント欄のplaceholderが `音源URL、作業メモ、注意点など` であることを確認する。
12. 投稿一覧に本番Workerの `GET /api/charts` の結果が表示されることを確認する。
13. 一覧の想定難易度が `difficulty` のみで表示され、`★11 / 12` や `st5 / 5` のような `level` 併記にならないことを確認する。

## 必須チェック確認

1. 初期表示直後に赤いエラーが表示されていないことを確認する。
2. 何も入力せずに「投稿する」を押す。
3. 上部エラー欄に未入力項目が表示されることを確認する。
4. 未入力の必須項目の入力枠が赤くなることを確認する。
5. 入力すると該当欄の赤枠が解除されることを確認する。

## テスト用BMSファイル作成例

PowerShell例:

```powershell
@"
#PLAYER 1
#TITLE Test Song Guided Form
#ARTIST Test Artist
#PLAYLEVEL 3
#BPM 120
#00111:01
"@ | Set-Content -Encoding UTF8 .\guided-form-test.bms
```

## BMSメタデータ自動読取確認

1. GitHub Pages画面を開く。
2. `guided-form-test.bms` を選択する。
3. `#TITLE` と `#ARTIST` が曲名/アーティスト欄へ自動入力されることを確認する。
4. 曲名/アーティスト欄は手修正できることを確認する。

## 没譜面チェック確認

1. 没譜面チェックをONにする。
2. 進捗度欄が `100` 表示になることを確認する。
3. 進捗度欄が編集不可に見えることを確認する。
4. 没譜面チェックに `追記されることがなくなります` の補足があることを確認する。
5. 没譜面チェックをOFFにする。
6. 進捗度欄が編集可能に戻ることを確認する。

API側でも `isRejected=true` の場合は `progress=100` に強制されるため、ブラウザ側の表示は補助扱いとする。

## GitHub Pagesから初回投稿確認

1. GitHub Pages画面を開く。
2. `guided-form-test.bms` を選択する。
3. 曲名とアーティストが自動入力されることを確認する。
4. 仮差分名、想定難易度、差分作者、進捗度、コメント、管理パスワードを入力する。
5. 想定難易度に `★12` を入力する。
6. 「投稿する」を押す。
7. 送信中は投稿ボタンがdisabledになることを確認する。
8. 投稿成功後、一覧が再取得され、新しい投稿が表示されることを確認する。
9. 一覧の想定難易度が `★12` と表示され、`★12 / 12` にならないことを確認する。
10. DLリンクが `https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/files/...` を指すことを確認する。

## level内部値確認

`difficulty` から `level` が抽出されることをAPIまたはD1で確認する。

確認例:

| difficulty | 期待するlevel |
| --- | --- |
| `★12` | `12` |
| `st5` | `5` |
| `sl8` | `8` |
| `12` | `12` |

D1確認例:

```bash
cd worker
npx wrangler d1 execute wip-bms-charts-db --command "SELECT difficulty, level FROM versions WHERE title LIKE '%Guided Form%' ORDER BY created_at DESC LIMIT 5;"
```

抽出できない `difficulty` の場合、`level` は空または `NULL` でよい。

## 管理パスワード保存確認

1. 管理パスワードを入力する。
2. 「パスワードを保存」をONにする。
3. 補足文に `この端末のブラウザに保存します。共有PCでは使わないでください。` と表示されることを確認する。
4. 投稿する、またはチェック状態を変更する。
5. ページを再読み込みする。
6. 管理パスワード欄に保存値が復元されることを確認する。
7. 「パスワードを保存」をOFFにするとlocalStorageから削除されることを確認する。

## APIエラー表示確認

意図的に重複ファイルを投稿するなどしてAPIエラーを発生させる。

期待表示例:

```text
code: DUPLICATE_FILE
message: 同じファイルは投稿できません。
detail: A version with the same file_sha256 already exists.
```

## CORSエラー時の確認

画面上で通信に失敗し、ブラウザコンソールにCORSエラーが出る場合は以下を確認する。

- `worker/wrangler.toml` に `ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"` があること
- `npm run deploy` 済みであること
- GitHub Pages URLではなくOrigin `https://monsta-bms.github.io` を許可していること

## テストデータ削除

必要に応じてD1とR2のテストデータを削除する。

D1は外部キーがあるため、versionから順に削除する。

```sql
DELETE FROM post_logs WHERE detail LIKE '%Initial chart version created.%' OR error_code IS NOT NULL;
DELETE FROM versions WHERE title LIKE '%Guided Form%';
DELETE FROM charts WHERE chart_name IN ('[REJECTED]', '[NORMAL]', '[INVALID]', '[ANOTHER]', '[ALITHER]', '仮差分');
DELETE FROM songs WHERE title LIKE '%Guided Form%';
```

R2は `charts/{chartId}/versions/root/` 配下のテストファイルをDashboardから削除する。
