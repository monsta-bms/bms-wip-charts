# デプロイ手順

## manual review非破壊復旧

現行schema 0001～0009でHASH用途分離前のWorkerを一時復旧する場合は、`3564a2dbe8ac1c853f879abf8707211434c0d08c`を基点にした専用branchから、管理者却下機能だけを含むversionを`wrangler versions upload --strict`で作成する。Migration、Secret変更、Pages反映は同時に行わない。candidateのWorker名・bindings・preview health・admin認証を確認してから1 version 100%でdeployする。

管理者却下scriptは`worker/scripts/reject-manual-withdrawals.mjs`で、引数なしは読み取り専用dry-runである。本番書込みは事前に一覧件数を確認し、`node .\scripts\reject-manual-withdrawals.mjs --execute --expected-count 2`のように期待件数を明示した場合だけ行う。ADMIN_TOKENは既定のrepository外保存fileから読み、値や対象IDを出力しない。完了後はpending/manual reviewとprocessingが0、監査が対象件数分、version/chart/file不変であることを読み取り確認する。

## 正式な安全デプロイ手順

API Workerを確認・デプロイするときは、リポジトリ直下の専用BATだけを使用する。

検査のみ（本番デプロイなし）:

```text
deploy-worker-check.bat
```

本番デプロイ候補:

```text
deploy-worker.bat
```

本番デプロイでは、Gitの`main`と`origin/main`が完全一致し、設定検査、TypeScript検査、Wrangler dry-runがすべて成功した後に、次の文字列を完全一致で入力する。

```text
DEPLOY bms-wip-charts-worker
```

空Enter、`y`、部分一致ではデプロイしない。正しい対象は`worker/wrangler.toml`の`bms-wip-charts-worker`だけであり、リポジトリ直下の`wrangler.jsonc`、静的Worker `bms-wip-charts`、`docs/` assetsを検出した場合は停止する。

次の直接実行は禁止する。

```text
npx wrangler deploy
```

`worker`以外から`npm run deploy`を実行しない。`worker`内の`npm run deploy`は専用PowerShellへ接続済みのため利用できるが、初心者向けの正式手順は上記BATとする。

専用PowerShellは常に`worker/wrangler.toml`の絶対パスを`--config`へ渡し、D1 `DB`、R2 `FILES`、`WITHDRAWAL_CRON_MODE=active`、2本のCronを固定値で検査する。ログは`worker/.deploy-logs/`へ保存し、Secret値、Authorization、BMS metadata、D1 row、R2 object keyは記録しない。

デプロイ後は固定URLの`/api/health`と`/difficulty-tables/rc-star`を確認する。確認失敗時も自動rollbackは行わず、ログを保全して手動確認する。

## 対象

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/bms-wip-charts/
- 本番Worker URL: https://bms-wip-charts-worker.monsta3228gsl.workers.dev

## GitHub Pages

静的UIは `docs/` 配下を公開対象とする。

GitHub Pages の設定:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

設定後、以下のURLで公開される想定とする。

https://monsta-bms.github.io/bms-wip-charts/

ブラウザのOriginはパスを含まないため、WorkerのCORSでは `https://monsta-bms.github.io` を許可する。

## フロント設定

`docs/app.js` の `API_BASE_URL` は本番Worker URLを指す。

```js
const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
```

GitHub Pages側は以下を行う。

- ページ表示時に `GET /api/charts` を呼ぶ。
- 投稿フォームから `multipart/form-data` で `POST /api/charts` へ送る。
- 投稿成功後に `GET /api/charts` を再取得する。
- `version.file.downloadUrl` を `API_BASE_URL` と結合してDLリンクを表示する。

## Cloudflare Worker

Worker本体:

- `worker/src/index.ts`

主な設定:

- TypeScript
- CORS対応
- `ALLOWED_ORIGINS` 環境変数
- D1 binding `DB`
- R2 binding `FILES`
- secrets `HASH_SECRET`, `ADMIN_TOKEN`

`worker/wrangler.toml` の `[vars]` では以下を設定する。

```toml
[vars]
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

`ALLOWED_ORIGINS` はカンマ区切りで複数Originを許可できる。後方互換として `ALLOWED_ORIGIN` も読み取るが、今後は `ALLOWED_ORIGINS` を使う。

## Cloudflare D1

作成済みD1 database:

- database_name: `wip-bms-charts-db`
- database_id: `d55ed399-5a31-43a0-89d4-9bd2f32ba3a7`
- Worker binding: `DB`

`worker/wrangler.toml` の設定:

```toml
[[d1_databases]]
binding = "DB"
database_name = "wip-bms-charts-db"
database_id = "d55ed399-5a31-43a0-89d4-9bd2f32ba3a7"
```

### D1 schema / migration

schema / migration:

- `worker/migrations/0001_initial.sql`
- `worker/migrations/0002_file_delete_and_rejected_rules.sql`
- `worker/migrations/0003_progress_graph_fields.sql`
- `schema/d1.sql`

作成されるテーブル:

- `songs`
- `charts`
- `versions`
- `delete_requests`
- `post_logs`
- `bans`
- `admin_logs`

PROG-01の `0003_progress_graph_fields.sql` は、既存の `versions` テーブルへ進捗グラフ用カラムを追加する。

追加対象:

- BMS解析結果: `play_notes`, `first_note_measure`, `last_note_measure`, `target_measure_count`, `measure_notes_json`
- 進捗塗り情報: `progress_map_json`
- 進捗画像metadata: `progress_image_key`, `progress_image_mime`, `progress_image_size`, `progress_image_sha256`, `progress_image_created_at`
- 旧完成後折り畳み状態: `collapsed_by_completion`, `collapsed_reason`, `collapsed_at`, `collapsed_by_version_id`（履歴互換のためカラムは維持するが、新規の完成追記では設定しない）

### Wranglerで適用する場合

remote D1へ適用:

```bash
cd worker
npx wrangler d1 migrations list wip-bms-charts-db
npx wrangler d1 migrations apply wip-bms-charts-db
```

ローカルD1へ適用:

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
npx wrangler d1 execute wip-bms-charts-db --local --command "PRAGMA table_info(versions);"
```

0003適用確認SQL例:

```sql
SELECT name FROM pragma_table_info('versions')
WHERE name IN (
  'play_notes',
  'measure_notes_json',
  'progress_map_json',
  'progress_image_key',
  'collapsed_by_completion'
)
ORDER BY name;
```

index確認SQL例:

```sql
SELECT name FROM sqlite_master
WHERE type='index'
  AND name IN (
    'idx_versions_measure_range',
    'idx_versions_progress_image_key',
    'idx_versions_collapsed_completion',
    'idx_versions_collapsed_by_version'
  )
ORDER BY name;
```

### DashboardからSQL実行する場合

1. Cloudflare Dashboardを開く。
2. Workers & Pages から D1 を開く。
3. database `wip-bms-charts-db` を選択する。
4. Console または Query 画面を開く。
5. `worker/migrations/0003_progress_graph_fields.sql` の内容を貼り付ける。
6. SQLを実行する。
7. `PRAGMA table_info(versions);` でPROG-01の追加カラムを確認する。

Dashboard実行時はmigration履歴には記録されないため、以後Wrangler migrationsで管理する場合はDashboard実行とWrangler実行を混在させない。

`schema/d1.sql` はDashboardで新規DBへまとめて適用するための最新状態ファイルとして扱う。既にmigration適用済みのDBでは、`schema/d1.sql` ではなくmigrationを適用する。

## Cloudflare R2

作成済みR2 bucket:

- bucket_name: `wip-bms-charts-files`
- Worker binding: `FILES`
- 保存形式: Standardのみ

`worker/wrangler.toml` の設定:

```toml
[[r2_buckets]]
binding = "FILES"
bucket_name = "wip-bms-charts-files"
```

R2使用量が8GBを超えた場合は、管理ログに警告を出す仕様とする。

PROG-01の進捗画像は将来R2へ保存する想定だが、今回R2保存処理は実装しない。

将来の進捗画像保存キー例:

```text
charts/{chartId}/versions/{versionId}/progress/progress.png
```

譜面ファイル本体が `file_deleted_at` で削除済みになっても、進捗画像は残す。

## 環境変数

通常のCloudflare Worker環境変数:

- `ALLOWED_ORIGINS`

設定例:

```toml
[vars]
ALLOWED_ORIGINS = "https://monsta-bms.github.io,http://localhost:8787"
```

GitHub PagesのURLは `https://monsta-bms.github.io/bms-wip-charts/` だが、CORSに設定するOriginは `https://monsta-bms.github.io` である。

## 秘密情報

APIキー、トークン、ハッシュ用secretなどの秘密情報はソースコードに直書きしない。

Cloudflare WorkerではCloudflare secretsを使う。

想定secret:

- `HASH_SECRET`
- `ADMIN_TOKEN`

設定例:

```bash
cd worker
npx wrangler secret put HASH_SECRET
npx wrangler secret put ADMIN_TOKEN
```

## ローカル確認手順

```bash
cd worker
npm install
npm run typecheck
npm run dev
```

別のターミナルで確認する。

```bash
curl http://localhost:8787/api/health
curl http://localhost:8787/api/charts
```

D1 migrationをローカルで確認する場合:

```bash
cd worker
npx wrangler d1 migrations apply wip-bms-charts-db --local
```

## デプロイ手順

検査だけを先に実行する。

```text
deploy-worker-check.bat
```

本番反映時だけ次を実行し、固定確認文字列を完全一致で入力する。

```text
deploy-worker.bat
```

PowerShellから実行する場合も専用scriptだけを使用する。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-worker.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-worker.ps1 -Deploy
```

`worker/wrangler.toml` の `[vars]` を変更した場合も、安全検査を通してWorkerを再deployする。

PROG-01ではWorker本体の実装を変更しないため、DB migrationだけで仕様準備は完了する。Worker本体が進捗グラフAPIを返すようになるのは後続フェーズとする。

## 確認手順

- GitHub Pages の公開元が `main` ブランチの `/docs` になっていることを確認する。
- `https://monsta-bms.github.io/bms-wip-charts/` を開く。
- ブラウザ画面に本番Workerの `GET /api/charts` の結果が表示されることを確認する。
- 投稿フォームから `.bms`, `.bme`, `.bml`, `.zip` のいずれかを投稿する。
- 投稿成功後に一覧が自動更新されることを確認する。
- DLリンクが `https://bms-wip-charts-worker.monsta3228gsl.workers.dev/api/files/...` を指すことを確認する。
- CORSエラーが出る場合は、`ALLOWED_ORIGINS` に `https://monsta-bms.github.io` が含まれていることを確認する。
- `ADMIN_TOKEN`、`PASSWORD_HASH_SECRET`、`ABUSE_HASH_SECRET`、`WITHDRAWAL_IDEMPOTENCY_SECRET`、`TURNSTILE_SECRET`、`TURNSTILE_MODE`がCloudflare secretsに設定され、旧共通鍵名が残っていないことを確認する。

## リポジトリ衛生と履歴書換え後の注意

- `.wrangler`はローカル状態、`node_modules`は依存生成物、`.deploy-logs`はローカルログとして扱い、Gitへcommitしない。
- ローカルSQLite／DB、`.dev.vars`、`.env`、credentialファイル、誤ってdirectoryとして作られた`.gitignore`もcommitしない。
- `git add .`の前に`node scripts/test-repository-hygiene.mjs`を実行し、成功した場合だけstageする。
- ローカルの履歴書換えは実施済みだが、GitHubへのforce pushはまだ実施していない。履歴書換え済みcloneから通常のpushを行わない。
- 将来force pushを実施した後は、古いcloneを使用せず新しくcloneする。共同作業者やforkへの影響、branch protection、GitHub cache／Support対応を別手順で確認する。
- 履歴監査でcredential候補が検出された場合、値を文書へ記録せず、関連するcredentialをrotation／revokeしてから本番操作を検討する。

## SECURITY-HASH-DOMAIN-SEPARATION 本番cutover runbook

この順序はWrangler 4.105.0の`versions upload --secrets-file`、`versions deploy <version>@100`、`versions secret delete`、`d1 migrations apply --remote`を前提とする。Secret値をshell引数、console、Git管理下へ出さず、回復用ファイルはrepository外へ置く。

1. ADMIN_TOKENの単独ローテーション済みdeploymentとrepository外の回復用原本を確認する。
2. 現行Workerの通常lifecycleを使い、version 1 withdrawalの`pending`と`processing`を0件にする。Migration前は本番D1へCOUNTだけのread-only SELECTを行い、IDや理由を表示しない。
3. `npx.cmd wrangler d1 time-travel info DB --remote --config .\wrangler.toml`でD1 Time Travel bookmarkを取得し、値を結果manifestへ記録する。自動rollbackは行わない。
4. 互いに独立した新しい`PASSWORD_HASH_SECRET`、`ABUSE_HASH_SECRET`、`WITHDRAWAL_IDEMPOTENCY_SECRET`を暗号学的乱数で生成し、repository外へACLを制限して保存する。旧共通鍵を再利用しない。
5. 新コードと3 Secretを単一candidateへまとめる。repository外の一時secrets fileを用い、`npx.cmd wrangler versions upload --config .\wrangler.toml --secrets-file <repository外path> --tag security-hash-v2 --message "Separate security hash domains" --preview-alias security-hash-v2`を実行する。Wrangler 4.105.0には`versions upload --strict`がないため、`wrangler.toml`の`secrets.required`による不足拒否を使う。省略した既存Secretは削除されない。
6. `versions view <candidate-version-id> --json`でWorker名とbinding名を確認し、必須6 Secret、D1、R2、varsが存在することを名前だけで検証する。previewでhealth、public list、RC、read-only admin、tokenなし／dummy拒否を確認し、書込みfixtureは作らない。version JSONでbinding名を取得できるためdiagnostics routeは追加しない。
7. `npx.cmd wrangler d1 migrations apply DB --remote --config .\wrangler.toml`で0010だけを適用し、Wranglerの適用結果を記録する。過去Migrationは編集しない。
8. `node .\scripts\security-hash-cutover-preflight.mjs --remote --config .\wrangler.toml`を実行する。preflightはMigration前でもpending/processing COUNTを行い、Migration後はschema、production secret名、production旧Secret参照、active withdrawalがすべて合格して`SECURITY_HASH_CUTOVER_READY`になるまでtrafficを切り替えない。candidate Secretは手順5～6で別途確認する。
9. `npx.cmd wrangler versions deploy <candidate-version-id>@100 --config .\wrangler.toml --dry-run -y`を先に通し、その後同じversion IDを`--dry-run`なしの100%でdeployする。traffic splitは行わない。
10. 正式URLでhealth、public list、RC★／RC★★、新ADMIN_TOKENのread-only admin、tokenなし／dummy拒否を確認する。production write fixtureは新規作成しない。旧passwordはversion 1件数とpolicyで失効を確認し、旧hash BANとrate limit履歴が新照合へ引き継がれないことを集計で確認する。
11. `npx.cmd wrangler versions secret delete HASH_SECRET --config .\wrangler.toml --tag remove-legacy-hash-secret --message "Remove retired shared hash secret"`で旧名を除いたfinal versionを作る。そのversionのcode／bindingが直前candidateと同等であることを確認する。
12. final versionを1 version 100%でdeployし、`npx.cmd wrangler secret list --format json --config .\wrangler.toml`でproduction Secret名だけを確認する。旧名0件、新required名すべて存在することを検証し、値は取得しない。
13. `versions view <final-version-id> --json`、`deployments status --json`、health／public／RC／admin／withdrawal集計、post-cutover preflightを再確認する。異常時は自動rollbackせず、直前versionとTime Travel bookmarkを使う手動復旧を別途判断する。旧共通鍵fallbackをコードへ戻さない。
14. 本番cutover完了後に限り、履歴書換え済みcloneからのGit反映可否を報告する。この手順内ではpush／force pushを実行しない。
