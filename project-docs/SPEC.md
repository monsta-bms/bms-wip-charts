# BMS WIP Charts 仕様書

## POST-FORM-TREE-12 ファイル欄整列・要約・版ツリー接続

解析済みファイル欄は、単体BMS/BME/BMLでは「解析完了・外側ファイル名・block数/サイズ」を1行に置き、空の補助行を作らない。ZIPでは同じ主行の下に内部BMS名を補助行として追加する。変更・解除はファイル表示とは別の操作領域に置き、PCでは表示欄の中央、スマホでは表示欄の下へ整列する。

閉じた投稿フォームの要約には作者名を表示しない。選択中ファイル名と、選択済みの場合の難易度だけを表示対象とし、作者名だけが入力されている場合は要約を表示しない。入力値、dirty判定、確認ダイアログ、作者・管理パスワードの端末保存仕様は変更しない。

版ツリーは表示中versionから親子エッジを構築し、各子エッジの縦幹を親ノードからラベルへ伸びる水平リンク上から開始する。depthごとにノードX座標を進め、兄弟は同じ親幹を共有する。孫以降は直近親の水平リンクから新しい幹を開始し、BASEの幹へ誤接続しない。縦幹から子ノードへは短い角丸エルボーで接続し、子を持たない末端ノードから下方向へ線を描かない。

親判定は`parentVersionId`を元に構築した`parentBranchPath`を優先し、数字パスは表示と座標計算に使用する。折り畳み中は省略仮想ノードを親子間へ挿入し、展開・再折り畳みのたびに表示行からSVGオーバーレイを再計算する。同じ描画規則をトップの最近の投稿と選択中の投稿へ適用し、tree zone幅と最大depthに応じてindentを縮める。

## POST-FORM-UX-11 配色・整列と端末保存設定

解析済みファイル欄は、状態、外側ファイル名、block数・サイズ、変更・解除の共通骨格を使う。ZIPでは補助行へ内部BMS名を表示し、単体BMS/BME/BMLでは補助行を作らず主情報を1行で中央配置する。長い名前は省略し、titleで全文を確認できるようにする。

開いた投稿フォームは、パネル`#eef2f1`、セクション`#e4ebe9`、操作面`#d5e1dd`、入力面`#fafbfb`を基調とする。左アクセント線、入力面との明度差、控えめな青緑灰色を維持し、全周枠、強い影、大面積の濃緑は追加しない。補助ボタンは操作面より濃い背景と輪郭を持ち、通常、hover、active、disabledを判別できるようにする。進捗操作帯は操作面色と輪郭を使い、差分情報は「譜面情報」と「作者情報」の小見出し、薄い背景差、区切り線で識別する。

差分作者の端末保存キーは`bms-wip-charts:author:v1`、管理パスワードは既存互換の`bms-wip-charts-admin-password`とする。保存値がある場合だけ対応inputへ自動復元してチェックをONにし、復元値とチェックをフォームの既定値として扱う。自動復元、保存チェック変更、保存情報削除だけでは離脱確認を発生させず、復元後に作者またはパスワードを編集した場合は未送信変更として扱う。

作者・パスワードのチェックをONにしただけ、または初回・追記APIの送信前にはlocalStorageへ書き込まない。初回投稿または追記投稿のAPI成功後だけ共通preferences controllerで保存を確定し、その後のform resetで保存値だけを復元する。投稿失敗時は新しい値を保存せず、以前の保存値、現在の入力、チェック状態を維持する。チェックOFF時は対応する保存値だけを即時削除し、現在のinput値は消さない。

「保存情報を削除」は確認後に作者・管理パスワードの2キーを削除し、2つの保存チェックをOFFにするが、入力中の値は維持する。localStorageの読込・保存・削除失敗は投稿を妨げず、API成功後の保存失敗は非ブロッキング通知とする。ログにはcode、stage、errorTypeだけを記録し、作者、パスワード、保存値を出力しない。投稿管理dialogは同じcontrollerから保存済み管理パスワードを読む。

## POST-FORM-UX-10 解析状態とフォーム視線導線

投稿フォームのファイル状態は、未選択を「クリックまたはドロップ」、ドラッグ中を「ここに離してください」、解析中を「解析中…」、成功を「✓ 解析完了」と表示する。解析成功時はファイル名、ZIP内部譜面名、block数、ファイルサイズ、ミニビュー非対応の補足、変更・解除を維持する。長い名前は省略表示し、titleで全文を確認できるようにする。

差分情報は「譜面情報」と「作者情報」へ分ける。譜面情報には想定難易度と差分名、作者情報には差分作者を置き、「一覧に表示する作者名です。別名義でも構いません。」と補足する。PCではおおむね68:32の2領域、760px以下では譜面情報、作者情報の順に1列表示する。既存の難易度縮小・変更・手入力・reset・追記初期値・validationは維持する。

進捗度inputは密度グラフ・進捗レール・小節ラベルの直下へ置き、完成版・没譜面・追記受付はその下の投稿状態パネルへまとめる。完成版ボタンは常時表示し、初回投稿では常にdisabled、追記投稿では進捗80%未満をdisabled、80%以上の未指定時だけ有効とする。進捗概要、block塗り、drag、親layer、miniView、PNG生成は変更しない。

フォーム全体は白、入力セクションは`#f3f7f6`、ファイル・進捗の操作面は`#eaf2ef`、inputとtextareaは白として明度差を付ける。左アクセント線は`#9ebbb3`を使用し、全周枠やshadowを増やさない。

## POST-FORM-UX-09A レイアウト圧縮と視線導線

解析済みファイル欄は、ファイル名、ZIP内部譜面名、block数、ファイルサイズ、変更・解除をPCでは1～2行へまとめる。未選択、解析中、解析エラーの表示寸法は従来どおりとする。長い名前は操作ボタンを押し出さず省略し、760px以下では情報と操作を複数段へ折り返す。

想定難易度は未選択または手入力中のみピッカーを展開し、数字・記号の選択直後、手入力確定後、追記元からの初期設定後は「選択値・変更」の要約表示へ縮小する。変更操作で現在値を維持して再展開し、難易度のvalidationエラーでは自動展開する。初回・追記投稿成功、追記キャンセル、form resetでは未選択の展開状態へ戻す。hidden inputと送信値は変更しない。

差分情報は、難易度ピッカー展開時は難易度を左列2行、差分名と作者を右列へ配置し、要約時は3列へ圧縮する。進捗度は進捗マップ上部へ88px幅のnumber inputと`%`単位で表示する。完成版操作は没譜面・追記受付とともに進捗グラフ下の投稿状態パネルへ置き、進捗概要は`ノーツ / 区間 / 小節`の日本語表示とする。

フォーム最下部はPCでコメント約60%、管理レール約40%の2列とする。管理レールは管理パスワード、保存設定、Turnstile、追記キャンセル、投稿操作の順とし、920px以下はコメントから投稿操作まで1列へ積む。セクションは左アクセントだけを残して全周枠と背景差を弱める。localStorage、パスワード保存時機、validation、エラー表示、FormData、Worker APIは変更しない。

## POST-FORM-UX-08 ファイル選択とフォーム階層

閉じた投稿フォームの見出し領域と、開いたフォーム内の譜面ファイル欄をファイルドロップ対象とする。`DataTransfer.types`に`Files`があるドラッグだけを処理し、通常の文字列・リンクドラッグには干渉しない。ドロップしたファイルは既存の`#chartFile`へ`DataTransfer`で設定して`change`を1回だけ発火し、初回投稿と追記投稿の既存ローカル解析経路へ渡す。対応形式はBMS/BME/BML/ZIP、ブラウザ側の事前上限はBMS単体2MiB、ZIP 5MiBとする。

ファイル欄は空、ドラッグ中、解析中、解析済み、エラーの状態を持つ。解析済みでは外側ファイル名、ZIPの場合は既存ローカル解析が返した内部譜面名、ブロック数を表示する。ZIPを表示用に再展開しない。変更・解除・初回/追記切替・追記キャンセル・投稿成功後resetでは、既存revision管理とともに古いファイル表示、進捗マップ、ローカルminiViewを破棄する。

進捗欄はファイル未選択時に案内文だけを表示し、解析中は短い状態文、解析成功後だけ密度グラフ、編集ブロック、進捗度と投稿状態パネルを表示する。完成操作はパネル内へ常時表示し、初回投稿、没譜面、追記80%未満ではdisabled、追記80〜100%では未指定時に有効とする。公開フォーム内の進捗PNG確認UIは表示しないが、`BmsProgressImage`のCanvas/Blob/進捗マップ生成関数とFormDataへの`progressImage`添付は維持する。

フォームは「譜面ファイル」「楽曲情報」「差分情報」「進捗」「管理・コメント・投稿」の5区分とする。`originUrl`は楽曲情報へ置き、追記時のWorker継承、ID/name、送信仕様は変えない。ネイティブfile inputはFormData、required、既存イベントのためDOMに保持し、見える操作はキーボード対応buttonのドロップゾーンへ集約する。

## POST-FORM-MINIVIEW-01 投稿フォームのローカル譜面ミニビュー

初回投稿と追記投稿では、選択中の単体BMS/BME/BMLまたはZIP内の唯一のBMS/BME/BMLをブラウザ内で1回だけ読み込み、既存の進捗解析とローカルminiView生成で同じdecoded textを共有する。ZIPは既存の安全なブラウザ抽出処理が返したbufferと内部ファイル名を再利用し、hoverごとの再読込・再展開・Workerへの事前送信は行わない。

ローカルminiViewはWorkerのschemaVersion 3と同じ7key SP判定、正確な分数イベント、変拍子、LNOBJ/LNTYPE 1、BPM、50,000イベント、32KiB payload上限を使用する。クライアント生成payloadは表示専用のメモリデータであり、FormData、D1、R2へ保存しない。投稿時の正データと検証結果は従来どおりWorkerがアップロードファイルを再解析した結果とする。miniView未対応や生成失敗だけを理由に投稿を拒否しない。

フォームの密度Canvasには読み取り専用navigatorを重ね、hover/focus/tap、クリック固定・直接切替、左右キー、Home、End、Escを一覧と同じ吹き出しCanvasへ接続する。進捗を塗る編集blockは別領域のまま維持し、ミニビュー固定操作を割り当てない。追記時は今回選択した新ファイルを表示し、親progressMapとのblock格子が一致する場合だけpreviewを有効化する。

ファイル変更、選択解除、初回・追記モード切替、ZIP解析失敗、未対応譜面、追記キャンセル、投稿成功後のresetではローカルpayloadと吹き出し状態を破棄する。非同期解析はフォームごとの単調増加revisionで世代管理し、古いファイルの完了結果を現在のフォームへ反映しない。

## CHART-MINIVIEW-01 譜面ミニビュー

新規の初回投稿・追記投稿について、WorkerがBMS本体を解析して7key SP譜面のコンパクトなミニビューを生成する。単体BMSはアップロードされた本体、ZIPは安全検査で展開済みの唯一のBMS/BME/BMLバイト列を利用する。ブラウザ生成値は保存せず、Worker生成結果を正データとする。R2へ派生画像・JSONは保存しない。

MVPの対応レーンは1P側の通常鍵盤`11-15,18,19`、スクラッチ`16`、LNTYPE 1のLN鍵盤`51-55,58,59`、LNスクラッチ`56`とする。`#LNOBJ`も対応する。7key判定は`.bme`または6/7鍵チャンネルの実使用を根拠とし、5keyとの区別が曖昧な場合は推測表示しない。2P、10key/14key、PMS、LNTYPE 2、地雷、特殊配置、RANDOM/IF/SWITCH系、未閉鎖・競合LNはミニビュー未対応とする。

`versions.measure_notes_json`は新規解析成功分からschemaVersion 3とし、schemaVersion 2の全フィールドを維持したまま`miniView`を追加する。CHART-MINIVIEW-UX-03以降のminiView payloadはschemaVersion 3とし、通常ノート、LN開始・終了を`measure / lane / pairIndex / pairCount / kind`単位で保持する。同じ小節・レーン・種別・分母のイベントをまとめたvarint列をBase64保存し、24分・32分・48分を含む元の分数位置を丸めない。初期BPMとchannel 03/08のBPM変化は同じ分数座標のtupleで追加する。保存する`miniView`全体は32KiB以下とし、超過時は`MINIVIEW_TOO_COMPLEX` warningとしてunsupported metadataだけを保存する。D1 migration、R2派生データ、`progressImage`は追加しない。

一覧APIは完全なイベントpayloadを返さず、各versionの`miniView.available`、`mode`、専用取得URLだけを返す。公開中かつ精密payloadを持つversionだけ`GET /api/versions/:versionId/mini-view`でpayloadを取得できる。非表示version、非表示chart、measure notes schemaVersion 2、旧miniView payload schemaVersion 1、unsupportedは`MINIVIEW_NOT_AVAILABLE`とする。レスポンスはETagと短時間キャッシュを使用する。

Pagesは既存進捗サムネイルとは別にCanvas 2Dの縦型ミニマップを表示する。IntersectionObserverで画面付近の可視行だけ取得し、折り畳み中の行は取得しない。同時取得は最大4件、versionId単位でメモリキャッシュし、devicePixelRatioは最大2とする。buttonとしてクリック/Enterに対応し、native dialogで拡大、Escで閉じられるようにする。

CHART-MINIVIEW-UX-01では、進捗サムネイル全体へ単一の操作レイヤーを重ね、ポインタ位置または左右キーから`progressMap.blocks`の実ブロック番号を選択する。hover/focus/tap時は画面内で再利用する吹き出しCanvasを1つだけ表示し、そのブロックの正確な`startPosition`以上`endPosition`未満に対応するminiView範囲を拡大描画する。hoverごとのAPI取得は行わず、既存のversionIdメモリキャッシュを使用する。クリックdialogは全譜面確認用として維持する。

CHART-MINIVIEW-UX-02では、一覧右側の常時全体ミニビューを廃止し、進捗ブロック連動の吹き出しを主表示とする。吹き出しは黒系背景、16分・1拍・小節境界の3段階グリッド、白鍵・青鍵・スクラッチ・LNの色分け、右側の小節番号帯を使用し、曲進行を下から上へ描画する。固定中に別ブロックをクリックした場合は解除を挟まず固定先を切り替え、同一ブロックの再クリック、Esc、外側操作で解除する。miniView未対応versionは進捗メタ欄へ控えめな非対応表示を出す。

CHART-MINIVIEW-UX-03では、小節開始線を`#E8E8E8`、1拍線を`#4A4A4A`、16分線を`#2C2C2C`として優先度を明確化する。ノート矩形とLN端点は数学上のイベント位置を変えず、Canvas上だけ1.5px上へオフセットする。LN本体は端点マーカー中心へ接続し、端点を明色、本体を同系暗色とする。BPMは縦座標を伸縮させず、左側の専用注釈帯へblock開始時の有効値とblock内変更を緑色で表示する。miniView payload schemaVersion 2はBPMなしで引き続き表示し、schemaVersion 1だけを非対応とする。

CHART-MINIVIEW-UX-04では、拡大Canvasの通常ノートとLN端点を少し厚くし、数学上のイベント位置を維持したまま視覚オフセットを0.9pxへ弱める。block開始時点の有効BPMは吹き出し上部の情報欄へ表示し、左側の緑色注釈帯はblock内部でBPMが変化する場合だけ表示する。block開始境界上のBPM変更は開始時BPMとして扱い、block終了境界上の変更は次blockへ送る。

CHART-MINIVIEW-UX-05では、BPM注釈の表示区間を`blockStart <= position < blockEnd`とし、開始境界上の変更は上部の現在BPMと左側注釈の両方へ表示する。注釈線は正確なイベント位置を維持し、文字位置だけをCanvas内へclampする。吹き出し幅はデスクトップで最大340pxとし、小節見出しと右側情報は折返し単位を分離する。小節番号帯は表示範囲の番号をCanvasで実測し、36pxを最小幅として3桁・4桁以上へ動的に拡張する。

CHART-MINIVIEW-UX-06では、拡大Canvasの左側BPM注釈帯を変更有無にかかわらず44px、鍵盤との間隔を4pxで固定する。変更なしblockは背景と枠だけを表示し、変更ありblockだけ同じ帯内へ緑色の変更値とマーカーを描く。現在BPMは引き続き上部情報欄だけへ表示し、中央の鍵盤領域と右側小節番号帯のX座標・幅をblock移動で変化させない。

CHART-MINIVIEW-UX-07では、吹き出しを同じ進捗サムネイル内で開いている間は初回だけ配置し、block切替後の再配置を行わない。scroll、resize、target変更、再表示時だけ配置を更新する。headerを20px、hintを15pxの固定高かつ1行表示とし、長い右側情報は折返さず省略する。右側小節番号帯は表示blockではなくversion全体の開始・終了小節番号から幅を決め、同じversion内で鍵盤領域と番号帯のX座標・幅を固定する。

音楽位置は`measureStart[m] = mより前のmeasureLength合計`、`eventPosition = measureStart[measure] + pairIndex / pairCount * measureLength[measure]`で定義する。`#xxx02`省略時の小節長は1.0とし、BPM/STOPは縦位置へ反映しない。progressMap blockは同じ座標系の`startPosition/endPosition`を保持し、境界ぴったりで終了するblockへ次小節を含めない。16分線は各小節開始から0.0625、1拍線は0.25、小節線は累積小節境界に描き、0.75小節は通常小節の75%の高さとする。スクラッチ幅は通常鍵盤の1.5倍とし、通常7鍵は等幅を維持する。初期BPM、channel 03の16進BPM、`#BPMxx`とchannel 08の拡張BPMを扱い、同位置ではソース上で後に解析した有効値だけを残す。旧miniView payload schemaVersion 1は不正確な拡大表示へfallbackせず、ミニビュー非対応として扱う。

ミニビュー生成失敗や未対応構文は投稿拒否理由にせず、`MINIVIEW_UNSUPPORTED_MODE`、`MINIVIEW_RANDOM_UNSUPPORTED`、`MINIVIEW_LNTYPE2_UNSUPPORTED`、`MINIVIEW_MALFORMED_LN`、`MINIVIEW_TOO_COMPLEX`、`MINIVIEW_GENERATION_FAILED` warningを返す。既存schemaVersion 2は再解析せず、従来の進捗サムネイル表示を維持する。

## TURNSTILE-01 投稿認証

初回投稿`POST /api/charts`と追記投稿`POST /api/charts/:chartId/versions`にCloudflare Turnstile Managed widgetを適用する。閲覧、DL、取り消し、削除申請、管理API、難易度表、Cron、R2 cleanupは対象外とする。Turnstileの結果だけで自動BANは行わない。

Pagesは初回・追記で同じwidgetを共用し、explicit rendering、`execution=execute`、`appearance=interaction-only`、共通action `chart_submit`を使用する。ローカル入力検証後の投稿操作時にtokenを取得し、`X-Turnstile-Token`ヘッダーでWorkerへ送る。POST試行後は成功・失敗を問わずwidgetをresetするが、API失敗時のフォーム入力は保持する。Turnstile scriptを読み込めない場合は送信せず、画面内の再読込操作を提供する。

Workerの処理順はCORS、fingerprint生成、BAN、投稿レート制限、Turnstile、multipart解析、file SHA BAN・重複確認、ZIP/BMS解析、R2保存、D1保存とする。BANの`POSTING_BLOCKED`と投稿レート制限の`POST_RATE_LIMITED`をTurnstileより先に判定する。Siteverifyは5秒timeout、同じidempotency keyによる最大1回の再試行、token最大2048文字、hostnameとactionの検証を行う。hostnameはリクエストOriginと`ALLOWED_ORIGINS`の許可hostnameに一致させる。token、Secret、生IP、生UA、生のSiteverifyレスポンスは保存・ログ出力しない。

設定はGit管理外のWorker Secret `TURNSTILE_SECRET`と`TURNSTILE_MODE`を使用する。`TURNSTILE_MODE=observe`は旧Pagesとの段階移行専用で、tokenなしや検証失敗を安全な分類だけconsoleへ記録して投稿を許可する。`required`または未設定・不正値ではtokenなし、検証失敗、設定不足、検証不能を拒否する。本番の最終状態は必ず`required`とする。Pagesの公開sitekeyは`meta[name=turnstile-sitekey]`へ設定する。localhostではproduction sitekeyではなくCloudflare公式テストsitekeyを使用する。

required時の拒否は既存`post_logs`へ`result=rejected`、`stage=pre_multipart_turnstile`、error code、再試行有無、判定分類だけを記録する。`TURNSTILE_REQUIRED`と`TURNSTILE_FAILED`は利用者起因の投稿失敗レート制限へ含め、`TURNSTILE_UNAVAILABLE`は含めない。D1 schema、R2保存形式、既存BAN・管理パスワード制限・ZIP安全検査は変更しない。

## 目的

BMS差分をログイン不要で共有できる1ページサイトを作る。初回投稿と追記投稿を受け付け、作成途中の差分譜面を進捗マップ付きで共有できるようにする。

## 公開情報

- リポジトリ名: `bms-wip-charts`
- GitHub Pages URL: https://monsta-bms.github.io/bms-wip-charts/
- 本番Worker URL: https://bms-wip-charts-worker.monsta3228gsl.workers.dev

## 現在の実装範囲

実装済み:

- GitHub Pages の静的1ページUI
- GitHub Pages から本番Worker APIへの一覧取得、初回投稿、追記投稿UI
- 一覧側のversion分岐ツリー表示
- 一覧側の完成到達後の中間version折り畳み/展開UI
- `GET /api/charts` のD1実データ読み取り
- `POST /api/charts` の初回投稿
- `POST /api/charts/:chartId/versions` の追記投稿
- `GET /api/files/:fileId` のR2実ダウンロード
- `GET /api/progress-images/:versionId` のR2進捗画像取得
- 没譜面初回投稿の `progress=100` 強制
- Worker側BMS解析による `play_notes` / 小節情報保存
- フロント側進捗マップUI
- 初回投稿時と追記投稿時の `progress_map_json` 保存
- フロント側での進捗PNG生成、FormData添付、R2保存
- `versions.progress_image_*` metadata保存
- 一覧側の `progressMap` ベース密度サムネイル表示と `progressImage.url` fallback表示
- 分岐version管理、`branch_path` 生成、完成到達時の親version DL不可化
- `versions.file_deleted_at` / `versions.file_delete_reason` の自動削除準備カラム
- versionId単位のブラウザ内お気に入り★とお気に入りのみ表示
- 投稿者管理パスワードによるversion取り消し・削除申請MVP

未実装:

- ZIP内部のBMS解析
- 難易度表API
- 検索
- ページング本実装
- 管理画面
- Cron Trigger
- R2自動削除本体
- Turnstile
- 本格的な譜面ミニビュー

## 画面仕様

### 全体構成

- 1ページサイトとする。
- ページ上部に投稿フォームを表示する。
- ページ下部に投稿一覧を表示する。
- ログインは不要とする。
- 管理人承認は行わず、投稿後すぐ公開する。

### 投稿フォーム

フォームは以下のセクションに分ける。

1. 譜面ファイル
2. 楽曲情報
3. 差分情報
4. 進捗
5. 管理・コメント・投稿

必須項目:

- 譜面ファイル
- 曲名
- アーティスト
- 差分名
- 想定難易度
- 差分作者
- 進捗度
- 管理パスワード

通常フォームでは `level` の見える入力欄を表示しない。ユーザーが入力・閲覧する難易度は「想定難易度」に統一する。

### 追記投稿UI

一覧の各version行に `追記投稿` ボタンを表示する。ボタンを押すと、ページ上部の投稿フォームを追記モードへ切り替える。

追記モードでは以下を行う。

- 楽曲情報は追記元を引き継ぎ、編集不可とする。差分名は親version自身の名前を初期値にし、「今回の差分名」として編集できる。
- 親versionの `difficulty` / `level` を想定難易度UIへ初期反映し、編集可能にする。
- 親versionの `progressMap.layers` を読み取り専用の親layerとして表示する。
- 今回追記分は最後の `followup` layerとして編集する。
- API送信時は `chartName`, `isRejected=false`, `allowAppend` を送り、`title`, `artist` は送らない。

追記モードでは以下を禁止する。

- `progressMap` を持たない古いversionからの画面追記
- 今回追記分のlayerが空のままの送信

没譜面versionも `allowAppend=true` なら追記元にできるが、追記で作成するversion自身は没譜面にできない。通常の完成versionだけは追記開始時の確認dialogを維持し、没譜面からの追記では完成確認を出さない。

完成versionに置き換えられた中間履歴versionでは、一覧UI上で追記投稿ボタンをdisabledまたは非表示にし、`追記不可` として扱う。

## 進捗マップUI

投稿フォーム内の「進捗」セクションに進捗マップUIを表示する。ファイル未選択時は案内文だけを表示し、解析成功後に編集UIを表示する。

1. 上段: 下段の標準化ブロックと1対1対応するプレイノート密度棒グラフ。読み取り専用。
2. 下段: 進捗を塗るための標準化ブロック。クリック/範囲ドラッグで編集可能。

対象ファイル:

- `.bms`
- `.bme`
- `.bml`

`.zip`、プレイノートなしBMS、解析失敗時は進捗マップを表示しない、または控えめなメッセージを表示する。

### BMS解析範囲

プレイノート範囲と、進捗マップの表示・進捗対象範囲は別に管理する。

- `first_note_measure` は最初のプレイノート小節。
- `last_note_measure` は最後のプレイノート小節。
- `displayFirstMeasure` は最初のプレイノート小節。
- `displayLastMeasure` は曲終端小節。
- `target_measure_count` は `displayFirstMeasure` から `displayLastMeasure` までの小節数。
- `progressMap.blocks`、進捗マップUI、進捗PNGは `displayFirstMeasure` から `displayLastMeasure` までを基準にする。

曲終端候補:

- プレイノートチャンネル `11-19`, `21-29`, `51-59`, `61-69`
- BGM `01`
- 小節長 `02`
- BPM `03`, `08`
- STOP `09`

BGAだけの後ろ余白は進捗対象を延ばす理由にしない。曲頭側の完全な空白小節も通常表示に含めない。

`measure_notes_json` はschemaVersion 2として、以下のようにプレイノート範囲と表示範囲を分けて保存する。

```json
{
  "schemaVersion": 2,
  "firstPlayableMeasure": 1,
  "lastPlayableMeasure": 22,
  "displayFirstMeasure": 1,
  "displayLastMeasure": 94,
  "targetMeasureCount": 94,
  "playNotes": 542,
  "lnPolicy": "count_start_only",
  "measures": [
    { "measure": 1, "playNotes": 12 },
    { "measure": 23, "playNotes": 0 },
    { "measure": 94, "playNotes": 0 }
  ]
}
```

既存投稿済みデータと既存PNGは自動再生成しない。新規投稿・追記投稿から新しい解析基準で保存する。

### progress計算

進捗度は標準化ブロック数で算出する。

```text
round(塗られた標準化ブロック数のunion / 標準化ブロック総数 * 100)
```

初回投稿では単一layerを送る。追記投稿では親versionまでのlayerを維持し、最後に今回追記分のlayerを追加して送る。

### 完成版にするボタン

- 初回投稿では常にdisabledとし、初回通常版を完成版として保存しない。
- 追記対象と譜面ファイルが選択され、ファイル解析が完了し、利用可能なprogressMapがあり、解析エラーがなく、現在のmap計算結果が `progress >= 80` かつ `progress <= 100` で、没譜面ではない場合だけ有効化する。初回投稿、ファイル未選択、解析中、解析失敗、progressMap未生成、80%未満、追記対象なし、フォームを閉じた状態、没譜面ではdisabled属性と `aria-disabled=true` を付ける。
- 未指定時は `完成版にする` / `aria-pressed=false`、指定中は `完成版を解除` / `aria-pressed=true` とする。指定中もファイルとprogressMapが有効ならボタンを有効に保ち、解除操作を可能にする。
- 指定時は押下直前のprogressMap全体、layers/ranges、色と透明ブロック、進捗度、編集中layer状態をメモリ上のdeep copyとして保持してから、未塗りブロックをすべて塗り、`progress=100` にする。snapshotはlocalStorage、FormData、D1、R2、生成PNGへ保存しない。
- 指定中は進捗ブロック編集を無効化し、解除が必要であることを常時表示する。解除時はsnapshotから色、ranges、透明ブロック、進捗度、編集状態を指定直前と同一の状態へ戻してCanvasを再描画し、snapshotを破棄する。
- ファイル変更/解除、追記対象変更、追記キャンセル、form reset、投稿成功では、完成版指定とsnapshotを破棄し、新しいフォーム状態から判定し直す。
- 追記投稿では今回追記layerを `completion_fill` とし、押下直前のrangesを検証用 `completionBaseRanges` として送る。Workerは親layerとのunionが80%以上であることを検証し、保存するprogressMapから一時検証値を除外する。
- 送信直前にも、追記モード、選択ファイル、解析完了、有効なprogressMap、snapshot、`progress=100`、非没譜面を再確認する。不整合時はAPIへ送信せず、ファイルの再選択を案内する。Pages側の追加検証はWorker側の既存検証を代替しない。
- 完成版指定を経由せず、未完成親から送られた `progress=100` は完成版として保存しない。

### 没譜面との連動

没譜面チェックON時:

- `progress=100`
- 進捗マップは全塗り扱い
- 進捗度欄は100固定
- 進捗マップの標準化ブロックは編集不可
- Worker側で今回versionの `rejected_auto_fill` layerを全塗りにする。

没譜面チェックは初回投稿だけで有効とする。追記投稿ではdisabled・未選択に固定し、改ざんされた `isRejected=true` はWorkerが拒否する。

### 制作状態と追記受付

`versions.allow_append` はversion単位のbooleanで、DBでは `0/1`、公開APIでは `allowAppend` のbooleanとして扱う。利用者がON/OFFできるのは、初回投稿の没譜面と、追記投稿で明示的に完成版指定した場合だけである。初回通常版と追記の未完成版は `allowAppend=true` に固定し、falseはWorkerが `APPEND_POLICY_LOCKED_FOR_INCOMPLETE` で拒否する。追記投稿の没譜面は `FOLLOWUP_REJECTED_NOT_ALLOWED`、初回通常版の完成状態は `INITIAL_COMPLETION_NOT_ALLOWED` で拒否する。

投稿フォームの進捗欄には「投稿状態」パネルを置き、完成版・没譜面・追記受付を同じ3列構造で表示する。初回の完成版ボタンと追記80%未満の完成版ボタン、追記時の没譜面、未完成時の追記受付には実際のdisabled属性、`aria-disabled`、状態バッジ、常時表示の理由文を付ける。

初回没譜面を初めて選択した時の追記受付はOFF、追記完成版を初めて指定した時はONを初期値とする。同じフォーム内で状態を往復した場合は利用者の選択を保持し、form reset、投稿成功、追記対象変更、追記キャンセルでは破棄する。追記受付設定はlocalStorageへ保存しない。

初回・追記のFormDataはdisabled checkboxにも依存せず、最終判定した `allowAppend=true/false` を必ず明示送信する。Workerは完全一致の文字列 `true` / `false` だけを受け付ける。旧Pagesから項目が欠ける場合、初回は非没譜面ならtrue・没譜面ならfalse、追記で作る子versionはtrueへfallbackするが、上記の禁止組み合わせはfallback後も再検証する。

migration `0006_append_policy.sql` は `allow_append INTEGER NOT NULL DEFAULT 1 CHECK (allow_append IN (0, 1))` を追加し、既存の没譜面だけを0へbackfillする。既存の未完成・完成・取り下げ中・削除申請中・通常DL停止versionは1を維持する。

本番反映順はmigration、Worker、Pagesとする。migration適用後に新Workerを先行させても、旧Pagesから欠落する`allowAppend`は上記fallbackで保存できる。新Pagesは旧APIレスポンスで`allowAppend`が欠落した場合、非没譜面をtrue、没譜面をfalseとして表示する。

追記元は、対象chartに属する公開versionであり、完成版に置き換え済みの中間履歴ではなく、譜面R2ファイルが未削除で、利用可能なprogressMapを持ち、`allow_append=1`であることを必須とする。`is_rejected`、公開中の取り下げ、削除申請、通常DL停止だけでは追記を禁止しない。完成済み親への通常追記は、正規化後の新規子レイヤーに有効なrangeが1件以上ある場合だけ、完成union一致の例外を適用する。追記子の没譜面化は認めない。未完成親の無変更union判定は変更しない。

Workerはmultipart解析後かつファイルhash・BMS解析より前に親を確認し、R2保存後のD1 INSERTでも同じ条件を再確認する。最終確認で失敗した場合は子versionを作らず、保存済みR2 objectを既存cleanup処理で削除する。条件付きINSERTが0件となった後の再検証で具体的な親エラーが判明した場合はその既存分類を返し、すべて通過した場合だけ409 `PARENT_APPEND_CONFLICT` として再読込を案内する。この競合コードは利用者入力起因の投稿失敗レート制限へ含めない。旧Workerが記録した `INVALID_REJECTED_FLAG_FOR_FOLLOWUP` と `REJECTED_CHART_CANNOT_BE_EXTENDED` はrolling window互換のため集計対象へ残すが、新APIからは返さない。

一覧では `allowAppend=false` のversion情報側に `追記受付停止` バッジと読み上げ可能な理由を置き、操作列は `DL / 追記停止 / …` の短い横並びにする。progressMap欠落、中間履歴、非表示、ファイル削除などの構造上の追記不可理由とは混同しない。投稿管理dialogには `追記受付：許可/停止` を読み取り専用で表示し、このPhaseでは投稿後の変更APIや編集UIを設けない。独立一覧 `list.html` には追記受付表示やフィルターを追加しない。

## progress_map_json

標準化ブロック単位の進捗塗り情報を保存するJSON文字列。

```json
{
  "schemaVersion": 2,
  "blockMode": "standardized_measure",
  "targetBlockCount": 142,
  "blocks": [
    {
      "index": 0,
      "startMeasure": 4,
      "endMeasure": 7,
      "startPosition": 4,
      "endPosition": 5,
      "startTimeSec": 0,
      "endTimeSec": 2.1,
      "playNotes": 20
    }
  ],
  "layers": [
    {
      "versionId": "version_xxx",
      "color": "#1f7a5c",
      "kind": "initial",
      "ranges": [[0, 10], [20, 30]]
    },
    {
      "versionId": "pending",
      "color": "#2563eb",
      "kind": "followup",
      "ranges": [[31, 40]]
    }
  ],
  "progress": 29
}
```

仕様:

- `schemaVersion=2` とする。
- `blockMode=standardized_measure` とする。
- `blocks` は下段の標準化ブロックと1対1対応する。
- `blocks` は曲終端基準の表示範囲まで作る。
- `startPosition/endPosition`は小節長を累積した音楽位置で、1ブロック幅は原則1.0、終端blockだけ曲終端で切る。旧保存値ではNULLを許容する。
- `ranges` は連続したブロックindexを `[startIndex, endIndex]` で圧縮して持つ。
- progressは全layerのunion / `targetBlockCount` で算出する。
- 重複して塗られたブロックは1回だけ数える。
- 初回投稿では1layerでよい。
- 追記投稿では親versionまでのlayerを維持し、今回追記分を最後のlayerとして保存する。
- Workerは追記投稿保存時、最後のlayerの `versionId` を今回作成したversion IDへ置き換える。
- 追記投稿では、未完成の親versionについてunionが同じ塗り範囲のままなら `PROGRESS_MAP_UNCHANGED` で拒否する。完成済みの親versionは新しい子レイヤーが1区間以上あれば、unionが100%のままでも追記できる。

layerの `kind` 候補:

- `initial`
- `followup`
- `completion_fill`
- `rejected_auto_fill`

## progressImage PNG

`progressMap` が正データで、`progressImage` は表示・履歴確認用の派生データとする。

- フロント側で `progressMap` からCanvas描画し、PNG Blobを生成する。
- 初回投稿と追記投稿の `FormData` に `progressImage` として添付する。
- MIMEは `image/png`、filenameは `progress.png` とする。
- 進捗PNG生成に失敗した場合は投稿を止めず、`console.warn` に処理段階名付きで警告を残し、`progressImage` なしで投稿を継続してよい。
- Worker側では `progressImage` がある場合のみ検証・保存する。
- `progressImage` は任意項目であり、未送信の場合も投稿は成功してよい。
- PNGの表示終端は `progressMap.blocks` と同じ曲終端基準にする。
- 公開投稿フォームには手動PNGプレビューやダウンロードUIを表示しない。送信用PNGは投稿時に従来どおり生成する。

Worker側検証:

- MIMEが `image/png` であること。
- 空ファイルではないこと。
- サイズは1MB以下であること。

R2保存:

```text
charts/{chartId}/versions/{versionId}/progress/progress.png
```

DB保存:

- `versions.progress_image_key`
- `versions.progress_image_mime`
- `versions.progress_image_size`
- `versions.progress_image_sha256`
- `versions.progress_image_created_at`

譜面ファイル本体と進捗画像は別R2 objectとして扱う。将来、DL不可から30日経過した譜面ファイル本体を削除しても、進捗画像は履歴確認用として残す。

`GET /api/charts` は進捗画像が保存済みの場合に `progressImage` objectを返す。`GET /api/progress-images/:versionId` はR2からPNG本体を返す。

### 一覧サムネイル

一覧サムネイルは、表示中の一覧で比較しやすいように `progressMap` からブラウザ側で再描画する。

表示優先順位:

1. `version.progressMap` が有効な場合は、`progressMap.blocks` と `progressMap.layers` から一覧専用サムネイルを生成する。
2. `progressMap` がない、または不正な場合に限り、`version.progressImage.url` があれば保存済みR2 PNGを `img` fallbackとして表示する。
3. R2 PNGの読み込みに失敗した場合も、同じversionの `progressMap` が使えるなら再描画サムネイルへfallbackする。
4. `progressImage.url` も `progressMap` もない場合は、サムネイルなしの控えめな空表示にする。

一覧専用サムネイルでは以下の意味に固定する。

- 棒の高さ = ノーツ密度。
- 棒の色 = そのblockを最後に塗ったlayer/投稿者。
- 未着手 = 薄い緑または薄いミント。
- 初回投稿layer = 緑系。
- 追記layer 1 = 青系。
- 追記layer 2 = 紫系。
- 追記layer 3 = 橙系。
- 追記layer 4 = 赤系。
- 以降の追記layerはパレットを循環する。

密度は色の濃淡ではなく棒の高さで表す。低密度区間や0ノーツ区間も存在が分かるよう、未着手0ノーツblockは2〜3px程度の薄色バー、塗り済み0ノーツblockは4px程度の色付きバーとして描画する。未着手色は `#CFE3DC`、未着手レールは `#D8E8E2` を基準にし、背景へ溶けない範囲で塗り済み色より弱く見せる。

上段密度バーと下段貢献者レールは同じplot領域を使う。DOM一覧では同じgrid列数、gap、paddingを共有し、Canvas PNGでは `plotX`, `plotWidth`, `blockWidth`, `gap`, `xForBlock(index)` を共通計算して、先頭・中央・末尾blockのX座標が上下で一致するようにする。8ブロック区切り線も同じ `xForBlock` 系の座標を使う。

新規生成PNGは一覧サムネイルと同じ未着手色、最低高さ、上段/下段の位置合わせルールに寄せる。既存R2 PNGは自動再生成しない。

サムネイル下の補助表示は進捗率を繰り返さず、`32/81 blocks · 3 users` のように作成済みblock数と参加者数を表示する。進捗率は一覧の進捗列チップで表示する。

hover tooltipでは以下を確認できるようにする。

- 進捗率
- 作成済みblock数 / 総block数
- 参加者数
- 色と投稿者/追記者の対応
- 未着手block数

色と投稿者の対応は、同じchart内の `versions` から `progressMap.layers[].versionId` と `version.id` を照合し、`version.author` を使う。authorが引けない場合は `初回`, `追記1`, `追記2`, `layer n` などにfallbackする。

密度スケールは、現在読み込んでいる一覧内の全 `progressMap.blocks` から正の密度値を集め、95パーセンタイル相当を共通 `densityScale` として使う。高さ計算は `sqrt(density / densityScale)` を基本とし、極端な高密度譜面だけ頭打ちにする。`blockDurationSec` が取れない場合は `playNotes` のみを密度値として扱う。将来はサイト全体または難易度帯別の固定スケールを検討する。

MVPではサムネイルクリックによる拡大表示は実装しない。将来、`progressImage.url` またはCanvas再描画結果をモーダルで拡大表示し、layer凡例や詳細ブロック情報を確認できる導線を検討する。

`progressImage.url` は `/api/progress-images/:versionId` のような相対URLで返るため、R2 PNG fallback時はGitHub Pages側で `API_BASE_URL` と結合して表示する。MVPではcache bustingは行わない。将来、同じversionIdの画像を再生成する場合はquery付与などを検討する。

## 分岐version管理

単線version管理ではなく、分岐ツリー型version管理にする。

`versions` は以下を持つ。

- `parent_version_id`: 親version。rootだけNULL、それ以外は必須。
- `version_number`: 整数。APIの `displayVersion` 生成や内部管理に使う。
- `branch_label`: 同じ親からの分岐識別子。
- `branch_path`: ツリー表示、ページング、祖先DL制御、並び順に使う内部パス。

追記投稿では以下で分岐を生成する。

- `version_number = parent.version_number + 1`
- 同じ親を持つ既存子version数を数え、0件目を `a`、1件目を `b`、以降 `c`...`z`、`aa`... とする。
- `branch_path = parent.branch_path + '/' + branch_label` とする。

## progress=100到達時の親version DL制御

追記投稿で新versionのprogressが100になった場合、完成version自体はDL可能にする。

同一分岐上の祖先のうち `progress BETWEEN 1 AND 99` の途中versionのみ、以下を設定する。

- `download_blocked=1`
- `download_block_reason='superseded_by_completed_descendant'`
- `download_blocked_at=CURRENT_TIMESTAMP`
- `collapsed_by_completion=1`
- `collapsed_reason='superseded_by_completed_descendant'`
- `collapsed_at=CURRENT_TIMESTAMP`
- `collapsed_by_version_id=<new version id>`

この処理ではD1行やR2ファイルは物理削除しない。DL不可から30日経過したR2譜面ファイル削除は、将来のCron Triggerで実行する。進捗画像は譜面ファイル削除後も残す。

## 投稿一覧

投稿一覧では、song単位で曲名とアーティストを表示し、その下にchart単位の差分を表示する。version行では曲名・アーティスト・サブタイトル・サブアーティストを繰り返さない。

各version行には以下を表示する。

- 表示専用の版ラベル。rootは `BASE`、子孫は `1`, `1-1`, `1-2`, `1-2-1` のように `branchPath` から数字パスとして生成する。
- 親version表示。rootは `起点`、子versionは `from BASE`, `from 1`, `from 1-2` のように表示する。
- 重要状態バッジ。通常表示は `完成`, `没譜面`, `DL不可`, `削除申請中`, 管理非表示系に限定する。
- 想定難易度
- 差分作者
- 進捗度
- `progressMap` がある場合は、一覧内共通densityScaleを使った密度・担当layer色つき進捗サムネイル
- `progressMap` がない、または再描画できない場合は `progressImage.url` の保存済みR2 PNG fallback
- コメントの短い表示
- DLボタンまたはDL不可ボタン
- 追記投稿ボタン

### トップの最近の投稿

- トップページは全件探索用の検索・フィルターを持たず、`GET /api/charts?page=1&pageSize=10`で`charts.updated_at DESC, charts.id ASC`順の最近10chartを詳細カード表示する。
- 一覧下部の操作領域は常時表示し、`さらに10件読み込む`, `読み込み中…`, `すべて表示しました`, `再試行`を状態に応じて切り替える。追加取得失敗時は表示済みカードを残す。
- 追加取得はchart IDで重複排除し、AbortControllerと世代番号で古い応答を無視する。
- 追加取得後は、直前までのカードと今回追加した先頭カードの間に、文字を伴わない細線と小さなひし形を表示する。次の追加取得時は以前の境界を外し、最新の追加境界だけを残す。
- 詳細表示中は`excludeChartId`で選択中chartをAPIの一覧とCOUNTから除外し、各ページを10chartのまま維持する。選択中カードと最近一覧に同じchart/version DOMを重複させない。
- chartカード内の版ツリー、進捗サムネイル、miniView、DL、追記、お気に入り、管理操作、コメントは維持する。選択中カードも`#list`の共通イベント委譲と描画後mountを使用する。
- 各chartの最新公開version投稿日時を基準に、D1の`serverTime`との差が1時間未満、1〜23時間、1〜7日の場合だけ相対時刻を表示する。8日以上、未来日時、不正日時は表示しない。タブ再表示時に更新し、頻繁なtimer更新は行わない。

### version別差分名

- `charts.chart_name` / `charts.normalized_chart_name` は初回投稿時の起点差分名であり、追記では変更しない。
- `versions.chart_name` / `versions.normalized_chart_name` は各versionの差分名snapshotとする。新規BASEには起点名を同時保存する。
- migration `0005_version_chart_name.sql` は既存versionへ所属chartの差分名と正規化名をbackfillする。移行途中のNULL行は`COALESCE(version, chart)`で読み取る。
- 追記名は、空でない有効な送信値、親version名、chart起点名の順で決定する。旧Pagesが`chartName`を送らない場合も親名を継承できる。
- 差分名は前後空白を除去し、100 Unicode code point以内とする。検索値は投稿時と同じNFKC・小文字化を使う。
- トップのchart見出しは起点差分名を維持する。各version行は数字パス版ラベルの近くへそのversion自身の差分名を1行で表示する。
- 独立一覧、version検索、お気に入りsnapshot、RC★/RC★★の`name_diff`と`bms_wip_chart_name`は対象version自身の差分名を使う。
- version別差分名に一意制約は設けない。同名の複数versionを許可し、versionIdと数字パス版ラベルで区別する。

### chart検索API

- `GET /api/charts`の`q`は、曲名、サブタイトル、アーティスト、サブアーティスト、公開中version自身の差分名、公開中version作者を部分一致検索する。
- 検索に一致したversionだけへ絞らず、該当chartの全公開versionを返して数字パス版ラベルと祖先ツリーを維持する。
- 検索語は前後空白を除去し、最大100文字とする。曲情報と各versionの差分名は投稿時と同じNFKC・小文字化済み値を使う。
- `%`, `_`, `\\`はLIKE検索の制御文字ではなく通常文字として扱う。
- APIはchart件数の`total`と`hasNext`を返す。一覧取得とCOUNTは同じ公開条件・検索条件を使う。
- トップの詳細カード一覧にあるお気に入り表示は、取得済みchartへ従来どおり適用する。独立投稿一覧 `list.html` の「お気に入りのみ」は `POST /api/versions/query` を使い、未取得ページを含むlocalStorage上の公開versionをversion単位で取得する。

### 独立投稿一覧

`list.html` は大量の公開版を簡潔に確認するページとし、トップの詳細カード一覧とは別のversion単位APIを使用する。

- `GET /api/versions` は公開versionを1件ずつ返す。`charts.is_hidden=0`, `versions.is_hidden=0`, `collapsed_by_completion=0`を共通条件とする。
- 一覧の通常行は日付、タイトル、難易度、作者、コメント、進捗の6列とする。曲名の下に `[対象version自身の差分名] / 数字パス版ラベル` を表示する。タイトルを主列、進捗を64px固定列として扱う。
- コメントは`versions.comment`をtrimし、連続空白を1個へ畳んだ80 Unicode code pointまでの`commentPreview`だけを返す。80文字超過時だけ`…`を付け、全文・HTML・リンク化は一覧で扱わない。
- `withdrawn`, `deleteRequested`, `downloadBlocked` は公開状態なら小さい状態ラベルを表示する。管理非表示versionと完成版に置き換えられた中間履歴は表示しない。
- 検索対象は曲名、サブタイトル、アーティスト、サブアーティスト、対象version自身の差分名、そのversionの作者とする。
- 並び順は `new`（version投稿日時順）と `updated`（chart更新日時を優先し、その中でversion投稿日時順）を提供する。
- 状態は `all`, `incomplete`, `complete`, `rejected` を提供する。未完成・完成は非没譜面だけを対象とする。
- 状態と並び順はネイティブradioのフィルターパネルで選択し、変更時に即再取得する。
- 期間は`dateFrom`, `dateTo`の片側または両側指定とし、適用操作まで一覧へ反映しない。`sort=new`ではversion投稿日時、`sort=updated`ではchart更新日時を固定JST（UTC+9）の開始含む・翌日開始未満で絞る。
- 今日・今週・今月・今年のショートカットはAPIの`serverTime`をJSTへ変換して算出し、端末時計や端末timezoneを基準にしない。
- `POST /api/versions/query` はlocalStorageのversion IDを最大200件受け取り、公開状態を再検証してお気に入りを完全にページングする。見つからないIDは自動削除せず件数だけ返す。
- NEWはchartの初回公開日時から168時間以内とし、Worker/D1の時刻で判定する。追記ではNEWへ戻さない。
- 各versionの投稿日時とAPIの`serverTime`との差が1時間未満、1〜23時間、1〜7日の場合、日付セルへ相対時刻を表示する。8日以上、未来日時、不正日時は表示せず、NEWとは色と役割を分ける。
- 1ページ20versionのページ番号方式とし、`q`, `sort`, `status`, `favorites`, `dateFrom`, `dateTo`, `page` をURLへ保持する。条件変更は1ページ目へ戻す。
- 戻る・進むではURL条件を復元して再取得し、通信中の古い応答はAbortControllerと世代番号で無視する。
- ページ取得失敗時は直前の行を消さず、失敗表示と再試行導線を出す。
- タイトルは`index.html?chartId=<chartId>&versionId=<versionId>#list`へリンクし、同名曲や同一chart内の別versionを曖昧な検索に頼らず特定する。
- トップは`GET /api/charts/:chartId`で対象chartを取得し、「選択中の投稿」として既存詳細カードを表示する。その下には`excludeChartId`で選択chartを除いた最近の10chartを表示し、10件ずつ追加取得できる。
- 詳細APIは公開chartと公開versionだけを返すが、対象ツリーの復元用に`collapsed_by_completion=1`の中間履歴を含める。`is_hidden=1`のchart/versionは返さない。
- 指定versionが中間履歴にある場合は、そのversionを含む履歴グループだけを展開する。無関係な履歴グループは折り畳み状態を維持する。
- 描画後の共通mountと折り畳み処理を待って対象行を再取得し、中央へスクロールしてfocusする。`prefers-reduced-motion: reduce`では即時スクロールとし、対象行はレイアウトを動かさない枠と「選択中」表示で4秒間強調する。
- chartが見つからない場合、chart内に指定versionがない場合、API失敗を区別して案内する。API失敗時は再試行でき、不正な片側パラメータや長すぎるIDでも通常一覧を壊さない。
- 初回投稿・追記投稿の成功後はレスポンスの`chartId`/`versionId`を使い、フォームとローカルminiViewをresetし、保存対象の作者・管理パスワードを復元して未送信判定を解除する。Turnstileをresetしてフォームを閉じた後、`history.replaceState`で詳細URLへ更新し、同じ詳細コントローラーで取得・履歴展開・focus・一時強調する。
- 投稿API成功後の詳細再取得に失敗しても投稿成功は取り消さず、再試行導線を表示して二重投稿を防ぐ。
- 選択中カードの取り消し・削除申請後は、管理APIの成功と表示再取得の成否を分離する。対象versionが非公開になった場合はカードを残さず状態文を表示し、最近一覧も再取得する。
- OFFSET方式は維持する。件数増加時のcursorページングは後続フェーズとする。

### お気に入り★

投稿一覧の各version行では、版ラベル右側にお気に入り用の★buttonを表示する。

仕様:

- お気に入りの単位は `versionId` とする。
- お気に入り状態はサーバーには保存せず、ブラウザごとの `localStorage` に保存する。
- localStorage keyは `bms-wip-charts:favorites:v1` とする。
- 保存形式はversionIdをkeyにしたmap形式とし、判定はversionIdの存在で行う。
- `chartId`, `songTitle`, 対象version自身の`chartName`, `versionLabel`, `branchPath`, `favoritedAt` は表示補助用snapshotとして保存してよい。旧snapshotに`chartName`がない場合もversionId判定を継続する。
- localStorageが壊れている、またはJSON parseに失敗した場合は空扱いにし、一覧全体を壊さない。
- APIレスポンスに存在しないfavoriteはMVPでは表示上無視し、自動削除しない。
- `completed`, `downloadBlocked`, `collapsedByCompletion`, `isRejected` のversionもお気に入り可とする。
- `isHidden=true` のversionは一覧に表示されないため、お気に入りUIも表示しない。

お気に入りのみトグル:

- 投稿一覧上部に `★ お気に入りのみ` トグルを表示する。
- OFF時は通常一覧を表示する。
- ON時は、お気に入りversionとその祖先versionだけを表示する。
- お気に入りversionを含むchartだけを表示し、祖先を残すことでツリー文脈を維持する。
- 中間履歴内のversionがお気に入りの場合、フィルタON時はそのversionが見えるようにし、通常表示時の中間履歴折り畳み挙動は維持する。
- 検索中も、取得済み検索結果に対してお気に入りversionと祖先versionを絞り込む。
- 未取得ページのお気に入りを全件対象にするには、localStorageのchart snapshotを使った追加取得方式を別フェーズで検討する。
- 将来アカウント機能ができた場合は、サーバー保存や端末間同期を検討する。

## 投稿者による取り消し・削除

投稿一覧の各version行から、投稿時の管理パスワードを使って操作する。UIでは「取り消し」と表示し、既存APIルートと内部ログactionは `withdraw` / `withdraw_version` を維持する。

24時間ルール:

- 判定基準は `versions.created_at` とし、WorkerがD1上で `created_at >= datetime('now', '-24 hours')` を評価する。
- `visibleChildVersionCount`は`parent_version_id`が一致し、`COALESCE(is_hidden, 0)=0`の直接子数とする。即時非表示可否はこの値で判定する。
- `totalChildVersionCount`は`parent_version_id`が一致する全直接子数とし、非表示versionも含めて監査・参考表示に使う。
- 削除申請中、取り消し済み、DL不可、没譜面、中間履歴でも公開中なら`visibleChildVersionCount`へ含める。24時間以内即時非表示済み、管理承認済みなど`is_hidden=1`の子は除外する。
- 一覧の24時間表示は参考情報であり、最終結果はAPI実行時の再判定と `outcome` を正とする。

取り消し:

- 24時間以内かつ公開中の直接子なし: `outcome='immediate_hidden'`。`is_hidden=1`, `hidden_reason='canceled_within_24h'`, `hidden_at`, `withdrawn_at`, `download_blocked=1`を設定する。
- 24時間以内で公開中の直接子あり: `outcome='download_blocked'`。一覧には残し、DLを停止する。
- 24時間経過後: `outcome='download_blocked'`。一覧には残し、DLを停止する。
- 既存の `download_block_reason` は上書きせず、未設定の場合だけ `withdrawn` を使う。

削除:

- 24時間以内かつ公開中の直接子なし: `outcome='immediate_hidden'`。`is_hidden=1`, `hidden_reason='deleted_within_24h'`, `hidden_at`, `download_blocked=1`を設定し、pending削除申請は作らない。
- 24時間以内で公開中の直接子あり、または24時間経過後: `outcome='delete_requested'`。`delete_requests`へpendingを追加し、`delete_requested_at`と`download_blocked=1`を設定する。
- API入力の `reason` は `delete_requests.message` に保存し、申請日時は `delete_requests.created_at` とする。
- 同一versionにpending申請がある場合は重複受付しない。

論理削除と操作可否:

- `immediate_hidden`は物理削除ではない。D1 versions行、R2譜面ファイル、progressImage PNGを保持し、`file_deleted_at`は設定しない。
- `download_blocked`はDL制御であり、追記不可条件ではない。
- `withdrawn_at`または`delete_requested_at`があっても追記できる。
- `is_hidden=1`は追記不可とする。`is_rejected=1`は追記不可条件ではなく、`allow_append`に従う。完成版に置換済み中間履歴など既存の明示的な追記不可条件も維持する。
- 即時非表示UPDATEは24時間条件と公開中の直接子不存在条件を再確認し、競合を検出した場合はDL停止または削除申請へ寄せる。

共通仕様:

- request bodyは `application/json` とし、`password` を必須にする。
- passwordは `hashWithSecret('password:' + password, HASH_SECRET)` で検証する。
- password、password_hash、HASH_SECRET、生IP、生UA、削除理由本文はログに出さない。
- 同じIP/UAハッシュで10分以内に5回以上 `INVALID_PASSWORD` が記録された場合は `RATE_LIMITED` とする。
- 成功・失敗は `post_logs` の既存action `withdraw_version` / `request_delete` に記録し、detailには `outcome`, `within24Hours`, `hasDescendants`, `visibleChildVersionCount`, `totalChildVersionCount`, ID、理由有無と文字数を残す。
- 通知、物理削除、復旧、処理済み申請の履歴検索は後続フェーズとする。

## 削除申請の管理

管理UIは公開一覧へ埋め込まず、`docs/admin.html` の専用URLとして提供する。公開一覧には管理ページへのリンクを置かず、URLを隠すこと自体は認証手段としない。

認証:

- 全管理APIで `Authorization: Bearer <ADMIN_TOKEN>` を必須にする。
- `ADMIN_TOKEN` はCloudflare secretで管理し、URL、HTML属性、console、D1ログへ出さない。
- 管理ページではトークンをページのメモリ内だけに保持し、`localStorage`へ保存しない。
- `ADMIN_TOKEN`未設定は`CONFIG_MISSING`、不一致は`ADMIN_AUTH_REQUIRED`とする。

pending一覧:

- `GET /api/admin/delete-requests?status=pending&page=1&pageSize=50` で古い申請から表示する。
- `delete_requests`, `versions`, `charts`, `songs`を結合し、申請理由、申請日時、曲・差分・版、作者、進捗、現在状態、公開中の直接子数、履歴上の全直接子数を返す。
- `password_hash`, R2 key, requester hash、secretは返さない。
- 24時間以内かつ公開中の直接子なしで即時非表示になったversionはpending申請を作らないため、この一覧には出ない。

承認:

- `POST /api/admin/delete-requests/:requestId/approve`を使い、`adminNote`は任意、1000文字以内とする。
- `status='pending'`かつ`visibleChildVersionCount=0`のversionだけ承認できる。公開中の直接子がある場合は`DELETE_REQUEST_HAS_DESCENDANTS`を返し、申請とversionを変更しない。
- `totalChildVersionCount>0`でも全直接子が`is_hidden=1`なら承認できる。
- 承認時は`delete_requests.status='approved'`, `handled_at`, `handled_by='admin'`, `admin_note`を設定する。
- versionは`is_hidden=1`, `hidden_at`, `hidden_reason='delete_request_approved'`, `download_blocked=1`, `updated_at`を設定する。
- 既に非表示のversionでは既存の`hidden_reason`を上書きせず、pending申請だけをapprovedにできる。
- 承認は論理非表示であり、R2譜面ファイル、progressImage、D1 version行を物理削除せず、`file_deleted_at`も設定しない。

却下:

- `POST /api/admin/delete-requests/:requestId/reject`を使い、`adminNote`を必須、1000文字以内とする。
- `delete_requests.status='rejected'`, `handled_at`, `handled_by='admin'`, `admin_note`を設定する。
- 同じversionに別のpending申請がなければ`delete_requested_at`を解除する。
- `download_block_reason='delete_requested'`の場合だけDL制限を解除する。`withdrawn`, `superseded_by_completed_descendant`, `admin_blocked`, `admin_hidden`など別理由の制限は保持する。
- 却下時に`is_hidden`, `hidden_reason`, `withdrawn_at`を復旧しない。

監査:

- 管理者の承認・却下・競合・失敗は`post_logs`ではなく`admin_logs`へ記録する。
- actionは`approve_delete_request`または`reject_delete_request`とする。
- detailにはrequest/version/chart ID、公開中・全直接子数、前後状態、outcome/errorCode、管理メモ文字数を記録する。
- ADMIN_TOKEN、password、HASH_SECRET、生IP、生UA、申請理由本文は`admin_logs`へ記録しない。
- R2物理削除、親versionの構造保持削除、復旧、複数管理者識別は後続フェーズとする。

## 管理者によるR2 cleanup

R2-CLEANUP-01では、削除意思が確定した論理削除versionの譜面ファイルだけを、管理画面から1件ずつ整理する。D1 version行、`progressMap`、`progressImage` PNGは保持する。

cleanup対象は次の全条件を満たすversionに限定する。

- `is_hidden=1`
- `download_blocked=1`
- `file_deleted_at IS NULL`
- `hidden_at IS NOT NULL`
- `hidden_at`から30日以上経過
- `hidden_reason IN ('delete_request_approved', 'deleted_within_24h')`

`is_hidden=1`だけではcleanup対象にしない。公開中のDL不可version、pending削除申請、`canceled_within_24h`、`admin_hidden`、`hidden_at IS NULL`は対象外とする。保持期間はブラウザではなくWorker/D1で再判定し、`created_at`や`download_blocked_at`へfallbackしない。

削除対象は`versions.r2_key`が指す譜面R2 objectのみとする。`versions.progress_image_key`が指すPNGは削除しない。R2 objectを削除した、またはobject不在を確認した後に次を更新する。

- `file_deleted_at=CURRENT_TIMESTAMP`
- 通常削除は`file_delete_reason='r2_cleanup_deleted'`
- object不在またはR2 key欠落のD1修復は`file_delete_reason='r2_object_missing_during_cleanup'`
- `updated_at=CURRENT_TIMESTAMP`

R2削除失敗時は`file_deleted_at`を設定しない。R2削除後にD1更新が失敗した場合、次回実行でobject不在を検出してD1を修復する。`file_deleted_at IS NOT NULL`なのにobjectが存在する逆方向の不整合は、このMVPでは自動削除しない。

手動cleanupは`ADMIN_TOKEN`認証後の管理画面から1件ずつ実行し、確認文字列`DELETE_R2_FILE`を要求する。実行結果は`admin_logs`へ記録するが、ADMIN_TOKEN、secret、生IP、生UA、raw R2 keyは記録しない。

同じ対象条件と削除処理を使うCron cleanupを毎日JST 03:00（UTC 18:00、`0 18 * * *`）に実行する。1回最大20件を`hidden_at`昇順、同時刻はversion ID昇順で取得し、1件ずつ逐次処理する。候補取得後も各versionを削除直前にD1から再取得し、状態が変わっていた場合はR2を削除せず`skipped_state_changed`として記録する。候補取得自体に失敗した場合はR2操作を開始しない。

R2 objectが既に存在しない場合は、対象条件を再確認した上で`file_delete_reason='r2_object_missing_during_cleanup'`としてD1を修復する。手動処理とCronが競合して条件付きUPDATEが0件になった場合は、再取得後に`file_deleted_at`設定済みなら`concurrent_completed`として扱う。Cron由来の個別ログには`trigger='cron'`と`runId`を含め、実行全体も`admin_logs.action='r2_cleanup_cron_run'`で集計記録する。

R2削除とD1更新は完全なトランザクションではない。R2削除後にD1更新が失敗した場合は、次回実行でobject不在を検出して修復する。R2削除失敗時はD1を更新せず翌日の候補に残す。D1のversion/chart/song行、progressImage、一括物理削除は対象外とし、既存の手動cleanupも維持する。

## 自動削除準備

将来、Cloudflare Workers Cron Triggerで1日1回程度、DL不可から30日経過したversionのR2譜面ファイルを整理する。

MVPの自動削除対象reason候補:

- `superseded_by_completed_descendant`
- `withdrawn`
- `admin_blocked`
- `admin_hidden`

`delete_requested` はMVPでは自動削除対象に含めない。

自動削除時はD1行を物理削除せず、`is_hidden=1` と `hidden_reason='auto_deleted_after_download_block'` にし、`file_deleted_at` と `file_delete_reason` を保存する。進捗画像は履歴確認用として残す。

## BAN-01 投稿制限

BANは、ログインなし投稿サイトで管理者が有害な初回投稿・追記投稿を明示的に制限するために使う。閲覧、DL、取り消し、削除申請、管理操作、管理承認・却下、R2 cleanupはBAN対象外とし、投稿者が自分の投稿を整理する経路は塞がない。

MVPで管理画面から作成できる対象は次の2種類とする。

- `ip_hash`: 投稿リクエスト元のIP markerを`HASH_SECRET`でハッシュ化した値。共有回線を巻き込む可能性があるため、管理画面に注意を表示する。
- `file_sha256`: 同一内容の譜面ファイルの再投稿を止める補助対象。

`ua_hash`は既存BANデータとの照合互換だけを維持し、管理画面から作成しない。IP+UA組み合わせBANは現schemaで安全に表現できないため未対応とし、IP行とUA行をAND条件の代用として作成してはならない。

IP markerは本番では`CF-Connecting-IP`を優先し、ローカル互換時だけ`X-Forwarded-For`先頭値を使う。markerが取得できない場合は`unknown`をハッシュ化して投稿ログへ残すが、そのログからIP BANは作成できない。ハッシュ規則は既存`post_logs`と共通化し、`hashWithSecret("ip:" + marker, HASH_SECRET)`および`hashWithSecret("ua:" + marker, HASH_SECRET)`を使う。`HASH_SECRET`未設定時やBAN照合DB障害時は投稿を安全側で拒否する。`HASH_SECRET`を変更すると既存`post_logs`と`bans`の照合が継続できなくなるため、運用中は固定する。

初回・追記投稿では、multipart解析より前に`ip_hash`を照合する。既存データ互換としてactiveな`ua_hash`も照合する。ファイルBANはmultipart解析とSHA-256計算後、R2保存およびD1 version作成より前に照合する。active判定は`active=1 AND disabled_at IS NULL AND (expired_at IS NULL OR expired_at > CURRENT_TIMESTAMP)`とする。BAN拒否はHTTP 403 `POSTING_BLOCKED`とし、ban id/type/valueや期限など回避に使える情報を公開レスポンスへ出さない。

BAN期間は24時間、7日、30日、無期限を扱う。解除は物理削除ではなく`active=0`, `disabled_at=CURRENT_TIMESTAMP`, `updated_at=CURRENT_TIMESTAMP`で記録する。既存の同一`ban_type`/`ban_value`を再度BANした場合は、同じ行を再有効化して理由・期限を更新する。

管理画面には最近の`post_logs`とBAN一覧を独立セクションとして表示する。full hash、生IP、生UAは返さず、短縮ハッシュだけを表示する。BAN作成時は管理UIからhash値を送らず、`sourcePostLogId`を受けたWorkerがD1内のfull hashを解決する。BAN作成・解除は`admin_logs`へ`create_ban` / `lift_ban`として記録するが、full hash、生IP、生UA、`ADMIN_TOKEN`、`HASH_SECRET`はdetailへ入れない。

Rate Limitはパスワード失敗などに対する短時間制限、BANは管理者判断による明示制限として区別する。両方が適用される投稿APIではBANを先に判定し、エラーコードも`POSTING_BLOCKED`と`RATE_LIMITED`に分ける。

## POST-RATE-LIMIT-01 投稿・追記レート制限

初回投稿`POST /api/charts`と追記投稿`POST /api/charts/:chartId/versions`だけを対象とし、取り消し、削除申請、閲覧、DL、管理API、R2 cleanup、既存の管理パスワード失敗制限は対象外とする。制限キーは`ip_hash`のみとし、生IP、生UA、`ua_hash`単独、IP+UA複合値、author、chartId、versionIdは使用しない。

投稿前処理はCORS確認、request fingerprint生成、IP/UA BAN判定、投稿レート制限、progressImageを含むmultipart解析、file SHA-256 BAN、通常検証、R2保存、D1保存の順とする。fingerprintはpre-multipart BAN判定とレート制限の間で共有し、BANを常に先に判定する。

accepted上限:

| action | 10分 | 1時間 | 24時間 |
| --- | ---: | ---: | ---: |
| `create_chart` | 3 | 10 | 30 |
| `append_version` | 5 | 20 | 60 |

client起因rejectedは初回・追記を合算し、10分10件、1時間30件を上限とする。client起因判定はコード内の固定allowlistに限定し、`POSTING_BLOCKED`, `POST_RATE_LIMITED`, `BAN_CHECK_FAILED`, `POST_RATE_LIMIT_CHECK_FAILED`およびD1/R2/config/Worker起因エラーは数えない。レート制限拒否はHTTP 429 `POST_RATE_LIMITED`とし、`Retry-After`ヘッダーと本文`retryAfterSeconds`へ同じ値を返す。複数ルール違反時は各時間窓の最古ログから残り秒数を求め、最大値を採用する。

集計には既存`post_logs`と`idx_post_logs_ip_hash_created_at`を使い、schema、migration、index、専用カウンターテーブルは追加しない。`POST_RATE_LIMITED`拒否はbest effortで既存action、`result='rejected'`、`file_sha256=NULL`として記録する。detailにはpre-multipart stage、代表rule、window、limit、count、errorCodeだけを入れ、生IP、生UA、hashは重複保存しない。

IP marker不明時は`localhost`, `127.0.0.1`, `[::1]`等のローカル開発環境ではレート制限をスキップする。その他では共通`unknown`バケットへ集約せず、HTTP 503 `POST_RATE_LIMIT_CHECK_FAILED`でfail closedとする。D1集計も原子的な予約処理ではないため、完全同時リクエストが少数すり抜ける可能性がある。また、共有回線では複数利用者を同じ制限へ巻き込む可能性がある。

管理画面へ専用UIや手動解除を追加しない。既存post_logs一覧で`POST_RATE_LIMITED`を確認し、時間経過で自動解除する。

## API仕様

既存API:

- `GET /api/health`
- `GET /api/charts`
- `POST /api/charts`
- `POST /api/charts/:chartId/versions`
- `GET /api/files/:fileId`
- `GET /api/progress-images/:versionId`
- `GET /api/admin/delete-requests`
- `POST /api/admin/delete-requests/:requestId/approve`
- `POST /api/admin/delete-requests/:requestId/reject`
- `GET /api/admin/r2-cleanup-candidates`
- `POST /api/admin/r2-cleanup/:versionId/delete-file`
- `GET /api/admin/post-logs`
- `POST /api/admin/bans`
- `GET /api/admin/bans`
- `POST /api/admin/bans/:banId/lift`
- `POST /api/admin/hide-version`

APIエラーは必ず JSON で `code`, `message`, `detail` を返す。

主な進捗画像エラー:

| code | message |
| --- | --- |
| `INVALID_PROGRESS_IMAGE` | 進捗画像が不正です。 |
| `PROGRESS_IMAGE_TOO_LARGE` | 進捗画像のサイズが上限を超えています。 |
| `PROGRESS_IMAGE_UPLOAD_FAILED` | 進捗画像の保存に失敗しました。 |
| `PROGRESS_IMAGE_NOT_FOUND` | 進捗画像が見つかりません。 |
| `PROGRESS_IMAGE_UNAVAILABLE` | この進捗画像は表示できません。 |
| `PROGRESS_IMAGE_R2_NOT_FOUND` | 進捗画像ファイルが見つかりません。 |

ログ方針:

- エラーは握りつぶさない。
- `console.error` には処理段階名を含める。
- 秘密情報、APIキー、トークン、生IP、生UA、生パスワードはログに出力しない。

## ZIP-SAFETY-01 ZIP投稿安全検査

ZIP投稿は、外側の5MiB制限とSHA-256 BAN・重複判定を通過した後、R2保存前に`@zip.js/zip.js`で中央ディレクトリを検査する。ZIPはファイルシステムへ展開せず、内部ファイルもR2へ個別保存しない。検査通過後の生ZIPだけを従来どおり1オブジェクトとして保存する。既に保存済みのZIPはこのフェーズでは再検査しない。

- ZIP内の`.bms` / `.bme` / `.bml`はちょうど1件とし、その譜面だけを2MiB上限・CRC32確認付きでストリーム展開する。内容解析、メタデータ取得、進捗マップ生成は後続フェーズとする。
- 許可する補助ファイルは画像`.png/.jpg/.jpeg/.gif/.bmp/.webp`とテキスト`.txt/.md/.json/.ini/.cfg/.csv/.xml/.def`に限定する。
- 音声、別アーカイブ、実行・スクリプトなどallowlist外の形式、暗号化、分割ZIP、Zip64、Store/Deflate以外、危険なパス、シンボリックリンク・特殊ファイル、正規化後の重複パスを拒否する。
- パスはNFKC正規化後に区切りを`/`へ統一し、安全性・重複を判定する。音声判定は小文字化した最終拡張子だけを使い、`voice.wav.txt`のように途中に音声拡張子を含むだけの名前は拒否しない。
- 上限は全エントリ160、通常ファイル128、申告展開後合計16MiB、1ファイル4MiB、譜面2MiB、ディレクトリ深度8、パス長240文字、個別圧縮率100倍、全体圧縮率50倍とする。個別圧縮率は1MiB以上、全体圧縮率は2MiB以上で適用する。
- 利用者起因の拒否はHTTP 400の`ZIP_*`とし、`post_logs.detail`にはstage、errorCode、エントリ数、申告展開後合計、譜面件数だけを保存する。予期しない検査障害はHTTP 503 `ZIP_INSPECTION_FAILED`とし、投稿失敗レート制限には数えない。
- 補助ファイルは中央ディレクトリとローカルエントリ範囲を検査するが、内容の完全展開・マジックバイト検査は行わない。拡張子を偽装した音声内容や補助画像自体のCRC完全検査は後続課題とする。

## ZIP-BMS-ANALYSIS-01 ZIP内譜面解析

- ZIP安全検査でCRC確認付き展開した唯一のBMS/BME/BMLバイト列を、そのままWorker解析へ渡す。同じZIPを解析目的で再展開しない。
- 単体BMSとZIP内譜面は共通のメタデータ・MD5・ノーツ・小節・標準ブロック解析を使う。`versions.md5`は内部譜面、`file_sha256`は外側ZIP全体のhashとする。
- Workerが標準ブロックを再生成し、クライアント送信のblock数、小節範囲、時刻、playNotesと照合する。保存時の`progressMap.blocks`はWorker生成値へ置き換え、クライアントからはlayerの塗り範囲を採用する。
- ZIP追記では親progressMapと新しい内部譜面のブロック格子を照合する。格子不一致は自動変換せず拒否する。
- PagesはZIP選択時だけローカル配置したzip.jsを遅延読込し、最大2MiBの内部譜面1件を既存メタデータ・進捗マップUIへ渡す。ブラウザ解析は入力補助であり、保存判定には使わない。
- メタデータ解析失敗はフォーム値へfallbackする。BMS解析失敗はprogressMapなしならwarning、progressMapありなら検証不能として拒否する。標準ブロックはWorker/Pagesとも最大5000件とする。
- R2には外側ZIPだけを保存し、内部譜面名・内部ファイルは永続保存しない。既存ZIPの自動再解析は行わない。

## DIFFICULTY-TABLE-01 完成差分フィード

完成差分は一般的なBMS難易度表形式で、次の2表へ統合して公開する。

- `rc-star`: 表示名`リサイクルセンター RC★`、symbol `RC★`、level order `0`～`20`、`他`
- `rc-double-star`: 表示名`リサイクルセンター RC★★`、symbol `RC★★`、level order `1`～`7`

各表は取込用HTML、header JSON、data JSONを提供する。dataはページングせず配列を返し、空の場合もHTTP 200の空配列とする。

難易度分類では保存済み`level`を信用せず、`difficulty`をNFKC正規化して前後空白を除去し、整数表記だけを再解析する。`sl`と`st`は大文字小文字を区別しない。

RC★変換:

- `★0`～`★20`: 数値をそのまま使用
- `sl0, sl1, sl2, sl3, sl4, sl5, sl6, sl7, sl8, sl9, sl10, sl11, sl12`: `0, 1, 3, 5, 6, 8, 10, 12, 14, 15, 17, 18, 19`へ変換
- `st0`: `20`
- 空でない未認識表記、小数、範囲外表記: `他`
- 空またはNULLのdifficulty: 掲載しない

RC★★変換:

- `★21`～`★25`: `1`～`5`
- `★★1`～`★★7`: `1`～`7`
- `st1`～`st3`: 数値をそのまま使用
- `st4`～`st6`: `4`
- `st7`～`st9`: `5`
- `st10`～`st12`: `6`
- `st13`以上: `7`

掲載対象は`progress=100`、version/chart公開中、`download_blocked=0`、`file_deleted_at/withdrawn_at/delete_requested_at IS NULL`、`is_rejected=0`、`collapsed_by_completion=0`、有効な32桁MD5ありをすべて満たすversionとする。BANは既存versionの掲載条件にしない。

同一MD5は、`completed_at`、`created_at`、version IDの降順で最初の1件だけを採用する。この重複排除は2表への分類前に行い、同一MD5が両方へ載らないようにする。異なるMD5の完成分岐はそれぞれ掲載してよい。

標準項目は`md5`, `level`, `title`, `artist`, `url_diff`, `name_diff`とする。採用versionに有効な`origin_url`がある場合だけ、原曲配布URLを`url`として追加する。`org_md5`は出力しない。`url_diff`は既存file APIの絶対URLとし、ZIPでは内部BMSのMD5を使い、外側ZIPのSHA-256を譜面hashとして出力しない。

元difficulty、採用version自身の差分名、数字パス版ラベル、作者、完成日時、subtitle、subartistは`bms_wip_`名前空間の独自項目として保持する。差分名がNULLの既存versionだけ起点差分名へfallbackする。本フィードは投稿者の自己申告難易度をRC★/RC★★へ統合した完成差分フィードであり、公式な難易度認定ではない。

公開難易度表ルートのGET/HEAD/OPTIONSだけは`Access-Control-Allow-Origin: *`とし、投稿・管理APIのOrigin制限は変更しない。headerと取込HTMLは約1時間、dataは約60秒キャッシュし、ETag再検証に対応する。古いdataが残っていてもDL可否は既存file APIが現在のD1/R2状態で再判定する。

## ORIGIN-URL-01 原曲配布URL

- `versions.origin_url`へ、version単位の任意snapshotとして保存する。既存versionは`NULL`のままとし、自動推測や一括補完はしない。
- 初回投稿フォームだけに`原曲配布URL（任意）`を表示する。未入力は`NULL`として保存する。
- 追記投稿ではクライアント値を受け取らず、親versionの`origin_url`を新versionへコピーする。分岐後に親の値が将来訂正されても、既存子versionのsnapshotは自動変更しない。
- URLは前後空白を除去し、絶対`http:`/`https:` URLだけを許可する。認証情報、制御文字、未エンコード空白を拒否し、fragmentを削除、queryを維持した`URL.toString()`結果を保存する。保存上限は2048文字とする。
- WorkerはURLへfetchせず、DNS、存在、リダイレクト、リンク先内容、安全性、永続性を確認しない。URL全文はconsoleや`post_logs`へ記録しない。
- `GET /api/charts`はversionごとに`originUrl`を返すが、公開一覧UIにはリンクやURL文字列を追加しない。
- RC★/RC★★では、MD5重複排除後に採用されたversion自身の有効な`origin_url`だけを`url`として出力する。URLなしでも掲載を継続し、`url_diff`と`md5`の既存仕様は変えない。`org_md5`は実装しない。
- 既存versionへの追加・訂正・削除、追記フォームでの編集は後続フェーズとする。

## WITHDRAWAL-LIFECYCLE-16A 取り下げ申請

> 履歴仕様。pending中の公開範囲・DL可否・分類は、後述の16Rを現行仕様として優先する。

- 利用者向け操作を「投稿を取り下げる」へ一本化し、新規`version_withdrawals`へ監査可能な申請履歴を保存する。`active`は行を作らず、最新の新方式行と旧`withdrawn_at/delete_requests`から公開状態を導出する。
- statusは`pending/processing/canceled/deleted/tombstoned`、request modeは`immediate/deferred`。16Aが作成するのはpendingだけで、processing、削除、墓標化、R2 cleanup、Cronは16B以降の責任とする。
- immediateは投稿から24時間以内、DB上の全直接子0、完成版置換参照0、旧delete request 0、active lifecycle 0、公開中、ファイル未削除をすべて満たす場合。予定時刻は申請時刻と同じで取消不可。16Aでは実削除されず処理待ちになる。
- deferredはimmediate条件を満たさない場合。予定時刻はD1の申請時刻から7日後で、予定時刻未満だけ投稿者が管理パスワードで取消できる。7日ちょうど以降はCron未実行でも取消不可。
- pending中はversion本体の`allow_append/download_blocked/withdrawn_at/is_hidden/file_deleted_at`を変更しない。一般一覧、検索、件数、お気に入り、RC★/RC★★からは除外する一方、直接chart詳細の版ツリーには状態・予定時刻付きで残す。DLは既存状態、追記は`allow_append`に従う。
- processing/tombstoned/deletedはDLと追記を拒否する。pending中に子versionが増えても申請を自動取消せず、将来の期限処理で再判定する。
- canceled履歴だけのversionはactiveへ戻し、一般一覧・お気に入りsnapshot・難易度表の通常条件へ復帰できる。取消後の公開APIでは古い申請日時・予定日時を露出しない。
- 旧`withdrawn_at`とpendingの旧`delete_requests`は新テーブルへbackfillせず、`legacy_withdrawn/legacy_delete_pending`として読み取り専用にする。新Pagesは旧操作APIへfallbackしない。
- 申請はクライアント生成idempotency keyを使う。生keyは永続化せず既存`HASH_SECRET`によるhashだけを保存する。同じkeyの再送は同じ結果、別versionへの再利用は競合エラーとする。
- post_logsは既存`withdraw_version` actionを再利用し、operation、request mode、outcome、固定error codeだけを記録する。パスワード、生idempotency key、生IP/UA、R2 key、SQLを保存しない。
- 新migrationにはversion/chartへの外部キーを置かず、将来versionを物理削除しても申請監査行を残せるようにする。同一versionのpending/processingはpartial UNIQUE indexで最大1件に制限する。
- 16B finalizerがない16A単体は本番配信禁止。本番migration、Worker deploy、Pages push、既存Cron変更を行わない。

## SITE-THEME-14 全体テーマ

- 公開Pagesと管理画面は`white`、`default`、`dark`の3テーマを提供する。初期値は既存の青緑グレー配色を引き継ぐ`default`とし、OSテーマから自動選択しない。
- 選択値は`localStorage`の`bms-wip-charts:theme:v1`へ保存する。許可値以外は削除して`default`へ戻す。ストレージを利用できない場合も現在ページ内の切替は継続し、値そのものをログへ出さない。
- 各HTMLは主CSSより先に`theme-init.js`を同期実行し、`html[data-theme]`と`color-scheme`を設定する。JavaScript無効時はCSSの`html:not([data-theme])`で`default`を表示する。
- 共通ヘッダーのテーマ選択はページ再読込、ページ移動、戻る・進む、別タブの`storage`イベントへ追従する。テーマ変更はフォーム入力、dirty判定、選択ファイル、検索、ページ番号、選択versionへ影響させない。
- UI配色は`theme.css`のsemantic tokenを使う。progressMapの投稿者layer色、ノート色、難易度や状態の意味色は識別性を保つため固定色または専用visual tokenとして扱う。
- 画面用CanvasはCSS変数から配色を取得し、`bms:themechange`で表示中のCanvasだけ再描画する。progressImageとして生成・送信・R2保存するPNGと保存済みPNGにはテーマを反映しない。
- Turnstileは`white`/`default`で`light`、`dark`で`dark`を使用する。実行中challengeは途中破棄せず、終了後に安全にremove/renderする。
- RC★/RC★★の取込リンクは現在テーマを`theme` queryへ付与する。Workerの取込HTMLだけが`white`/`default`/`dark`を反映し、header JSON、data JSON、キャッシュ条件、D1 queryは変更しない。

## WITHDRAWAL-LIFECYCLE-16B

> 履歴仕様。依存ありの自動墓標化経路は16Rで廃止され、現行finalizerはmanual reviewへ移行する。

### 取り下げ要求の確定処理

- `version_withdrawals`の`pending`またはlease期限切れの`processing`を、共通finalizerが条件付きUPDATEでclaimする。claim時は一意な`lease_token`、10分後の`lease_expires_at`、`processing_mode`、`attempt_count + 1`を保存する。
- 即時要求はAPI内で同じfinalizerを同期実行する。遅延要求は`scheduled_at <= CURRENT_TIMESTAMP`になったものを`processDueVersionWithdrawals()`で最大20件ずつ処理できるが、16BではCronや公開実行APIを追加しない。
- 削除直前に依存関係を再検査する。直接子version、`collapsed_by_version_id`参照、legacy `delete_requests`のいずれかが存在する場合は墓標化し、存在しない場合だけ物理削除する。子versionは公開状態に関係なく全件を依存として扱う。
- R2では譜面objectとprogressImage objectを個別に確認して削除する。objectが既にない場合は成功扱いとする。いずれかの削除に失敗した場合はD1を終端状態へ進めず、leaseを解放して再試行可能な`processing`として残す。
- R2削除後、D1変更の直前に依存関係を再検査する。依存が増えた場合は墓標化へ切り替える。物理削除はlifecycle更新、version削除、空chart、空songの削除をD1 batchで行う。
- R2削除後にD1更新が失敗した場合、次回実行はobject不在を正常な修復経路として扱う。R2とD1をまたぐ完全なトランザクションは存在しない。

### 物理削除と墓標化

- 物理削除では`versions`行を削除し、参照versionがなくなったchartとsongだけを削除する。`version_withdrawals`は外部キーを持たない監査行として`deleted`終端状態を保持する。
- 物理削除の依存判定は事前検査とD1確定条件で同じSQL条件を使う。公開状態を問わない直接子、`collapsed_by_version_id`参照、旧`delete_requests`のいずれかがあれば削除せず墓標化し、確定直前に依存が増えた場合も墓標化へ切り替える。
- 墓標化ではversion行を残し、`allow_append=0`、`download_blocked=1`、`file_deleted_at`を設定する。譜面objectとprogressImage objectは削除し、公開用の作者、コメント、原曲URL、ハッシュ、進捗、ファイル情報は返さない。
- 墓標は直接chart詳細の版ツリーだけに残し、固定文言「投稿者により取り下げられました」と「派生版を維持するため、版ツリー上の履歴だけ残っています。」を表示する。通常一覧、検索、version一覧、難易度表、お気に入りqueryからは除外する。
- `processing`も通常一覧から除外し、直接chart詳細では固定状態だけを返す。譜面DL、progressImage、miniView、追記、旧取り下げ・削除申請操作は拒否する。

### 冪等性と監査

- 同じidempotency keyの終端結果は、version行の取得や管理パスワード照合より先に`version_withdrawals`から返す。物理削除済みでも同じ`deleted`結果を返せる。別versionへの同じkey再利用は409とする。
- 削除済みversionを指定した詳細URLは、同じchartに公開可能なversionが残る場合、親（判別可能な場合）、代表または最新版、BASE、先頭versionの順で安全な移動先を選び、`history.replaceState`でURLを置き換える。chart自体が消えている場合は選択を解除して一覧へ戻す。
- お気に入りはversion ID単位で保存する。processing/tombstonedでは星を表示せず、お気に入り保存値自体は削除しない。activeへ戻った場合は同じ保存値から再表示できる。
- finalizerの個別成功、墓標化、再試行、失敗は`admin_logs`へ記録する。raw R2 key、パスワード、Secret、生IP、生UA、完全なhashは記録しない。
- 手動R2 cleanup、既存の30日cleanup Cron、管理承認・却下、D1 schema、R2保存形式は変更しない。

## WITHDRAWAL-LIFECYCLE-16C 毎時observe

> 履歴仕様。候補と分類は、後述の16Rで定義するhandling mode基準を現行仕様として優先する。

### Cronとモード

- 既存の毎日R2 cleanup `0 18 * * *`は変更せず、取り下げ監視用に毎時`0 * * * *`を追加する。Scheduled handlerは`event.cron`を完全一致で振り分け、各invocationでは対応する一方だけを実行する。
- 通常変数`WITHDRAWAL_CRON_MODE`が厳密に`observe`の場合だけ監視する。`off`、未設定、空文字、大文字、前後空白、`active`を含むその他の値はすべて安全側のoffとする。16C observe段階のリポジトリ設定は`observe`とし、active分岐、claim、finalizer実行は16Cに存在しない。
- 判定時刻はScheduled Eventの`scheduledTime`から一度だけ生成し、候補検索、lease期限、分類の全処理で共有する。単体試験では同じ`now`を注入できる。

### 候補と分類

- 候補は、`pending/immediate`、期限到達済み`pending/deferred`、leaseがNULLまたは期限切れの`processing`。期限前deferred、有効lease中processing、canceled/deleted/tombstonedは除外する。
- `scheduled_at ASC, id ASC`で最大21件を読み、先頭20件だけを分類する。21件目があれば`truncated=true`とする。
- 候補取得後に各lifecycle行を再取得し、取消、terminal化、lease更新などで候補外になった行は`ignored`とする。
- pendingで依存なしは`would_delete`、依存ありは`would_tombstone`。期限切れprocessingは同条件で`would_retry_delete`または`would_retry_tombstone`とする。
- version不存在、chart不整合、legacy lifecycle、外部状態競合、候補単位の予期しない読取失敗は`manual_review`とする。1件の失敗で残りの分類を中断しない。
- delete/tombstone判断は16B finalizerの読み取り専用依存調査と競合判定を共有する。直接子は公開状態を問わず数え、`collapsed_by_version_id`参照と旧`delete_requests`参照も物理削除阻止要因とする。

### 非変更と監査

- observeが行う書込みは`admin_logs`だけ。version、withdrawal、chart、song、旧削除申請、post log、lease、attempt count、error code、R2 objectおよびmetadataを変更しない。R2 HEAD/GET/LISTも実行しない。
- 実行ごとに、予定時刻、取得・分類件数、各分類件数、要確認・無視・エラー件数、上限超過、所要時間を集計記録する。個別診断はmanual reviewまたは予期しない候補エラーだけを最大5件記録する。
- ログにはパスワード、idempotency key/hash、lease token、IP/UA hash、R2 key、SQL、stack、作者、コメント、origin URL、ファイル名、譜面hash、progressMap、Secret、Binding値を保存しない。
- Pages、公開API、D1 schema、migration、Secret、R2保存形式は変更しない。active処理は16Dの別レビュー対象とする。

## WITHDRAWAL-LIFECYCLE-16R 現行取り下げ仕様

この節は16A～16Cの取り下げ分類、pending公開範囲、自動処理方針を上書きする。16C observe段階では`WITHDRAWAL_CRON_MODE=observe`とし、active実行は未実装とする。

- Workerは申請previewと申請確定の両方で共通分類を使う。投稿から24時間以内（24時間ちょうどを含む）かつ削除阻止依存なしは`immediate_delete`、24時間超過かつ依存なしは`grace_auto_delete`、経過時間を問わず依存ありは`manual_review`とする。
- 削除阻止依存は、公開状態を問わない全直接子version、`collapsed_by_version_id`参照、旧`delete_requests`参照とする。`allow_append`は分類条件に使わず、Pagesが表示中の子件数だけで確定しない。
- `immediate_delete`は理由不要・取消不可で、既存finalizerを同期実行して譜面R2、progressImage、versionを物理削除する。
- `grace_auto_delete`は理由を必須とし、申請から7日後を`scheduled_at`へ保存する。期限前は取消可能で、期限到達時に依存なしなら物理削除する。期限までに依存が増えた場合はR2やversionを削除せず、pendingのまま`manual_review`へ移す。通常の自動経路では墓標化しない。
- `manual_review`は理由を必須とし、自動処理候補および自動墓標化対象から除外する。管理画面には理由・申請日時・version識別情報・依存内訳を読み取り専用で表示し、最終判断操作は後続フェーズとする。
- 非即時申請の理由は前後空白を除去し、10～500文字とする。公開API、公開一覧、post_logs、consoleへ理由本文を出さず、ADMIN_TOKEN認証済み管理APIだけが返す。
- `versions.withdrawal_download_blocked`を取り下げ専用DL停止として使う。`downloadAvailable`は既存`download_blocked`と専用停止の両方が0の場合だけtrue。取消時は専用停止だけを0へ戻し、既存の管理者停止等を解除しない。
- `grace_auto_delete`と`manual_review`のpendingは、最近の投稿、`list.html`、検索、件数、お気に入り、詳細版ツリーへ残す。DLは404で停止し、追記は`allow_append`に従う。RC★/RC★★からは除外する。processing/tombstoned/deletedは従来どおり通常公開対象外とする。
- 取消は、期限前のgrace pendingまたはprocessing開始前のmanual pendingで可能とする。取消後は状態バッジを外し、専用DL停止だけを解除する。
- observerは、期限到達graceの依存なしを`would_delete`、依存ありを`would_move_to_manual_review`と分類する。期限切れprocessingも依存ありなら`would_move_to_manual_review`、依存なしなら`would_retry_delete`とする。manual reviewはpending/processingとも候補外にし、observeはD1/R2本体を変更しない。
- migration 0008は`version_withdrawals.handling_mode/request_reason`と`versions.withdrawal_download_blocked`を追加する。既存immediateは`immediate_delete`、既存deferredは適用時点の依存有無でmanual/graceへ分類し、pendingのmanual/graceだけに専用DL停止を設定する。

利用者向けの申請前表示は次を固定文言とする。

- 24時間以内・依存なし: 見出し「即時削除」、状態文「24時間以内の投稿なので即時削除できます。」、説明「投稿から24時間以内で、派生版や参照がありません。取り下げると直ちに削除され、元に戻せません。」、ボタン「取り下げて削除する」。理由欄は表示しない。
- 24時間以内・依存あり: 見出し「DL停止・管理者確認」、状態文「派生版があるため、DLを停止して管理者確認へ進みます。」、説明「派生版または参照があるため、自動削除できません。ダウンロードを停止し、申請理由を管理者が確認します。版ツリーの関係を保つため、履歴が残る場合があります。」、ボタン「DL停止を申請する」。理由欄を表示する。
- 24時間超過・依存なし: 見出し「DL停止・7日後に自動削除」、状態文「即時削除はできません。7日間に追記がなければ自動削除します。」、説明「投稿から24時間を超えているため、すぐには削除されません。ダウンロードを停止し、申請後7日間に新しい追記や参照がなければ自動削除します。」、ボタン「DL停止と自動削除を申請する」。理由欄を表示する。
- 24時間超過・依存あり: 24時間以内・依存ありと同じ見出し、状態文、説明、ボタン、理由欄を表示する。

申請後のgraceは状態・見出しを「DL停止・自動削除待ち」とし、「ダウンロードを停止しています。YYYY/MM/DD HH:mm以降、申請後の追記や参照がなければ自動削除します。」を表示する。manual reviewは状態・見出しを「DL停止・管理者確認待ち」とし、「ダウンロードを停止しています。申請理由と派生版の状態を管理者が確認します。」を表示する。どちらも取消ボタンを「取り下げ申請を取り消す」とし、「取り消すと、今回の申請によるDL停止を解除します。」を併記する。

## POST-ERROR-UI-9C 投稿フォームのエラー案内

- 初回投稿と追記投稿は共通の`BmsPostErrorUi`を使い、送信前に判定可能な入力不備をすべて収集する。同じfieldKeyは1件へまとめ、各欄の直下または欄内に具体文を表示して`aria-invalid`と`aria-describedby`を設定する。
- fieldKeyは`file/title/artist/originUrl/difficulty/chartName/author/progress/progressMap/completion/isRejected/allowAppend/comment/password/turnstile/appendContext`を扱う。テキスト・数値・checkbox・難易度・進捗範囲・ファイル解析・Turnstileは、現在値が有効になった時点でその欄だけを解除し、他欄のエラーを消さない。
- 送信1回につきDOM上で最初の不正欄へだけ移動する。投稿フォームを既存open処理で展開し、2回の`requestAnimationFrame`後に中央へスクロールして、スクロールを増やさずフォーカスする。通常はsmooth、reduced motionではautoとする。
- ファイル欄は全体へ移動してDrop Zoneをフォーカスする。難易度はPickerを展開して利用可能なタブまたは手入力欄、進捗Mapは全体と利用可能な先頭block、Turnstileは表示中の再試行ボタンを使用する。hidden/disabled入力は直接フォーカスしない。
- 対象DOMがない場合は例外化せず`#errorBox`へフォールバックし、consoleへ`POST_ERROR_TARGET_NOT_FOUND`とfieldKeyだけを警告する。入力値、パスワード、API detailは出さない。
- Worker応答は安定した`error.code`だけでfieldKeyへ対応付ける。ファイル形式・容量・ZIP検査結果・重複、原曲URL、進捗Map、完成版、没譜面、追記受付、パスワード、Turnstile、追記元状態を各欄へ案内する。曖昧な`INVALID_FORM`、サーバー／DB／R2障害、BAN、rate limit、network、JSON解析失敗など対応不能なcodeは従来どおり`#errorBox`へcode/messageだけを表示する。
- ファイル欄は既存`#chartFileDropError`を再利用する。解析失敗は新しいファイルの解析成功まで保持し、API再送信前は前回のAPI由来エラーだけを整理する。

## CHART-METADATA-EXTRACT 初回投稿のメタ情報候補

- BMS解析後の初回投稿フォームだけを対象に、`title/subtitle/artist/subartist`を生フィールド単位で解析する。追記モード開始時は候補・Undo・区切り状態を破棄して停止し、終了後は空の初回フォームへ戻して再開する。既存`parseBmsMeta()`と`local-bms-analysis.js`の責務は変更しない。
- `title/subtitle`の末尾に連続する`[差分名]`、`(差分名)`、`-差分名-`、`--差分名--`、`ー差分名ー`を差分名候補とする。ASCIIハイフンは左右1個または2個で個数一致、内部trim後1文字以上とし、3個以上・左右不一致・末尾でない表記は採用しない。転記値は囲みを含む元表記とする。
- 4欄共通で、ASCII大文字小文字を区別せず`obj`の`:/：/./．/;/；/@/水平空白`、`note/notes/chart/charter`の`:/：/;/；`を作者markerとして扱う。記号前後には半角・全角の水平空白を許可し、`object/objective/notebook/chartreuse`等の単語内一致は除外する。作者名は次の有効marker、同じ欄の次の差分名候補、または欄末尾の最も手前までとする。
- candidate配列は元文字列の`start`昇順とする。初期選択は最も右の作者候補、作者候補がなければ最も右の差分名候補とし、処理後は一時的に有効化された`/`を含む最も右の候補を選択する。左右矢印は端でdisabledになり、循環しない。
- 有効な作者markerの直前に同一欄の`/`がある場合、作者処理後に最後の関連`/`だけを除去専用候補として有効化する。作者と同時には削除せず、生フィールドをまたいで関連付けない。候補本体と境界空白だけを整理し、文字列全体、他候補、他の`/`や区切り記号はnormalizeしない。
- 候補UIは対象入力直下のinline panelに置き、`前の候補/次の候補/転記して除去/除去のみ/元に戻す/候補操作を閉じる`をbuttonとして提供する。閉じた欄は入力右端の「候補操作を表示」buttonから再表示できる。候補文字列は`textContent`で描画し、focusを奪わず、入力欄全体と吹き出しを`info`系semantic tokenで強調する。
- 「転記して除去」は差分名候補を`chartName`へ元表記のまま、作者候補を`author`へ名前部分だけ上書きして元欄から除去する。「除去のみ」は元欄だけを変更する。どちらもbubblingする`input`イベントを発火し、Phase 9Cの検証解除とdirty判定を維持する。
- Undoはsource fieldごとに直前1操作を保持し、最後の候補を処理した後もUndo専用panelを残す。destinationごとのoperation ID・revision・所有操作を管理し、より新しい転記または手入力がある場合はsourceだけを戻してdestinationを維持し、その旨を`aria-live`で通知する。
- source手入力は120ms debounceで再解析し、IME composition中は停止して`compositionend`で即時再解析する。source手入力はその欄のUndoと一時`/`候補を破棄し、destination手入力は自動復元権を失効させる。内部操作の`input`ではUndoを誤破棄しない。
- 吹き出し開閉設定だけを`localStorage`の`bms-wip-charts:chart-metadata-extract:v1`へ欄別に保存し、候補、入力値、ファイル、Undoは保存しない。初期値は全欄openとし、JSON破損、SecurityError、quota errorは安全に既定値へ戻す。新しいファイル、ファイル解除、form reset、投稿成功では一時状態だけを破棄し、開閉設定は維持する。
- Phase 9Cの`aria-invalid`とdanger色は候補表示に流用せず、既存`aria-describedby`へ候補status IDを集合追加する。candidate hostは動的な欄別エラーより前に置き、エラー強調との同時表示を許可する。390/760/1366px、`white/default/dark`、focus-visible、reduced motionへ対応する。
