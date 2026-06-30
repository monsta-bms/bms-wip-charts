# テスト手順

## Phase 10-Cの対象

Phase 10-Cでは `GET /api/charts` のD1読み取りを確認する。

今回確認するもの:

- `GET /api/charts` がD1の `songs` / `charts` / `versions` を読めること
- `song` / `chart` / `versions` の3層JSONで返ること
- `charts.is_hidden=1` のchartが通常一覧に出ないこと
- `versions.is_hidden=1` のversionが通常一覧に出ないこと
- versionsが `branch_path` 昇順で返ること
- `displayVersion` がAPI側で生成されること
- `progress=100` のversionで `completed: true` と `completedAt` が返ること
- `downloadBlocked` / `downloadBlockReason` が返ること
- 取り下げ、削除申請、非表示状態のフィールドが返ること
- 空DB時に `charts: []` が返ること
- D1エラー時に `code`, `message`, `detail` のJSONエラーが返ること

今回確認しないもの:

- `POST /api/charts`
- `POST /api/charts/:chartId/versions`
- R2保存
- zip検査
- BMSメタデータ読取
- 取り下げAPI
- 削除申請API
- 難易度表API
- フロント接続

## 事前確認

依存関係を入れていない環境では、先に `worker` ディレクトリで依存関係を入れる。

```bash
cd worker
npm install
```

型チェック:

```bash
npm run typecheck
```

この環境で `npm install` や `npm run typecheck` が実行できない場合は、実行できなかった旨を作業報告に残す。

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
curl http://localhost:8787/api/health
curl http://localhost:8787/api/charts
curl "http://localhost:8787/api/charts?page=1&pageSize=100"
```

空DB時の期待レスポンス:

```json
{
  "charts": [],
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "hasNext": false
  }
}
```

## remote D1で確認する場合

remote D1にはPhase 10-A改のmigrationが適用済みであること。

Wranglerのremote devを使う場合:

```bash
cd worker
npx wrangler dev --remote
```

別ターミナルで確認する。

```bash
curl http://localhost:8787/api/charts
curl "http://localhost:8787/api/charts?page=1&pageSize=10"
curl "http://localhost:8787/api/charts?page=1&pageSize=10&q=test"
```

`q` はPhase 10-Cでは受け取るだけで、検索絞り込みはまだ行わない。

## 最小テストデータ

空DBではない状態を確認したい場合は、D1に以下のデータを入れる。

```sql
INSERT INTO songs (
  id,
  title,
  subtitle,
  artist,
  subartist,
  normalized_title,
  normalized_subtitle,
  normalized_artist,
  normalized_subartist
) VALUES (
  'song_test_1',
  'Test Song',
  '',
  'Test Artist',
  '',
  'test song',
  '',
  'test artist',
  ''
);

INSERT INTO charts (
  id,
  song_id,
  chart_name,
  normalized_chart_name
) VALUES (
  'chart_test_another',
  'song_test_1',
  '[ANOTHER]',
  '[another]'
);

INSERT INTO versions (
  id,
  chart_id,
  parent_version_id,
  version_number,
  branch_label,
  branch_path,
  author,
  progress,
  comment,
  difficulty,
  level,
  title,
  artist,
  md5,
  file_id,
  file_name,
  file_size,
  file_sha256,
  r2_key,
  password_hash
) VALUES (
  'version_test_root',
  'chart_test_another',
  NULL,
  1,
  '',
  'root',
  'tester',
  30,
  'root version',
  '★1',
  '1',
  'Test Song',
  'Test Artist',
  '11111111111111111111111111111111',
  'file_test_root',
  'root.bms',
  1024,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'charts/chart_test_another/root/root.bms',
  'hashed-password-root'
);

INSERT INTO versions (
  id,
  chart_id,
  parent_version_id,
  version_number,
  branch_label,
  branch_path,
  author,
  progress,
  comment,
  difficulty,
  level,
  title,
  artist,
  md5,
  file_id,
  file_name,
  file_size,
  file_sha256,
  r2_key,
  password_hash,
  completed_at
) VALUES (
  'version_test_a',
  'chart_test_another',
  'version_test_root',
  2,
  'a',
  'root/a',
  'tester2',
  100,
  'completed branch',
  '★2',
  '2',
  'Test Song',
  'Test Artist',
  '22222222222222222222222222222222',
  'file_test_a',
  'a.bms',
  2048,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'charts/chart_test_another/root/a/a.bms',
  'hashed-password-a',
  CURRENT_TIMESTAMP
);
```

期待する主な確認点:

- `charts[0].song.title` が `Test Song` になる。
- `charts[0].chart.name` が `[ANOTHER]` になる。
- `charts[0].versions[0].displayVersion` が `ver1.0` になる。
- `charts[0].versions[1].displayVersion` が `ver2.0-a` になる。
- `charts[0].versions[1].completed` が `true` になる。
- `charts[0].versions[1].completedAt` に日時が入る。

確認後、テストデータは必要に応じて削除する。

```sql
DELETE FROM versions WHERE id IN ('version_test_a', 'version_test_root');
DELETE FROM charts WHERE id = 'chart_test_another';
DELETE FROM songs WHERE id = 'song_test_1';
```

## 非表示の確認

version非表示:

```sql
UPDATE versions
SET is_hidden = 1,
    hidden_reason = 'test hidden',
    hidden_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'version_test_root';
```

`GET /api/charts` で `version_test_root` が返らないことを確認する。

chart非表示:

```sql
UPDATE charts
SET is_hidden = 1,
    hidden_reason = 'test hidden',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'chart_test_another';
```

`GET /api/charts` で `chart_test_another` が返らないことを確認する。

## DLブロック状態の確認

```sql
UPDATE versions
SET download_blocked = 1,
    download_block_reason = 'withdrawn',
    withdrawn_at = CURRENT_TIMESTAMP,
    download_blocked_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'version_test_root';
```

`GET /api/charts` で以下を確認する。

- `downloadBlocked` が `true`
- `downloadBlockReason` が `withdrawn`
- `withdrawn` が `true`
- `file.downloadUrl` が `null`

## 異常系の確認

不正な `page`:

```bash
curl "http://localhost:8787/api/charts?page=0"
```

期待レスポンス:

```json
{
  "code": "INVALID_QUERY_PARAM",
  "message": "クエリパラメータが不正です。",
  "detail": "page must be a positive safe integer."
}
```

不正な `pageSize`:

```bash
curl "http://localhost:8787/api/charts?pageSize=999"
```

期待レスポンス:

```json
{
  "code": "INVALID_QUERY_PARAM",
  "message": "クエリパラメータが不正です。",
  "detail": "pageSize must be 200 or less."
}
```

CORS確認:

```bash
curl -H "Origin: https://example.invalid" http://localhost:8787/api/charts
```

`ALLOWED_ORIGIN` と一致しない場合は `CORS_ORIGIN_NOT_ALLOWED` が返る。

## D1エラー時の確認

D1 binding名が誤っている、migration未適用、または対象テーブルが存在しない場合、`GET /api/charts` は以下の形式で失敗する。

```json
{
  "code": "D1_QUERY_FAILED",
  "message": "投稿一覧の取得に失敗しました。",
  "detail": "D1 read failed in charts-list-d1-read: ..."
}
```

Workerログには `[charts-list-d1-read]` を含む `console.error` が出る。
