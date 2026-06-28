# テスト手順

## Phase 10-Aの対象

Phase 10-AではD1 schema / migrationのみを確認する。

今回確認するもの:

- `worker/migrations/0001_initial.sql`
- `schema/d1.sql`
- D1テーブル作成
- 外部キー制約
- index作成

今回確認しないもの:

- WorkerのD1読み取り実装
- 投稿APIの本実装
- R2保存
- zip検査
- IP/UAレート制限
- フロント接続

## 静的確認

以下のテーブルが定義されていることを確認する。

- `charts`
- `versions`
- `post_logs`
- `bans`
- `admin_logs`

確認観点:

- `charts` は曲単位の情報を持つ。
- `versions` はバージョン単位の情報を持つ。
- `post_logs` は投稿試行ログを持つ。
- `bans` は `ip_hash`, `ua_hash`, `file_sha256` をBAN対象にできる。
- `admin_logs` は管理人操作ログを持つ。
- `charts` と `versions` は `is_hidden` を持つ。
- `created_at`, `updated_at` がある。
- `version_number` は整数である。
- 外部キー制約がある。
- cascade削除ではなく、基本はhiddenによる論理削除になっている。
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
4. `charts`, `versions`, `post_logs`, `bans`, `admin_logs` が存在することを確認する。
5. indexが作成されていることを確認する。

## 最小SQL確認

テーブル作成後、以下のようなSQLで基本的な外部キー関係を確認する。

```sql
INSERT INTO charts (
  id,
  title,
  artist,
  normalized_title,
  normalized_artist
) VALUES (
  'chart_test_1',
  'Test Title',
  'Test Artist',
  'test title',
  'test artist'
);

INSERT INTO versions (
  id,
  chart_id,
  version_number,
  difficulty,
  author,
  progress,
  comment,
  file_id,
  file_name,
  file_size,
  file_sha256,
  r2_key
) VALUES (
  'version_test_1',
  'chart_test_1',
  1,
  '★1',
  'tester',
  100,
  'test row',
  'file_test_1',
  'test.bms',
  1024,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'charts/chart_test_1/ver1/test.bms'
);

SELECT
  charts.title,
  charts.artist,
  versions.version_number,
  versions.progress
FROM versions
JOIN charts ON charts.id = versions.chart_id
WHERE charts.is_hidden = 0
  AND versions.is_hidden = 0;
```

確認後、テストデータは必要に応じて削除する。

```sql
DELETE FROM versions WHERE id = 'version_test_1';
DELETE FROM charts WHERE id = 'chart_test_1';
```

## 注意

Dashboardから `schema/d1.sql` を直接実行した場合、Wrangler migration履歴には残らない。

以後Wrangler migrationsで管理する場合は、Dashboard実行とWrangler実行を混在させない。
