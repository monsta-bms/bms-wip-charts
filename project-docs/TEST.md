# テスト手順

## Phase 10-A改の対象

Phase 10-A改ではD1 schema / migrationのみを確認する。

今回確認するもの:

- `worker/migrations/0001_initial.sql`
- `schema/d1.sql`
- D1テーブル作成
- 外部キー制約
- 分岐versionを表現できること
- DL制御カラム
- 削除申請テーブル
- index作成

今回確認しないもの:

- WorkerのD1読み取り実装
- 投稿APIの本実装
- R2保存
- BMSメタデータ読取
- zip検査
- IP/UAレート制限
- フロント接続

## 静的確認

以下のテーブルが定義されていることを確認する。

- `songs`
- `charts`
- `versions`
- `delete_requests`
- `post_logs`
- `bans`
- `admin_logs`

確認観点:

- `songs` は元曲単位の情報を持つ。
- `charts` は差分単位の情報を持ち、`songs` へ外部キーを持つ。
- `versions` は分岐・履歴単位の情報を持ち、`charts` へ外部キーを持つ。
- `versions.parent_version_id` でversion同士の親子関係を表現できる。
- `versions.branch_path` でツリー表示、ページング、祖先DL制御、並び順を扱える。
- root versionだけ `parent_version_id` がNULLで、それ以外は親を持つ。
- `display_version` はDB保存されていない。
- `versions.password_hash` があり、生パスワードを保存しない設計になっている。
- `versions.download_blocked`, `download_block_reason`, `download_blocked_at` がある。
- `versions.completed_at`, `withdrawn_at`, `delete_requested_at`, `hidden_at` がある。
- `delete_requests` がある。
- `bans` は `ip_hash`, `ua_hash`, `file_sha256` をBAN対象にできる。
- cascade削除ではなく、基本はhidden / DLブロックによる論理管理になっている。
- よく使う検索条件にindexがある。

## Wranglerでの確認

```bash
cd worker
npx wrangler d1 migrations list wip-bms-charts-db
npx wrangler d1 migrations apply wip-bms-charts-db --local
```

ローカルD1に対してテーブル一覧を確認する。

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

index一覧を確認する。

```bash
npx wrangler d1 execute wip-bms-charts-db --local --command "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name;"
```

## Dashboardでの確認

1. Cloudflare Dashboardを開く。
2. D1 database `wip-bms-charts-db` を開く。
3. Query画面で `schema/d1.sql` の内容を実行する。
4. `songs`, `charts`, `versions`, `delete_requests`, `post_logs`, `bans`, `admin_logs` が存在することを確認する。
5. indexが作成されていることを確認する。

## 最小SQL確認

テーブル作成後、以下のSQLで3層構造と分岐versionを確認する。

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

SELECT
  songs.title,
  charts.chart_name,
  versions.version_number,
  versions.branch_path,
  versions.progress,
  versions.completed_at
FROM versions
JOIN charts ON charts.id = versions.chart_id
JOIN songs ON songs.id = charts.song_id
WHERE charts.id = 'chart_test_another'
ORDER BY versions.branch_path;
```

DL不可状態の確認例:

```sql
UPDATE versions
SET
  download_blocked = 1,
  download_block_reason = 'superseded_by_completed_descendant',
  download_blocked_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'version_test_root';

SELECT id, download_blocked, download_block_reason
FROM versions
WHERE chart_id = 'chart_test_another'
ORDER BY branch_path;
```

削除申請の確認例:

```sql
INSERT INTO delete_requests (
  id,
  version_id,
  chart_id,
  message,
  requester_ip_hash,
  requester_ua_hash
) VALUES (
  'delete_request_test_1',
  'version_test_a',
  'chart_test_another',
  'test delete request',
  'ip_hash_test',
  'ua_hash_test'
);

SELECT id, status, created_at
FROM delete_requests
WHERE chart_id = 'chart_test_another';
```

確認後、テストデータは必要に応じて削除する。

```sql
DELETE FROM delete_requests WHERE id = 'delete_request_test_1';
DELETE FROM versions WHERE id IN ('version_test_a', 'version_test_root');
DELETE FROM charts WHERE id = 'chart_test_another';
DELETE FROM songs WHERE id = 'song_test_1';
```

## 注意

Dashboardから `schema/d1.sql` を直接実行した場合、Wrangler migration履歴には残らない。

以後Wrangler migrationsで管理する場合は、Dashboard実行とWrangler実行を混在させない。

Phase 10-A改は本番データなし前提で `0001_initial.sql` を上書き再設計している。旧schemaを既に適用済みの場合は、リセット手順を確認してから適用する。
