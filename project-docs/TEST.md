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

## VERSION-LIFECYCLE-24H-01 確認項目

投稿から24時間以内/以後で分岐する取り消し・削除MVPを確認する:

- 24時間以内かつ派生なしの取り消しで `outcome=immediate_hidden` になること。
- 24時間以内かつ派生なしの削除で `outcome=immediate_hidden` になること。
- `immediate_hidden` 後、一覧から消えること。
- `immediate_hidden` 後もD1 versions行が残り、`is_hidden=1`になること。
- `immediate_hidden` 後もR2譜面ファイルとprogressImageが残り、`file_deleted_at`が設定されないこと。
- 取り消しの即時非表示では`hidden_reason='canceled_within_24h'`と`withdrawn_at`が設定されること。
- 削除の即時非表示では`hidden_reason='deleted_within_24h'`となり、pending削除申請が作られないこと。
- 24時間以内かつ派生ありの取り消しで`outcome=download_blocked`になること。
- 24時間以内かつ派生ありの削除で`outcome=delete_requested`になること。
- 24時間経過後の取り消しで`outcome=download_blocked`になること。
- 24時間経過後の削除で`outcome=delete_requested`になること。
- 取り消し済み、削除申請中、DL不可、没譜面、中間履歴でも`is_hidden=0`の直接子は公開中の派生versionとして数えること。
- `is_hidden=1`の直接子は即時非表示を止める派生versionとして数えないこと。
- `GET /api/charts`の`hasChildVersions`, `hasDescendants`, `childVersionCount`, `visibleChildVersionCount`が公開中の直接子を基準にすること。
- `GET /api/charts`の`totalChildVersionCount`が`is_hidden=1`を含む全直接子数になること。
- 子versionが`is_hidden=1`になった後、24時間以内の親versionを即時非表示できること。
- 取り消し/削除申請後、`download_blocked=1`となりDL不可になること。
- `withdrawn_at`があっても追記投稿できること。
- `delete_requested_at`があっても追記投稿できること。
- `download_blocked=1`だけでは追記拒否されないこと。
- `is_hidden=1`または`is_rejected=1`では追記できないこと。
- 既存の別`download_block_reason`が取り消し/削除操作で上書きされないこと。
- 同一versionのpending申請重複が`DELETE_REQUEST_ALREADY_EXISTS`になること。
- `delete_requests.message`にAPI入力のreasonが保存され、`created_at`が申請日時になること。
- 各version行に投稿日時が表示されること。
- 投稿から24時間以内の行に短い`24h以内`バッジが表示されること。
- 24時間以内かつ派生なしのバッジtooltipで、管理操作により非表示になる可能性が分かること。
- 管理モーダルに投稿日時、経過時間、期限、残り時間、派生version有無が表示されること。
- 管理モーダルに取り消し/削除それぞれの事前説明が表示されること。
- 実行後はAPIの`outcome`別結果メッセージがモーダル内に表示されること。
- 即時非表示で一覧行が消えても、結果メッセージが自動で消えないこと。
- `post_logs`のactionが既存値`withdraw_version` / `request_delete`のままであること。
- `post_logs.detail`に`outcome`, `within24Hours`, `hasDescendants`, `visibleChildVersionCount`, `totalChildVersionCount`, version/chart ID、理由有無と文字数が記録されること。
- password、password_hash、HASH_SECRET、生IP、生UA、削除理由本文がconsole・post_logsへ残らないこと。
- 管理パスワード未入力、誤入力、試行制限の既存挙動が壊れていないこと。
- お気に入り★、数字パス版ラベル、ツリー、中間履歴折り畳み、進捗サムネイルが壊れていないこと。
- DL/追記投稿ボタン、初回投稿・追記投稿フォームが壊れていないこと。
- スマホ幅で投稿日時と管理モーダルが大きく崩れないこと。

## ADMIN-DELETE-01 確認項目

pending削除申請の管理MVPを確認する:

- `docs/admin.html`を直接開けること。
- 公開一覧に管理ページへのリンクが追加されていないこと。
- ADMIN_TOKEN未入力または不正値で一覧を取得できず、`ADMIN_AUTH_REQUIRED`になること。
- WorkerにADMIN_TOKENがない場合は`CONFIG_MISSING`になること。
- 正しいADMIN_TOKENでpending一覧を取得できること。
- pending一覧が申請日時の古い順で表示されること。
- pending一覧に申請日時、理由、曲名、差分名、数字パス版、作者、進捗、version作成日時、公開中の直接子数、履歴上の全直接子数、現在状態が表示されること。
- 一覧APIがpassword_hash、R2 key、requester hash、ADMIN_TOKEN、HASH_SECRETを返さないこと。
- `is_hidden=true`でもpending申請があれば管理一覧に現在状態として表示されること。
- 24時間以内かつ公開中の直接子なしで即時非表示になったversionはpending一覧に出ないこと。
- 末端versionのpending申請を承認できること。
- 承認後に`delete_requests.status='approved'`, `handled_at`, `handled_by`, `admin_note`が設定されること。
- 承認後に`versions.is_hidden=1`, `hidden_reason='delete_request_approved'`, `hidden_at`, `download_blocked=1`になること。
- 既に非表示のversionを承認しても既存の`hidden_reason`が上書きされないこと。
- 承認後もD1 versions行、R2譜面ファイル、progressImageが残り、`file_deleted_at`が設定されないこと。
- `is_hidden=0`の直接子があるversionでは承認ボタンがdisabledになること。
- `is_hidden=0`の直接子がある申請をAPIで承認すると`DELETE_REQUEST_HAS_DESCENDANTS`になり、申請がpendingのまま、version状態も変わらないこと。
- 全直接子が`is_hidden=1`なら`visibleChildVersionCount=0`かつ`totalChildVersionCount>0`と表示され、承認ボタンが有効になること。
- 子versionが`is_hidden=1`になった後、親versionのpending削除申請を承認できること。
- 削除申請中だが表示中の子versionは管理承認のブロック条件に含まれること。
- 取り消し済みだが表示中の子versionは管理承認のブロック条件に含まれること。
- 削除申請を却下でき、adminNote未入力では`INVALID_ADMIN_NOTE`になること。
- 却下後に`delete_requests.status='rejected'`, `handled_at`, `handled_by`, `admin_note`が設定されること。
- 却下後、別のpending申請がなければ`versions.delete_requested_at`が解除されること。
- `download_block_reason='delete_requested'`の場合だけDL制限が解除されること。
- `withdrawn`, `superseded_by_completed_descendant`, `admin_blocked`, `admin_hidden`など他理由のDL制限が解除されないこと。
- `is_hidden=true`のversionを却下しても公開状態へ戻らないこと。
- 同じ申請を二重処理すると`DELETE_REQUEST_ALREADY_HANDLED`になること。
- 承認、却下、直接子による拒否、競合、失敗が`admin_logs`へ記録されること。
- `admin_logs.action`が`approve_delete_request`または`reject_delete_request`になること。
- `admin_logs.detail`にrequest/version/chart ID、公開中・全直接子数、前後状態、outcome/errorCode、管理メモ文字数が入ること。
- ADMIN_TOKEN、password、HASH_SECRET、生IP、生UA、申請理由本文がHTML、console、admin_logsへ残らないこと。
- 承認・却下後に管理一覧が再取得され、処理結果が画面に表示されること。
- スマホ幅でも一覧確認、承認、却下が操作できること。
- 公開一覧、初回投稿、追記投稿、DL、24時間ルール、進捗マップ、進捗画像、ツリー、中間履歴、お気に入りが壊れていないこと。

## R2-CLEANUP-01 確認項目

- `GET /api/admin/r2-cleanup-candidates`と`POST /api/admin/r2-cleanup/:versionId/delete-file`は正しいADMIN_TOKENが必須であること。
- WorkerにADMIN_TOKENがない場合は`CONFIG_MISSING`になること。
- `hidden_at`から30日未満のversionは候補に出ないこと。
- `hidden_reason='delete_request_approved'`かつ30日以上経過したversionが候補に出ること。
- `hidden_reason='deleted_within_24h'`かつ30日以上経過したversionが候補に出ること。
- `hidden_reason='canceled_within_24h'`または`admin_hidden`のversionは候補に出ないこと。
- `download_blocked=1`でも`is_hidden=0`の公開中versionは候補に出ないこと。
- `hidden_at IS NULL`または`file_deleted_at IS NOT NULL`のversionは候補に出ないこと。
- 候補APIがraw R2 key、ADMIN_TOKEN、secretを返さないこと。
- 候補一覧の`olderThanDays`が30未満の場合はサーバー側で30へ丸められること。
- `confirm='DELETE_R2_FILE'`なしでは削除できず、`CLEANUP_CONFIRM_REQUIRED`になること。
- `expectedHiddenAt`不一致では`CLEANUP_EXPECTED_VALUE_MISMATCH`になり、R2/D1を変更しないこと。
- 指定した`expectedFileSha256`不一致では`CLEANUP_EXPECTED_VALUE_MISMATCH`になり、R2/D1を変更しないこと。
- 実行時に対象条件をD1で再判定し、条件外なら`CLEANUP_TARGET_NOT_ELIGIBLE`になること。
- R2譜面objectが存在する場合、削除成功後に`file_deleted_at`と`file_delete_reason='r2_cleanup_deleted'`が入ること。
- R2譜面objectが既にない場合、`outcome='r2_object_missing_reconciled'`で`file_delete_reason='r2_object_missing_during_cleanup'`が入ること。
- R2 key欠落時もD1修復し、`admin_logs.detail.errorCode='CLEANUP_R2_KEY_MISSING'`が記録されること。
- R2削除失敗時は`file_deleted_at`が設定されないこと。
- `file_deleted_at IS NOT NULL`への再実行は`outcome='already_deleted'`になること。
- `file_deleted_at IS NOT NULL`の`GET /api/files/:fileId`はR2へアクセスせず、HTTP 410 `FILE_DELETED`になること。
- cleanup後も`progress_image_key`と進捗画像R2 objectが残り、`GET /api/progress-images/:versionId`の既存方針が維持されること。
- cleanup成功は`admin_logs.action='r2_cleanup_delete_file'`、失敗は`r2_cleanup_delete_file_failed`で記録されること。
- `admin_logs.detail`にversion/chart、hidden reason/at、保持日数、R2 key有無、outcome/errorCode、file_deleted_at、SHA-256有無、fileSizeが入り、ADMIN_TOKEN、secret、生IP、生UA、raw R2 keyが残らないこと。

## BAN-01 確認項目

- 正しい`ADMIN_TOKEN`で`GET /api/admin/post-logs`から最近の投稿ログを取得できること。
- 投稿ログ一覧には短縮`ipHashShort` / `uaHashShort` / `fileSha256Short`だけが表示され、full hash、生IP、生UAがAPI・HTML・consoleに出ないこと。
- `unknown` IP marker由来のログでは`canBanIp=false`となり、IP BAN作成ボタンが無効になること。
- 投稿ログから`ip_hash` BANを作成できること。
- `file_sha256`が記録された投稿ログからfile SHA BANを作成できること。
- UA BANの作成導線およびIP+UA組み合わせBANがないこと。
- BAN理由が必須で、空または長すぎる値は`INVALID_BAN_REASON`になること。
- `duration`が`24h`, `7d`, `30d`, `permanent`以外なら`INVALID_BAN_DURATION`になること。
- source logに対象hashがない場合は`BAN_SOURCE_HASH_NOT_AVAILABLE`になること。
- BAN作成後、同じIPからの初回投稿がmultipart解析前にHTTP 403 `POSTING_BLOCKED`になること。
- BAN作成後、同じIPからの追記投稿がmultipart解析前にHTTP 403 `POSTING_BLOCKED`になること。
- file SHA BAN対象ファイルはSHA計算後、R2保存・D1 version作成前に`POSTING_BLOCKED`になること。
- BAN拒否レスポンスがbanId、banType、banValue、hash、詳細期限を返さないこと。
- BAN拒否が既存action、`result=rejected`, `error_code=POSTING_BLOCKED`で`post_logs`に記録され、detailにraw hashや生IP/UAがないこと。
- BAN判定DB障害または`HASH_SECRET`未設定時に`BAN_CHECK_FAILED`でfail closedになること。
- active/expired/disabled/allのBAN一覧を取得でき、full `ban_value`が返らないこと。
- BAN解除後、同じ投稿元またはファイルで投稿できること。
- 同一BANの再作成で既存行が再有効化されること。
- 既に解除済みのBAN解除が`already_lifted`として冪等成功すること。
- `expired_at`経過後は投稿でき、BAN一覧ではexpiredになること。
- BAN中でも公開一覧閲覧、DL、取り消し、削除申請、管理操作、管理承認/却下、R2 cleanupが従来通り動作すること。
- BAN作成・解除が`admin_logs`の`create_ban` / `lift_ban`に記録されること。
- `admin_logs.detail`に短縮hash、sourcePostLogId、期間、結果、エラーコード等だけが入り、full hash、生IP、生UA、ADMIN_TOKEN、HASH_SECRET、解除理由本文が残らないこと。
- 既存の初回投稿、追記投稿、管理承認/却下、R2 cleanup、progressMap、progressImageが壊れていないこと。

## POST-RATE-LIMIT-01 確認項目

- 上限未満では初回投稿・追記投稿が従来のmultipart処理へ進むこと。
- 初回投稿がacceptedの10分3件、1時間10件、24時間30件の各上限でHTTP 429 `POST_RATE_LIMITED`になること。
- 追記投稿がacceptedの10分5件、1時間20件、24時間60件の各上限でHTTP 429 `POST_RATE_LIMITED`になること。
- allowlist内のclient起因rejectedが初回・追記合算で10分10件、1時間30件に達すると429になること。
- `POSTING_BLOCKED`, `POST_RATE_LIMITED`, `BAN_CHECK_FAILED`, `POST_RATE_LIMIT_CHECK_FAILED`を件数へ含めないこと。
- DB/R2/config/Worker起因rejectedを件数へ含めないこと。
- BAN中かつrate limit超過中はHTTP 403 `POSTING_BLOCKED`が優先されること。
- rate-limit拒否時にprogressImageを含むmultipart解析、R2保存、songs/charts/versions作成が行われないこと。
- rate-limit拒否時に既存action、`result='rejected'`, `error_code='POST_RATE_LIMITED'`, `file_sha256=NULL`のpost_logが残ること。
- rate-limit拒否ログのdetailに生IP、生UA、full hashが含まれないこと。
- `POST_RATE_LIMITED`を連打しても解除時刻が延長されないこと。
- 時間窓外になると投稿可能になること。
- 異なる`ip_hash`へ影響しないこと。
- ローカルでIP marker不明の場合はレート制限をスキップし、共通unknownバケットを作らないこと。
- production相当でIP marker不明の場合はmultipart前にHTTP 503 `POST_RATE_LIMIT_CHECK_FAILED`になること。
- D1集計失敗時はHTTP 503 `POST_RATE_LIMIT_CHECK_FAILED`でfail closedになること。
- `Retry-After`ヘッダーと本文`retryAfterSeconds`が一致すること。
- 複数ルール違反時は解除までの残り時間が最長のルールを返すこと。
- 既存の管理パスワード失敗`RATE_LIMITED`、BAN、取り消し、削除申請、管理API、R2 cleanup、DL、公開一覧が壊れていないこと。
- D1 schema、migration、index、R2仕様、Secret、Binding、Pages/管理UIに変更がないこと。
- 管理画面のR2 cleanupセクションが削除申請管理と分離され、1件ごとに確認文字列を要求すること。
- cleanup実行後に候補一覧が再読み込みされ、progressImage保持が画面に明記されること。
- 公開一覧、投稿、追記、DL制御、取り消し、削除申請、管理承認/却下、お気に入りが壊れていないこと。

既存データ確認SQL:

```sql
-- 厳格なMVP候補
SELECT COUNT(*)
FROM versions
WHERE is_hidden = 1
  AND download_blocked = 1
  AND file_deleted_at IS NULL
  AND hidden_at IS NOT NULL
  AND hidden_at <= datetime('now', '-30 days')
  AND hidden_reason IN ('delete_request_approved', 'deleted_within_24h');

-- 非表示だが譜面ファイル削除未記録
SELECT id, hidden_reason, hidden_at, file_deleted_at
FROM versions
WHERE is_hidden = 1
  AND file_deleted_at IS NULL;

-- DL不可だが公開中。cleanup対象外
SELECT id, download_block_reason, download_blocked_at
FROM versions
WHERE download_blocked = 1
  AND COALESCE(is_hidden, 0) = 0;

-- 譜面ファイル削除記録済み
SELECT id, file_deleted_at, file_delete_reason
FROM versions
WHERE file_deleted_at IS NOT NULL;
```

## FAV-01 確認項目

投稿一覧version行のお気に入り★機能を確認する:

- version行にお気に入り★buttonが表示されること。
- ★buttonが版ラベル右側に表示され、DL/追記投稿の操作列に混ざらないこと。
- 未登録状態は薄い星で表示されること。
- クリックで黄色い★になること。
- 再クリックでお気に入り解除されること。
- ページ再読み込み後もお気に入り状態が維持されること。
- localStorage key `bms-wip-charts:favorites:v1` にversionId単位のmap形式で保存されること。
- localStorageの保存値に `versionId`, `chartId`, `songTitle`, `chartName`, `versionLabel`, `branchPath`, `favoritedAt` がsnapshotとして入ること。
- localStorageが壊れていても一覧全体が壊れないこと。
- お気に入りのみトグルONで favorite version と祖先versionだけが表示されること。
- お気に入りversionを含むchartだけが表示されること。
- お気に入りのみトグルOFFで通常一覧に戻ること。
- 中間履歴内のお気に入りversionがフィルタON時に見えること。
- フィルタOFF時の中間履歴折り畳み挙動が壊れていないこと。
- DL不可versionもお気に入りできること。
- 完成versionもお気に入りできること。
- isRejected=true のversionもお気に入りでき、追記不可表示など既存状態は維持されること。
- ★buttonがDL/追記投稿ボタンと干渉しないこと。
- 難易度★とお気に入り★が色、位置、サイズで視覚的に区別できること。
- ツリー表示が崩れないこと。
- 進捗サムネイルが崩れないこと。
- スマホ幅で大きく崩れず、★buttonとお気に入りのみトグルが押せること。

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

## PROG-04D-FIX5 確認項目

一覧サムネイルでR2保存済みPNGがどこで止まっていないか確認する:

- `GET /api/charts` に `progressImage.url` または `progressImageUrl` があるversionでは、DOMに `.progress-thumbnail.has-progress-image` が生成されること。
- `GET /api/charts` に `progressImage.url` または `progressImageUrl` があるversionでは、DOMに `img.progress-thumbnail-image` が生成されること。
- DevTools Consoleで `window.debugProgressThumbnails()` を実行できること。
- `window.debugProgressThumbnails()` の `hasProgressImageCount` が1以上になること。
- `window.debugProgressThumbnails()` の `imageElementCount` が1以上になること。
- `window.debugProgressThumbnails()` の `dataProgressImageSrcSamples` に `/api/progress-images/:versionId` を含むURLが入ること。
- `window.debugProgressThumbnails()` の `imgSrcSamples` に本番Workerの `/api/progress-images/:versionId` 絶対URLが入ること。
- `window.debugProgressThumbnails()` で `hasScheduleProgressImageThumbnailMount` が `true` になること。
- `window.debugProgressThumbnails()` で `hasRenderProgressThumbnail` が `true` になること。
- `progressImage.url` が相対URLでも `API_BASE_URL` と結合されること。
- Chrome DevTools Networkで `progress-images` を検索したとき、`/api/progress-images/:versionId` のリクエストが出ること。
- `/api/progress-images/:versionId` のStatusが `200` になること。
- `/api/progress-images/:versionId` のTypeが `png` になること。
- `progressImage.url` があるversionではR2 PNGが優先表示されること。
- `progressImage.url` がないversionでは `progressMap` fallbackになること。
- `img.onerror` の場合だけ `progressMap` 再描画へfallbackすること。
- `branch-tree-list.js` のツリー表示後でもR2 PNG優先表示が維持されること。
- `blob:` URLは一覧サムネイルでは使われないこと。

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
