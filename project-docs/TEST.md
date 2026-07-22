# テスト手順

## POST-FORM-TREE-12

- 単体BMS/BME/BMLの解析済み欄で空の補助行がなく、解析完了、ファイル名、block数/サイズ、変更・解除が視覚的に中央揃えになること。
- ZIPの解析済み欄だけ内部BMS名の補助行が表示され、外側ファイル名、block数/サイズ、変更・解除が崩れないこと。
- 320px幅でも単体譜面は1段、ZIPは内部名を含む2段として収まり、横スクロールが発生しないこと。
- 作者名だけを入力して投稿フォームを閉じた場合、`編集中：作者 ...`や汎用の`編集中`要約が表示されないこと。
- ファイル名と選択済み難易度は閉じた要約へ残り、フォームを開き直しても入力値、dirty状態、保存済み作者・管理パスワードが失われないこと。
- `BASE → 1`、`1 → 1-1`、`1-1 → 1-1-1`、`BASE → 2`、`2 → 2-1`の各子幹が親ノードの水平リンクから始まること。
- `1-1`と`1-2`など同じ親を持つ兄弟が同じ親幹を共有し、異なる親の子がBASE幹へ誤接続しないこと。
- 親から下へ直線、子の直前だけ角丸エルボー、子ノードまで短い水平線という統一形状になり、末端ノードの下へ不要な線が残らないこと。
- 折り畳み時は省略マークを含む親子経路、展開時は復帰した中間行を含む親子経路へ再計算され、再折り畳みでも破綻しないこと。
- トップの最近の投稿と選択中の投稿で同じ接続規則になり、初期10件、追加10件、詳細選択後の再描画で線が重複・欠落しないこと。
- PC幅と320px幅でdepth順のX座標が維持され、ラベル、進捗、操作列へ線が重ならないこと。
- 投稿、追記、進捗編集、DL、お気に入り、管理メニュー、Turnstile、既存API/FormDataが従来どおり動作すること。

## POST-FORM-UX-11

- 単体BMS/BME/BMLとZIPの解析済み表示で、状態、外側ファイル名、block数・サイズ、変更・解除の位置が揃うこと。ZIPだけ内部BMS名が表示され、単体譜面には空の補助行がないこと。
- 長い外側ファイル名とZIP内部名がellipsisになり、titleで全文を確認でき、操作ボタンを押し出さないこと。
- フォームパネル、各セクション、操作面、白い入力面の明度差が分かり、従来より眩しさが抑えられていること。
- 変更、解除、難易度変更、完成版、追記キャンセル、投稿の通常/hover/focus/active/disabled/submitting状態が背景から識別できること。
- 完成版ボタンは投稿状態パネル内に常時表示され、初回投稿では常にdisabled、追記投稿では0～79%でdisabled、80%以上の未指定時に有効であること。
- 進捗操作帯の左右端と進捗レールが揃い、進捗度、数値、%、補足文が縦中央で読めること。
- 差分情報の譜面情報と作者情報が小見出し、薄い背景差、区切り線で判別でき、760px以下では自然に1列化すること。
- 保存値なしの初期表示では作者・パスワードinputが空で、両保存チェックがOFFであること。
- 作者キー`bms-wip-charts:author:v1`と既存パスワードキー`bms-wip-charts-admin-password`がある場合、対応inputとチェックが復元されること。
- 作者・パスワードの保存チェックをONにしただけではlocalStorageへ書き込まれないこと。
- 初回投稿成功後だけ、ONかつ空でない作者・パスワードが保存され、form reset後に復元されること。
- 初回投稿失敗時は新しい作者・パスワードが保存されず、以前の保存値、入力値、チェック状態が維持されること。
- 追記開始時に保存済み作者・パスワードが復元され、親version作者を作者inputへ自動設定しないこと。
- 追記投稿成功後だけ共通処理で保存され、追記失敗時は新値を保存せず、追記キャンセル後は保存済み値だけを復元すること。
- 作者またはパスワードの保存チェックをOFFにすると、対応する保存値だけが即時削除され、現在入力中の値は維持されること。
- 「保存情報を削除」の確認キャンセルでは変更がなく、確認OKでは2キーと2チェックだけが消え、現在入力中の作者・パスワードは維持されること。
- 保存情報削除の成功・失敗がrole=statusで通知され、localStorage障害でも投稿操作を継続できること。
- 自動復元だけ、保存チェック変更だけ、保存情報削除だけではbeforeunloadが発生せず、復元後の作者・パスワード編集では発生すること。
- 投稿管理dialogが共通preferences controllerの保存済みパスワードを復元し、値をconsoleへ出さないこと。
- 320/390/760/1024/1366/1920pxでファイル欄、作者保存、管理レール、Turnstile、投稿操作が重ならず、横スクロールがないこと。
- 初回投稿、追記投稿、file drop、BMS/ZIP解析、progressMap、miniView、PNG、Turnstile、投稿成功後詳細移動、管理操作に回帰がないこと。

## POST-FORM-UX-10

- 未選択、dragover、解析中、解析完了、ミニビュー非対応、解析エラーの状態文言を確認すること。
- BMSとZIPの解析成功時に「✓ 解析完了」、ファイル名、ZIP内部名、block数、サイズ、変更、解除が表示されること。
- 長いファイル名と内部パスが操作ボタンを押し出さず、省略部分をtitleで確認できること。
- 解析済みファイル欄で状態、ファイル名、block数・サイズ、変更・解除の縦位置が揃うこと。
- 差分情報が「譜面情報」と「作者情報」に分かれ、譜面情報に難易度と差分名、作者情報に差分作者と補足文があること。
- 760px以下では譜面情報、想定難易度、差分名、作者情報、差分作者の順に1列表示されること。
- 難易度の未選択、★、★★、sl、st、手入力、縮小、変更、追記初期値、reset、validationが従来どおり動くこと。
- 進捗度が進捗グラフ・レール・小節ラベルの直下にあり、完成版・没譜面・追記受付がその次の投稿状態パネルに並ぶこと。
- 完成版ボタンが投稿状態パネル内に常時表示され、初回は常にdisabled、追記は0～79%でdisabled、80%以上の未指定時に有効であること。
- 進捗0/9/72/79/80/99/100%、没譜面、block塗り、drag、親layer、miniView、進捗同期を確認すること。
- フォーム、セクション、input、ファイル操作面、進捗操作面の明度差が分かり、全周枠やshadowが増えていないこと。
- 320/390/760/1024/1366/1920pxで横スクロールがなく、ファイル操作、差分情報、進捗操作、最下部が重ならないこと。
- 初回投稿、追記投稿、file drop、BMS/ZIP解析、progress PNG、Turnstile、beforeunload、投稿成功後の詳細移動が従来どおり動くこと。

## POST-FORM-UX-09A

- 解析済みBMSがPCで1～2行のコンパクト表示になり、ファイル名、block数、サイズ、変更、解除が確認できること。
- ZIPでは外側ファイル名と内部BMS名が確認でき、長い名前・内部パスでも変更/解除ボタンが押し出されないこと。
- 320pxでは解析済み情報が2～3段へ折り返し、横スクロールが発生しないこと。
- 未選択、解析中、解析エラーのファイル表示がPOST-FORM-UX-08の状態表示を維持すること。
- 難易度未選択時はピッカーが展開され、★/★★/sl/stの数字選択直後に値と変更ボタンだけの要約へ縮小すること。
- 手入力中はピッカーを維持し、Enterまたはフォーカス移動で有効値が要約表示になること。
- 変更ボタンで現在値を維持して再展開し、難易度validationエラーでは自動展開すること。
- 追記モードの初期難易度が要約表示になり、初回/追記成功、追記キャンセル、resetでは未選択・展開状態へ戻ること。
- 1366pxで未選択時の差分情報が難易度左列、差分名・作者右列になり、選択後は3列へ圧縮されること。
- 1024pxでは2列、760px以下では1列になり、手入力と追記モードでも入力欄が重ならないこと。
- 進捗度inputが約88pxで進捗マップ上部にあり、`%`と補足文が読めること。完成版・没譜面・追記受付の関係は直下の投稿状態パネルで読み取れること。
- 完成版ボタンが投稿状態パネル内に常時表示され、初回は常にdisabled、追記は80%未満でdisabled、80%以上の未指定時に有効であること。
- 進捗概要が`ノーツ 3,000 / 122区間 / 小節 2–125`形式になり、進捗マップ・塗り操作・miniViewが変わらないこと。
- PC最下部がコメント約60%・管理レール約40%の2列で、管理パスワード、保存設定、Turnstile、追記キャンセル、投稿ボタンの順になること。
- 320/390/760pxではコメントから投稿操作まで1列になり、投稿ボタンとTurnstileが画面外へ出ないこと。
- helper textが短文化されても、原曲URL、差分名、進捗、没譜面、管理パスワード、保存設定、コメントの意味が維持されること。
- セクションの左アクセントとlegendは残り、全周枠・背景が弱まっても入力欄が判別できること。
- フォーム開閉、beforeunload、初回投稿、追記投稿、progress PNG添付、投稿成功後の詳細表示が従来どおり動くこと。

## POST-FORM-UX-08

- 閉じた投稿フォームへファイルをドラッグすると控えめなドロップ表示になり、1件をドロップするとフォームが開いて既存解析が1回だけ始まること。
- ファイル以外の文字列・リンクドラッグでは投稿フォームが反応せず、document側の既定動作も不要に止めないこと。
- 開いたフォームのドロップゾーンをクリック、Enter、Spaceで操作でき、BMS/BME/BML/ZIPを選択またはドロップできること。
- 無効な拡張子、BMS 2MiB超過、ZIP 5MiB超過、複数ファイルのエラーがドロップゾーン直下に表示され、内部detailやファイル内容を出さないこと。
- 空、ドラッグ中、解析中、解析済み、エラーの各状態が判別でき、解析済みZIPでは既存解析結果の外側ファイル名・内部BMS名・ブロック数が表示されること。
- ドロップしたFileが既存`#chartFile`へ入り、`change`が1回だけ発火して初回/追記の解析が二重実行されないこと。
- ファイル変更・解除・初回/追記切替・追記キャンセル・投稿成功resetで古いドロップ表示、進捗マップ、ローカルminiViewが消えること。
- 解析中に別ファイルへ変更した場合、古いrevisionの解析完了が現在のファイル表示を上書きしないこと。
- 初回投稿のファイル変更時は曲名・サブタイトル・アーティスト・サブアーティストを再解析し、原曲URL・差分情報の既存入力を不必要に消さないこと。
- 追記投稿では親の楽曲情報・progress layerを維持し、親versionの差分名を編集可能な初期値として使い、今回選択したファイルの格子一致後だけ進捗編集を表示すること。
- ファイル未選択時の進捗欄には案内文だけが表示され、解析中は解析状態、成功後だけグラフ・編集ブロック・進捗度・没譜面・完成操作が表示されること。
- 完成操作が投稿状態パネル内へ常時表示され、初回投稿、没譜面、追記80%未満でdisabled、追記80〜100%の未指定時に有効になること。
- 公開フォームに進捗PNG確認・ダウンロードUIが表示されない一方、初回投稿と追記投稿のFormDataへ`progressImage` PNGを追加できること。
- `originUrl`が楽曲情報区分に1件だけ表示され、ID/name、初回送信、追記時のWorker継承が変わらないこと。
- 320/390/760/1024/1366/1920pxで横スクロール、テキスト重なり、操作不能がなく、focus-visibleとaria-liveが機能すること。
- Turnstile、投稿レート制限、beforeunload、パスワード保存、投稿成功後の詳細移動、最近の投稿、独立一覧に回帰がないこと。

## POST-FORM-MINIVIEW-01

- 初回投稿フォームで単体BMS/BME/BMLを選択すると、進捗解析と同じファイル内容からローカルminiViewが1回だけ生成されること。
- Store/Deflate ZIPでは内部の唯一のBMS/BME/BMLを1回だけ展開し、進捗解析とminiView解析が同じbuffer・内部ファイル名を使うこと。
- 7key SPの白鍵、青鍵、赤皿、LNOBJ、LNTYPE 1、変拍子、小節線、拍線、細分線、小節番号、初期BPM、block開始時BPM、block内BPM変更が一覧の吹き出しと同じルールで表示されること。
- 密度グラフ側のhover/focus/tapで対応blockの吹き出しが表示され、クリック固定、別blockへの直接切替、左右キー、Home、End、Escが動作すること。
- 進捗編集blockのclick・drag塗りが従来どおり動作し、ミニビュー固定操作が発生しないこと。
- BPM変更の有無、2桁・3桁・4桁小節のblock切替で、吹き出し外枠、Canvas、鍵盤領域、BPM帯44px、小節番号帯のCSS pixel位置が変わらないこと。
- 追記フォームでは親versionではなく今回選択した新ファイルのminiViewを表示し、親progress layerは従来どおり維持されること。
- 追記元と新ファイルのblock格子が一致する場合だけpreviewが有効になり、不一致時はpreviewが無効かつ既存の投稿拒否表示が維持されること。
- ファイル変更・解除、初回/追記切替、追記キャンセル、投稿成功後reset、フォームを閉じた場合にpayload、hover、固定状態、吹き出しが破棄されること。
- 解析中に別ファイルへ変更した場合やZIP解析中にモードを切り替えた場合、古いrevisionの解析結果が後から表示されないこと。
- RANDOM系、LNTYPE 2、7key判定不能、2P、地雷・特殊レーン、不正LN、重複レーン行、イベント数・payload上限超過は空Canvasではなく「ミニビュー非対応」となり、投稿自体は妨げないこと。
- Pages生成payloadとWorker生成payloadで、status、mode、表示小節、音楽位置、tap/LN件数、eventData、measureLengths、BPM情報が同じfixtureに対して一致すること。
- ローカルminiView payloadがFormDataへ追加されず、Worker API、D1、R2、Secret、Turnstile、投稿レート制限の仕様が変わらないこと。
- 一覧ミニビュー、初回投稿、追記投稿、検索、ページング、お気に入りの回帰がないこと。

## CHART-MINIVIEW-01

- 新規7key SPの初回投稿と追記投稿で`measureNotes.schemaVersion=3`とreadyなminiViewが保存されること。
- 単体BMSと同一BMSを1件含むZIPで同じミニビューpayloadになること。
- UTF-8、UTF-8 BOM、CP932の7key譜面を解析できること。
- 通常ノート、`16`スクラッチ、LNTYPE 1、LNOBJ、小節長変更が正しく描画されること。
- RANDOM/IF/SWITCH系が`MINIVIEW_RANDOM_UNSUPPORTED` warningになること。
- LNTYPE 2が`MINIVIEW_LNTYPE2_UNSUPPORTED` warningになること。
- 未閉鎖・重複・競合LNが`MINIVIEW_MALFORMED_LN` warningになること。
- 2P側、地雷、特殊チャンネル、判定が曖昧な5keyが`MINIVIEW_UNSUPPORTED_MODE` warningになること。
- ミニビュー未対応でも投稿、progressMap、progressImage、R2/D1保存が従来通り成功すること。
- miniView保存値が32KiB以下で、超過時は`MINIVIEW_TOO_COMPLEX`になること。
- `GET /api/charts`に完全なイベントpayloadが含まれず、available/mode/urlだけが返ること。
- 公開versionの専用API取得、ETagによる304、schemaVersion 2と非表示version/chartの404を確認すること。
- 既存schemaVersion 2ではミニビューなしでも一覧と進捗サムネイルが崩れないこと。
- IntersectionObserverに入った可視行だけを取得し、初期折り畳み中は取得しないこと。
- 展開後に初めて中間履歴行を取得し、再描画ではversionIdキャッシュを再利用すること。
- 同時取得が最大4件で、深い分岐と20chart以上でも操作が大きく重くならないこと。
- 吹き出しCanvasと拡大Canvasが空白にならず、devicePixelRatioが最大2であること。
- スマホ幅でdialogが画面外へはみ出さず、横スクロールが出ないこと。
- 既存のツリー、折り畳み、進捗サムネイル、DL、追記投稿、お気に入りが壊れないこと。
- 進捗サムネイル上のポインタ位置に応じて実ブロック番号が切り替わり、対応する小節範囲の吹き出しが表示されること。
- hover解除で吹き出しが閉じ、連続hover時に同じversionのpayloadを再取得しないこと。
- Tabで進捗ブロック操作面へ移動でき、左右キー・Home・Endでblockを変更できること。
- EnterまたはSpace、スマホtapで吹き出しを固定/解除でき、Escまたは外側操作で閉じられること。
- 画面端とスマホ幅で吹き出しがviewport外へ大きくはみ出さず、横スクロールが発生しないこと。
- 白鍵盤ノートが薄灰、青鍵盤ノートが青、スクラッチが赤、LNが各レーン同系色、小節線が薄灰で描画されること。
- 通常4/4小節の16分、24分、32分、48分イベントが元の`pairIndex/pairCount`位置で等間隔に描画されること。
- `#xxx02`が0.75、0.5、1.5の小節と複数回の小節長変更で、ノート・LN・スクラッチ・16分/1拍/小節グリッドが同じ累積音楽位置を使うこと。
- progressMap blockの`startPosition/endPosition`とminiView切り出し範囲が一致し、`start <= event < end`だけが表示されること。
- block終了が小節境界と一致する場合に不要な次小節番号・小節線・ノートが含まれないこと。
- 0.75小節に通常16分相当の区間が12個表示され、小節の描画高が通常小節の75%になること。
- スクラッチレーン幅が通常鍵盤の1.5倍、通常7鍵が同じ幅であること。
- 新規miniView payload schemaVersion 3が32KiB以下で、単体BMSとZIP内部BMSから同じ分数イベントとBPMイベントを生成すること。
- 旧miniView payload schemaVersion 1は不正確な拡大表示へfallbackせず、ミニビュー非対応になること。
- miniView payload schemaVersion 2は従来の精密ノート表示を維持し、BPM注釈だけを表示しないこと。
- measure notes schemaVersion 2やminiView未対応versionでは操作レイヤーを表示せず、進捗サムネイルだけが従来どおり動作すること。
- 一覧右側に常時全体ミニビューが表示されず、進捗サムネイル列の幅を圧迫しないこと。
- 吹き出しが黒系背景となり、16分線、1拍線、小節境界線を強さの違いで判別できること。
- 白鍵、青鍵、スクラッチ、LNが色と太さで判別でき、最上段・最下段のノーツが枠へめり込まないこと。
- 吹き出し右側の番号帯に、現在表示している各小節番号が表示されること。
- 固定中に別ブロックをクリックすると直接固定先が切り替わり、同一ブロック再クリックで解除されること。
- hover中は細枠、固定中は強い枠で選択中blockが分かること。
- 読み込み中表示とminiView非対応表示が空白にならず、一覧行高を変えないこと。
- 小節開始線`#E8E8E8`が1拍線`#4A4A4A`より明るく、1拍線が16分線`#2C2C2C`より明るいこと。
- 通常ノート、スクラッチ、LN始点・終点が正確なタイミング線から1〜2px上へ描画され、相対間隔とblock判定は変わらないこと。
- LN本体が始点・終点マーカー中心へ自然につながり、端点が同系の明色、本体が暗色であること。
- スクラッチLN端点が`#FF5555`、本体が`#9F343A`で、色の強弱が逆転していないこと。
- 初期BPM、channel 03、channel 08、小数BPM、小節途中、変拍子内のBPM位置が分数座標のまま保存・表示されること。
- block開始時点の有効BPMが上部情報欄へ表示され、block内変更だけが左側の緑色注釈帯へ表示されること。
- 拡大ミニビューの通常ノート、LN端点、スクラッチがUX-03より少し厚く、数学上のイベント位置は変わらないこと。
- ノートの視覚オフセットが0.9pxとなり、グリッド線へ重ならずUX-03より近く見えること。
- block内にBPM変更がない場合は左側の緑色注釈帯を表示せず、上部情報欄にblock開始時BPMだけを表示すること。
- block内にBPM変更がある場合は上部情報欄に開始時BPM、左側の変更位置に変更後BPMだけを表示すること。
- `_Untimecapsel_ReMeMBeR.bms`相当で、小節46-47と57-58は`BPM 202`、小節50-52は`BPM 101`、小節53-54は開始時`BPM 101`と途中変更`202`になること。
- block開始より前のBPM変更は上部の現在BPMだけへ反映され、左側注釈には重複表示されないこと。
- block開始位置ちょうどのBPM変更は上部の変更後BPMと最下端付近の緑色注釈の両方へ表示されること。
- block途中のBPM変更は正確なY位置に表示され、block終了位置ちょうどの変更は現blockへ出ず次blockの開始注釈になること。
- BPM注釈文字がCanvas上下端でクリップされず、同位置に複数指定がある場合は解析済みの最終有効値だけを表示すること。
- 小節`1`、`99-100`、`999-1000`で見出しが途中改行されず、右側番号帯が鍵盤へ重ならないこと。
- 小節番号帯が表示番号の実測幅に応じて36px以上へ拡張され、吹き出しがスマホviewportを越えないこと。
- BPM変更の有無にかかわらず左側BPM注釈帯が44px、鍵盤との間隔が4pxで固定されること。
- BPM変更なし→なし、なし→あり、あり→なし、あり→ありのblock移動で、鍵盤領域の左端・レーン幅・右側小節番号帯・吹き出し全体幅が変わらないこと。
- BPM変更なしblockは左帯の背景と枠だけを表示し、緑文字やマーカーを表示しないこと。
- BPM変更ありblockは固定された左帯へ従来の正確なY位置とclampで変更値を表示し、現在BPMは上部情報欄だけへ表示すること。
- 同じ進捗サムネイル内のblock切替では`positionRangePreview()`を再実行せず、target変更、再表示、scroll、resize時だけ再配置すること。
- BPM変更なし・ありを10回以上往復し、吹き出しとCanvasの`getBoundingClientRect()`、`lanePlotX/lanePlotWidth`がCSS pixel単位で完全一致すること。
- headerが20px、hintが15pxの固定高となり、BPM値・block番号・小節番号の変化で吹き出し高さが変わらないこと。
- 右側小節番号帯がversion全体の最大桁幅で固定され、2桁、3桁、4桁小節を切り替えても鍵盤領域と番号帯が動かないこと。
- `_Untimecapsel_ReMeMBeR.bms`で初期150、小節12先頭202、小節48先頭101、小節54先頭202となり、小節49開始時の表示が101になること。
- Worker typecheck、Pages JavaScript構文検査、Worker dry-run、`git diff --check`が成功すること。

## TURNSTILE-01

- 初回投稿で共通Turnstile controllerからtokenを取得し、投稿できること。
- 追記投稿で同じTurnstile controllerからtokenを取得し、投稿できること。
- 初回・追記とも`X-Turnstile-Token`ヘッダーを送ること。
- `progress-image-formdata.js`のfetch wrapper後も`X-Turnstile-Token`が維持されること。
- requiredモードでtokenなしがHTTP 400 `TURNSTILE_REQUIRED`になること。
- requiredモードで不正token、期限切れ相当、再利用token、2048文字超過がHTTP 403 `TURNSTILE_FAILED`になること。
- Secret不足、Siteverify timeout・障害・不正レスポンスがHTTP 503 `TURNSTILE_UNAVAILABLE`になること。
- `POSTING_BLOCKED`がTurnstileより先にHTTP 403で返ること。
- `POST_RATE_LIMITED`がTurnstileより先にHTTP 429で返ること。
- Turnstile拒否時にmultipart/progressImage解析、file SHA計算、ZIP/BMS解析、R2保存、D1 version作成が行われないこと。
- `TURNSTILE_REQUIRED`と`TURNSTILE_FAILED`がclient rejected投稿レート制限へ含まれること。
- `TURNSTILE_UNAVAILABLE`が投稿レート件数へ含まれないこと。
- 拒否時の`post_logs`に既存action、`result=rejected`、error code、`stage=pre_multipart_turnstile`、再試行有無、安全な判定分類だけが入ること。
- token、Secret、生IP、生UA、生のSiteverifyレスポンス・詳細error codeがレスポンス、post_logs、consoleへ出ないこと。
- CORS preflightで`X-Turnstile-Token`が許可され、既存Origin制限が緩和されていないこと。
- 投稿成功・失敗後にwidgetがresetされ、再投稿で新しいtokenを取得できること。
- API失敗やTurnstile失敗後も入力済みフォーム内容が消えないこと。
- Turnstile script読込失敗時は投稿せず、再読込操作が表示されること。
- Managed widgetがスマホ幅でフォームからはみ出さないこと。
- observeモードではtokenなしと検証失敗を安全に観測しつつ投稿を許可すること。
- requiredモードではtokenなし・検証不能をfail closedで拒否すること。
- 閲覧、DL、取り消し、削除申請、管理API、難易度表、Cron、R2 cleanupへTurnstileが追加されていないこと。
- Worker typecheck、Pages JavaScript構文検査、Worker dry-run、`git diff --check`が成功すること。

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

## SEARCH-PAGINATION-01 確認項目

- `GET /api/charts?page=1&pageSize=20`がchart単位で最大20件を返すこと。
- レスポンスの`pagination`に`page`, `pageSize`, `total`, `hasNext`が含まれること。
- 検索なしで通常一覧が表示されること。
- 曲名、サブタイトル、アーティスト、サブアーティスト、差分名、公開中version作者で検索できること。
- 日本語の部分一致検索が動作すること。
- `%`, `_`, `\\`を含む検索語が意図しないLIKEワイルドカードにならないこと。
- 100文字を超える`q`が`INVALID_QUERY_PARAM`で拒否されること。
- 非公開versionの作者だけが一致するchartは検索結果に含まれないこと。
- version作者が一致した場合も、該当chartの全公開versionと祖先ツリーが返ること。
- COUNTと一覧取得の検索条件が一致し、`total`がchart件数になること。
- 20件を超える場合に「さらに読み込む」が表示されること。
- 最終ページで「さらに読み込む」が非表示になること。
- 追加取得時に同一chart IDが重複表示されないこと。
- 検索条件変更時に取得済み一覧とページ位置がリセットされること。
- 古い検索レスポンスが新しい検索結果を上書きしないこと。
- URLの`q`から検索状態を復元できること。
- 空検索、該当なし、初回取得失敗、追加取得失敗が区別して表示されること。
- 追加取得失敗時に既存一覧が消えず、再試行できること。
- 初回一覧取得が複数の表示拡張から重複実行されないこと。
- 検索・追加取得後も数字パス版ラベル、ツリー、祖先関係、中間履歴折り畳みが維持されること。
- 検索・追加取得後も進捗サムネイル、DL、追記投稿、管理操作が動作すること。
- 投稿・追記・管理操作後の一覧再取得が現在の検索条件で動作すること。
- お気に入り★と、取得済み検索結果内のお気に入りのみ表示が動作すること。
- PC幅とスマホ幅で検索フォームと「さらに読み込む」を操作できること。
- Workerの`npm.cmd run typecheck`が成功すること。

## LIST-DATA-02A-B 確認項目

version単位の独立投稿一覧APIとフィルターを確認する:

- `GET /api/versions`が公開versionを1件1itemで返し、`pageSize=20`でversion単位にページングすること。
- `charts.is_hidden=1`, `versions.is_hidden=1`, `collapsed_by_completion=1`のversionが返らないこと。
- 取り下げ、削除申請中、DL停止の公開versionは返り、状態フラグが正しいこと。
- `status=incomplete`が`progress<100`かつ非没、`complete`が`progress=100`かつ非没、`rejected`が没譜面だけを返すこと。
- `sort=new`が`versions.created_at DESC, versions.id DESC`、`sort=updated`が`charts.updated_at DESC, versions.created_at DESC, versions.id DESC`であること。
- 曲名、サブタイトル、アーティスト、サブアーティスト、差分名、そのversion作者を検索できること。
- 日本語検索と、`%`, `_`, `\\`を通常文字として扱う検索が動作すること。
- SELECTとCOUNTの公開・検索・状態条件が一致し、`total`がversion件数になること。
- `versionLabel`が`BASE`, `1`, `1-2`などの数字パスになること。
- `isNew`と`newUntil`がchart初回公開から168時間で判定され、追記日時で延長されないこと。
- `serverTime`が返ること。
- コメントなしは`hasComment=false`かつ空preview、コメントありはtrim・空白正規化された`commentPreview`になること。
- コメントpreviewが80 Unicode code point以内では省略記号なし、81以上では絵文字を壊さず80 code pointと`…`になること。
- コメント本文、HTML要素、リンクが一覧DOMへ挿入されず、previewが`textContent`で表示されること。
- `dateFrom`だけ、`dateTo`だけ、両方の期間検索ができ、JST 00:00の開始を含み、終了日の翌JST 00:00を含まないこと。
- `sort=new`の期間が`versions.created_at`、`sort=updated`の期間が`charts.updated_at`へ適用され、COUNTとSELECTで一致すること。
- 存在しない日付、厳密な`YYYY-MM-DD`でない値、前後空白、`dateFrom > dateTo`がGETでは`INVALID_QUERY_PARAM`、お気に入りPOSTでは`INVALID_FAVORITE_QUERY`になること。
- 不正な`q`, `sort`, `status`, `page`, `pageSize`が`INVALID_QUERY_PARAM`になること。
- `POST /api/versions/query`が最大200件のversion IDを重複除去して検索すること。
- お気に入りqueryでも検索、並び順、状態、ページングが通常一覧と一致すること。
- お気に入りqueryでも`dateFrom`, `dateTo`とJST境界が通常一覧と一致すること。
- 非公開または存在しないお気に入りがitemsから除外され、`unavailableFavoriteCount`へ加算されること。
- 検索・状態だけで除外された公開お気に入りは`unavailableFavoriteCount`へ加算されないこと。
- お気に入りID 0件で空一覧を返し、D1エラーにならないこと。
- 不正body、文字列以外のID、200件超過が`INVALID_FAVORITE_QUERY`になること。
- お気に入りqueryレスポンスが`Cache-Control: no-store`であること。
- `list.html`が日付、タイトル、難易度、作者、コメント、進捗を1version1行で表示すること。
- PCでは6列が整列し、コメントは1行省略、進捗は64px固定中央揃えになること。スマホではコメントありの行だけコメント段が追加され、横スクロールが出ないこと。
- 状態・並び順がネイティブradioで選べ、期間入力は適用前に一覧へ反映されないこと。
- 今日・今週・今月・今年の期間がAPI `serverTime`のJST日付から算出され、端末timezoneを変えても同じになること。
- 件数表示がversion件数であり、chart件数と混在しないこと。
- 並び順、状態、お気に入りの変更で1ページ目へ戻ること。
- `q`, `sort`, `status`, `favorites`, `dateFrom`, `dateTo`, `page`がURLへ保存され、再読込と戻る・進むで復元されること。
- 古いリクエストが新しい結果を上書きしないこと。
- 前へ、ページ番号、次へが動作し、1ページだけの場合はページ操作を隠すこと。
- ページ取得失敗時に直前の行を残し、再試行できること。
- お気に入り0件、非公開化されたお気に入り、検索結果なし、API失敗を区別して表示すること。
- NEW、没譜面、取り下げ、削除申請中、DL停止の小さい状態表示が主情報を圧迫しないこと。
- 各versionの相対時刻がAPIの`serverTime`と`createdAt`を基準に、1時間未満、1〜23時間、1〜7日でトップと同じ文言になり、192時間以上・未来日時・不正日時では表示されないこと。
- 相対時刻が日付セル内でNEWと異なる控えめな見た目になり、日付、タイトル、コメント、進捗の視線バランスを崩さないこと。
- 1366pxでタイトル列が過度に広がらず、長いタイトルは最大2行、差分名と版は1行になること。
- 320px, 390px, 760pxで横スクロールがなく、フィルターとページ操作が使えること。
- トップの詳細一覧、ツリー、進捗サムネイル、miniView、お気に入り★、投稿・追記が壊れていないこと。

## CHART-DETAIL-LINK-04 確認項目

独立投稿一覧から指定chart/versionを正確に開く導線を確認する:

- `GET /api/charts/:chartId`が公開chartを1件だけ、`GET /api/charts`と同じchart/version形式で返すこと。
- 詳細APIが公開中のBASE、子版、深い分岐、完成版、没譜面、取り下げ、DL停止、削除申請中を状態つきで返すこと。
- `collapsed_by_completion=1`の中間履歴を返し、`versions.is_hidden=1`は返さないこと。
- 非存在chartと`charts.is_hidden=1`が同じHTTP 404 `CHART_NOT_FOUND`になること。
- 空ID、不正文字、160文字超過、不正URL encodingがHTTP 400 `INVALID_CHART_ID`になること。
- GET以外がHTTP 405となり、`/api/charts/:chartId/versions`など既存routeを詳細routeが奪わないこと。
- CORSが既存方針と一致し、成功・404レスポンスが`Cache-Control: no-cache`であること。
- D1失敗が`CHART_DETAIL_QUERY_FAILED`となり、SQLや内部例外を返さないこと。
- `list.html`のタイトルリンクが`index.html?chartId=<chartId>&versionId=<versionId>#list`形式で、BASE、子版、深い分岐、同名曲の別chartを区別すること。
- 新しいタブ、URL再読み込み、ブラウザの戻る操作で動作し、戻った`list.html`の検索・状態・並び順・期間・お気に入り・ページがURLから復元されること。
- トップの通常一覧より上に「選択中の投稿」が表示され、通常一覧が消えないこと。
- 指定versionだけを正確に特定し、中間履歴ならその履歴グループだけを展開すること。無関係な折り畳み履歴を展開しないこと。
- 対象行がsticky headerに隠れない中央位置へスクロールされ、focusされ、3～5秒だけ枠と文字で強調されること。
- `prefers-reduced-motion: reduce`でsmooth scrollを使用しないこと。
- chartなし、versionなし、API失敗、不正または片側だけのパラメータを区別し、通常一覧を壊さないこと。
- API失敗時に再試行でき、内部detailやID検証内容を利用者へ表示しないこと。
- 選択中カードと通常一覧の両方でツリー、折り畳み、進捗サムネイル、miniView、お気に入り、管理UIが動作すること。
- 320px、390px、760px、1366px、1920pxで横スクロールが発生せず、選択中カードと戻る導線を操作できること。

## TOP-DETAIL-RECENCY-07 確認項目

- 通常トップが`charts.updated_at DESC, charts.id ASC`順で最初の10chartを表示し、同じchartが重複しないこと。
- 「さらに10件読み込む」で既存カードを残したまま次の10chartが追加され、最終ページでは「すべて表示しました」になること。
- 追加取得後、既存末尾と追加先頭の間に文字なしの細線と小さなひし形が表示され、2回目以降は最新境界だけが1個残ること。
- 追加境界がNEW、相対時刻、選択中カードの強調と混同せず、カード間隔を大きく広げないこと。
- 初回・追加読込中は「読み込み中…」で無効化され、初回失敗と追加失敗では「再試行」できること。追加失敗時に表示済みカードが消えないこと。
- トップに検索、クリア、お気に入りのみフィルターがなく、`すべての投稿を見る`が`list.html`を開くこと。
- `GET /api/charts`がD1の`serverTime`を返し、`excludeChartId`をSELECTとCOUNTの両方から除外すること。不正な除外IDは`INVALID_QUERY_PARAM`になること。
- 詳細URLでは「選択中の投稿」の後に、選択chartを含まない最近10chartが表示されること。2ページ目以降も選択chartを含まず各ページ10件を維持すること。
- 選択中カードと追加読込カードの両方で、ツリー、折り畳み、高精度進捗サムネイル、progressImage fallback、miniView、DL、追記、お気に入り、管理UIが動作すること。
- 選択中カードの★、追記、管理、履歴開閉が`#list`の共通委譲で1回だけ処理され、dialogや操作が二重に発火しないこと。
- 選択中カードの追記ボタンで追記フォームが開き、フォーム位置へスクロールすること。
- 選択中versionの取り消し・削除申請後に選択カードと最近一覧が再取得されること。対象が非公開になった場合はカードが消え、状態文が表示されること。
- 管理API成功後の表示再取得だけが失敗した場合、管理操作を失敗扱いにせず、表示更新失敗として案内すること。
- 初回投稿成功後、作成したBASEを含むchartが取得され、対象行のfocus・scroll・強調が行われ、通常カードと同じ機能が動作すること。
- 追記投稿成功後、深い分岐、同じ親からの分岐、完成版を含む作成versionが正確に選択され、通常カードと同じ機能が動作すること。
- 対象が折り畳み中間履歴にある場合、その履歴グループだけが展開され、別分岐を強調しないこと。
- 最新公開versionの`createdAt`とAPI `serverTime`の差が、1時間未満、1〜23時間、1〜7日で指定どおり表示されること。24〜47時間は「1日前」、168〜191時間は「7日前」、192時間以上は非表示になること。
- 相対時刻はchart内の最新公開version行へ1個だけ表示され、`charts.updated_at`や古いversionを基準にしないこと。追記後は最新version側へ移ること。
- 相対時刻badgeのtitle/aria-labelに絶対投稿日時があり、未来日時・不正日時は非表示かつ安全なcode付きwarningになること。
- タブを非表示から戻した時に相対時刻がAPI時刻基準で更新され、常時timerを使用しないこと。
- 通常表示へ戻るリンクで`chartId`/`versionId`が外れ、通常トップへ戻ること。
- 成功後にフォーム、進捗編集、親layer、ローカルminiView、追記モード、キャンセルボタンがresetされ、作者と保存指定した管理パスワードだけが復元されること。
- 成功後の未送信判定が解除され、フォームが折り畳まれ、Turnstileがresetされること。
- 投稿成功後のURL更新が`replaceState`で行われ、戻る操作が送信前の空フォームへの二重投稿を誘発しないこと。
- 投稿成功後の詳細取得だけが失敗した場合、成功状態を維持して再試行を表示し、フォーム入力を復元しないこと。
- 320px、390px、760px、1366px、1920pxで横スクロールがなく、見出し、一覧リンク、追加読込、選択中カードが読めること。

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
- `is_hidden=1`では追記できず、`is_rejected=1`は`allowAppend`に従うこと。
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
- Scheduled handlerが毎日JST 03:00（UTC 18:00、`0 18 * * *`）の設定で実行できること。
- Cron cleanupが1回最大20件を`hidden_at`の古い順、同時刻はversion ID順で逐次処理すること。
- Cronでも30日条件、`is_hidden=1`、`download_blocked=1`、`file_deleted_at IS NULL`、hidden reason allowlistが維持されること。
- 30日未満、`canceled_within_24h`、pending削除申請、公開中、DL停止のみ、allowlist外のversionがCron対象にならないこと。
- 候補取得後に状態を変更したversionは`skipped_state_changed`となり、R2 objectが削除されないこと。
- R2 objectが既にない場合は`r2_object_missing_reconciled`となり、D1の削除記録が修復されること。
- 手動cleanupとCronが同時実行され、条件付きUPDATEが0件でも、`file_deleted_at`設定済みなら`concurrent_completed`として壊れないこと。
- Cronを二重実行しても同じversionやR2 objectが異常状態にならないこと。
- R2削除失敗時はD1を更新せず、次候補の処理を継続すること。
- R2削除後にD1更新が失敗した場合、次回実行でobject不在としてD1を修復できること。
- 候補取得失敗時はR2操作を開始せず、実行全体が失敗として記録されること。
- 個別ログに`trigger='cron'`, `runId`, `objectExisted`, `d1Updated`が入り、集計ログが`r2_cleanup_cron_run`として残ること。
- Cron cleanup後もprogressImageとD1のsongs/charts/versions行が残ること。
- 既存の管理画面候補一覧、確認文字列、1件手動cleanup、30日条件、allowlistが変わらないこと。

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
- isRejected=true のversionもお気に入りでき、追記操作は`allowAppend`に従うこと。
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

## ZIP-SAFETY-01

- 正常なStore/Deflate ZIPを初回投稿・追記投稿できること。
- ZIP内のBMS/BME/BMLが1件だけ必要で、0件と複数件を拒否すること。
- ZIP内譜面が2MiBを超える場合、または安全に展開・CRC32確認できない場合に拒否すること。
- 音声拡張子を大文字小文字にかかわらず拒否し、`voice.wav.txt`のように途中に含むだけなら最終`.txt`として許可すること。
- 入れ子アーカイブ、暗号化、分割ZIP、Zip64、Store/Deflate以外、破損ZIPを拒否すること。
- traversal、絶対パス、ドライブパス、UNC、NUL・制御文字、深度8超、240文字超を拒否すること。
- シンボリックリンク・特殊ファイル、NFKC・小文字化後の重複パスを拒否すること。
- 全エントリ160超、通常ファイル128超、申告展開後16MiB超、1ファイル4MiB超を拒否すること。
- 1MiB以上の個別ファイルで100倍超、2MiB以上の全体で50倍超の圧縮率を拒否すること。
- allowlist外の実行ファイル・スクリプト・未知拡張子を拒否すること。
- ZIP拒否時に譜面R2 object、songs、charts、versionsが作成されないこと。
- `post_logs.detail`にstage、errorCode、エントリ数、申告展開後合計、譜面件数だけが入り、内部パス一覧・内容・生IP/UA・Secretが入らないこと。
- 利用者起因のZIP拒否がclient rejected投稿レート制限へ数えられ、`ZIP_INSPECTION_FAILED`は数えられないこと。
- 単体BMS/BME/BML投稿、progressMap/progressImage、BAN、重複判定の既存動作が変わらないこと。
- `npm.cmd run typecheck`と`wrangler deploy --dry-run`が成功すること。

## ZIP-BMS-ANALYSIS-01

- Store/Deflate ZIPの内部BMS/BME/BMLを初回投稿・追記投稿で解析できること。
- UTF-8、UTF-8 BOM、CP932のTITLE/SUBTITLE/ARTIST/SUBARTISTが読めること。
- 外側ZIPのSHA-256と内部譜面のMD5が別々に保存されること。
- 同じBMSを単体とZIPで投稿したとき、playNotes、小節情報、標準ブロックが一致すること。
- ZIP選択前はブラウザ用zip.jsが読み込まれず、ZIP選択時だけ遅延読込されること。
- ZIPでも初回進捗マップUIが表示され、追記時は親格子が一致する場合だけ編集できること。
- クライアントのblocks、playNotes、小節範囲、時刻改ざんを`ZIP_PROGRESS_MAP_MISMATCH`で拒否すること。
- layer ranges範囲外を`PROGRESS_MAP_OUT_OF_RANGE`で拒否すること。
- ZIP追記の親格子不一致を`ZIP_PROGRESS_MAP_MISMATCH`で拒否すること。
- BMS解析失敗はprogressMapなしならwarning付きで投稿でき、progressMapありなら`ZIP_BMS_ANALYSIS_FAILED`になること。
- R2 object数が採用version数と一致し、保存objectが外側ZIPのままであること。
- ZIP利用者起因エラーが投稿失敗レート制限へ数えられ、503系は数えられないこと。
- 単体BMS投稿、既存ZIP安全検査、BAN、重複判定、progressImageが壊れていないこと。
- Worker typecheck、Pages JavaScript構文検査、Worker dry-run bundleが成功すること。

## DIFFICULTY-TABLE-01

- RC★/RC★★それぞれの取込HTML、header JSON、data JSONを取得できること。
- 取込HTMLの`meta[name="bmstable"]`が対応する絶対header URLを指すこと。
- RC★の`level_order`が`0`～`20`, `他`の順であること。
- RC★★の`level_order`が`1`～`7`の順であること。
- `★0`～`★20`がRC★の同じ整数levelになること。
- `sl0`がRC★0、`sl1`～`sl12`が仕様の対応levelになること。
- `st0`がRC★20になること。
- `★21`～`★25`がRC★★1～5になること。
- `★★1`～`★★7`がRC★★1～7になること。
- `st1`～`st3`がRC★★の同じ整数levelになること。
- `st4`～`st6`がRC★★4、`st7`～`st9`がRC★★5、`st10`～`st12`がRC★★6、`st13`以上がRC★★7になること。
- NFKC正規化され、`SL`/`ST`の大文字小文字を区別しないこと。
- 空でない未認識表記、小数、範囲外表記がRC★`他`になること。
- 空またはNULLのdifficultyは掲載されないこと。
- `bms_wip_original_difficulty`へ正規化後の元difficultyが残ること。
- `progress<100`、version/chart非公開、DL不可、R2削除済み、取り消し、削除申請中、没譜面、中間履歴を除外すること。
- 32桁16進MD5がないversionを除外すること。
- 同一MD5はcompleted_at、created_at、version IDの降順で1件だけ掲載され、異なるMD5の完成分岐は掲載されること。
- ZIP投稿では内部BMSのMD5を使い、外側ZIP SHA-256を譜面hashとして出力しないこと。
- `url_diff`が現在のWorkerを起点とする絶対file API URLであること。
- `origin_url`がある採用versionだけ、正規化済み原曲配布URLが`url`としてdataに出力されること。
- `origin_url`がないversionは`url`キーなしで従来どおり掲載されること。
- `org_md5`がdataに出力されないこと。
- 一般的なBMS難易度表パーサーでheader/dataを読み込めること。
- GET/HEAD/OPTIONSで`Access-Control-Allow-Origin: *`が返り、投稿・管理APIのCORSが変わっていないこと。
- headerは約1時間、dataは約60秒のCache-Controlを返すこと。
- ETagを返し、同じ`If-None-Match`でHTTP 304になること。
- 対象なしはHTTP 200の空配列、不明表は`INVALID_DIFFICULTY_TABLE`、D1障害は`DIFFICULTY_TABLE_UNAVAILABLE`になること。
- Worker typecheckとdry-run bundleが成功すること。

## ORIGIN-URL-01

- `0004_origin_url.sql`を隔離ローカルD1へ適用でき、`versions.origin_url`がNULL許可・最大2048文字になること。
- migration適用前からあるversionの`origin_url`が`NULL`のまま維持されること。
- 原曲配布URL未入力で初回投稿でき、空文字ではなく`NULL`が保存されること。
- `http://`と`https://`の絶対URLを保存できること。
- URLの前後空白が除去され、fragmentが削除され、queryが維持されること。
- 相対URL、`javascript:`/`data:`/`file:`、username/password付きURL、制御文字、未エンコード空白を`INVALID_ORIGIN_URL`で拒否すること。
- 正規化前または正規化後に2048文字を超えるURLを`ORIGIN_URL_TOO_LONG`で拒否すること。
- URL検証時にWorkerからfetch、DNS、リダイレクト確認が行われないこと。
- URL全文がconsoleや`post_logs`へ記録されないこと。
- 追記versionへ親versionの`origin_url`がコピーされ、クライアント送信値に依存しないこと。
- 同じ親から分岐した各versionが、作成時点のURL snapshotを保持すること。
- `GET /api/charts`のversionで`originUrl`を取得でき、未登録時は`null`になること。
- MD5重複排除後に採用されたversion自身のURLだけがRC★/RC★★の`url`に使われること。
- URLなしの完成versionも難易度表へ掲載され、`url_diff`、`md5`、RC変換、ETag、CORS、キャッシュが変わらないこと。
- `org_md5`がAPI・難易度表へ出力されないこと。
- 初回投稿、追記投稿、検索、ページング、ツリー、進捗サムネイル、お気に入りが壊れていないこと。
- Worker typecheck、Pages JavaScript構文検査、Worker dry-run、`git diff --check`が成功すること。

## VERSION-CHART-NAME-13

- `0005_version_chart_name.sql`を既存migration適用済みの隔離ローカルD1へ適用でき、2回目は未適用migrationなしで終了すること。
- `versions.chart_name`と`versions.normalized_chart_name`がNULL許可で追加され、既存versionへ所属chartの値がbackfillされること。
- migration前後で`charts.chart_name`と`charts.normalized_chart_name`が変化しないこと。
- 初回投稿で`charts`とBASE versionの双方へ同じ差分名・正規化名が保存され、成功レスポンスに`chartName`があること。
- 追記で`chartName`を送信しない旧Pages相当では、親versionの差分名が新versionへ継承されること。
- 追記で空白ではない有効な`chartName`を送ると、その新versionだけが新しい差分名になり、起点の`charts.chart_name`は変わらないこと。
- 追記名の優先順位が、送信値、親version、chart起点名の順であること。
- 差分名の前後空白が除去され、100 Unicode code point超過または空白のみを拒否すること。
- 追記フォームに親version自身の差分名が表示・入力され、ラベルが`今回の差分名`、補足が`親の差分名を引き継いでいます。必要な場合だけ変更してください。`になること。
- 初回フォームのラベルが`差分名`、補足が`一覧で差分を区別する名前です。`になること。
- `GET /api/charts`と`GET /api/charts/:chartId`の各version、`GET /api/versions`、`POST /api/versions/query`が対象version自身の`chartName`を返すこと。
- NULLのversion差分名は各読取APIで`charts.chart_name`へfallbackすること。
- chart検索で公開中versionの差分名に一致したchartが返り、そのchartの公開ツリー全体が欠けずに返ること。
- version一覧検索で対象version自身の正規化差分名に一致する行だけが返ること。
- トップのchart見出しは起点差分名のまま、各version行は数字パス版の近くへ自身の差分名を1行・省略表示・title付きで表示すること。
- 独立一覧が各version自身の差分名を表示し、分岐版の異なる名前を混同しないこと。
- 独立一覧で`[ANOTHER]`のように角括弧付きで保存された差分名が`[[ANOTHER]]`にならないこと。
- 新規お気に入りsnapshotが対象version自身の`chartName`を保存し、旧snapshotや壊れたlocalStorageでも一覧が壊れないこと。
- RC★/RC★★の`name_diff`と`bms_wip_chart_name`がMD5重複排除後に採用されたversion自身の差分名になること。
- fixture `BASE=[NORMAL], 1=[NORMAL], 1-1=[ANOTHER], 1-1-1=[ANOTHER], 1-2=[HYPER], 2=[INSANE], 2-1=[INSANE+]`でAPI、ツリー、一覧、検索、難易度表を確認すること。
- 320/390/760/1024/1366/1920pxでversion差分名が版ラベル、状態バッジ、難易度、作者、進捗、操作列へ重ならないこと。
- 初回投稿、追記投稿、ツリー、折り畳み、DL、管理操作、進捗サムネイル、miniView、検索、ページング、Turnstileに回帰がないこと。
- Worker typecheck、Pages JavaScript構文検査、Worker dry-run、`git diff --check`が成功すること。

## SITE-THEME-14

- 保存値なし、JavaScript無効、localStorage利用不可の各状態で`default`表示になり、初期描画で白い点滅が発生しないこと。
- `white`、`default`、`dark`を選択でき、`bms-wip-charts:theme:v1`へ保存され、再読込・ページ移動・戻る/進む後も維持されること。
- 不正な保存値を削除して`default`へ戻し、ログに不正値そのものを出さないこと。
- localStorageのread/write/remove失敗時に、現在ページ内の切替と他機能が動き、ログがcode、stage、errorTypeだけを持つこと。
- 別タブでのテーマ変更へ`storage`イベントで追従し、フォームreset、scroll、focus移動、dirty化が起きないこと。
- 共通ヘッダーと管理画面に`表示テーマ`selectがあり、モバイルメニュー内でも44px以上の操作高と横はみ出しなしを維持すること。
- index/list/guide/changelog/adminを3テーマで確認し、背景、カード、入力、ボタン、disabled、notice、error、dialog、管理表見出しが読めること。
- 投稿フォームを開いたままテーマ変更しても、入力、選択ファイル、進捗塗り、追記モード、保存済み作者/パスワード、beforeunload判定が変化しないこと。
- ツリー線、ノード、折り畳み、省略マーク、選択中versionが3テーマで読め、テーマ変更後も接続座標が変わらないこと。
- 進捗密度CanvasとminiView Canvasがテーマ変更後に再描画され、API再取得や譜面再解析を行わないこと。
- progressImage生成PNG、FormDataへ添付するPNG、R2保存済みPNG、progressMapデータがテーマで変化しないこと。
- Turnstileがwhite/defaultでlight、darkでdarkになり、challenge中のテーマ変更は終了後まで安全に遅延され、フォーム入力を失わないこと。
- RC★/RC★★リンクに現在テーマのqueryが付き、取込HTMLだけが配色変更されること。不正themeはdefaultになり、header/data JSONは不変であること。
- 通常文字、補助文字、リンク、主要/補助/disabledボタン、入力、placeholder、badge、warning/error、focus ringのコントラストを確認すること。
- 320/390/760/1024/1366/1920pxでヘッダー、テーマselect、投稿フォーム、ツリー、一覧、pagination、dialog、guide、changelog、adminに横スクロールや重なりがないこと。
- 初回投稿、追記投稿、ファイルdrop、progressMap塗り、miniView、PNG生成、管理操作、検索、お気に入り、追加読込、直接リンク、難易度表に回帰がないこと。
- Pages JavaScript構文検査、HTML ID重複検査、CSS直接色監査、Worker typecheck、Worker dry-run、`git diff --check`が成功すること。

## APPEND-POLICY-15

制作状態とversion単位の追記受付を分離したことを確認する:

- 隔離ローカルD1へ`0001`から`0006_append_policy.sql`まで順に適用でき、既存migrationが変更・再番号付けされていないこと。
- `versions.allow_append`が`INTEGER NOT NULL DEFAULT 1 CHECK (allow_append IN (0, 1))`であり、0/1以外を拒否すること。
- migration前の`is_rejected=1`だけが`allow_append=0`へbackfillされ、未完成、完成、取り下げ中、削除申請中、通常DL停止の既存versionは1になること。
- migration後のINSERTで`allow_append`省略時に1が保存されること。
- 初回通常版と追記の未完成版は`allowAppend=true`だけを保存し、改ざんしたfalseを`APPEND_POLICY_LOCKED_FOR_INCOMPLETE`で拒否すること。
- 初回没譜面と明示的な追記完成版だけ、`allowAppend=true/false`の両方を保存できること。
- 初回没譜面はprogress=100でも`completed=false`, `completedAt=null`であり、完成版と混同しないこと。
- 追記の`isRejected=true`は`FOLLOWUP_REJECTED_NOT_ALLOWED`で拒否し、追記フォームのcheckboxもdisabled・未選択であること。
- 完成済み親への通常子で`ranges=[]`は`PROGRESS_MAP_UNCHANGED`となり、「追記する進捗範囲を1つ以上選択してください。」と表示されること。
- 完成済み親から`completion_fill`を送る場合も、押下前の正規化済み`completionBaseRanges`が空なら`PROGRESS_MAP_UNCHANGED`で拒否されること。
- 完成済み親への通常子は、正規化後の子レイヤーに有効なrangeが1件以上あればunionが100%のままでも追記できること。
- 完成済み親への通常子で逆転、範囲外、不正形式のrangeだけを送った場合は既存の進捗mapエラーで拒否されること。現行rangeは両端を含むブロック番号のため`[n,n]`は1ブロックの有効rangeとして維持すること。
- 初回没譜面は`rejected_auto_fill`で全区間へ正規化される既存挙動を維持すること。
- 未完成親の無変更unionは従来どおり`PROGRESS_MAP_UNCHANGED`になり、既存の進捗検証が変わらないこと。
- `allowAppend`は完全一致の`true`/`false`だけを受け付け、`1`、`0`、空文字、大文字違い、任意文字列は`INVALID_ALLOW_APPEND`になること。
- `allowAppend`欠落時は、初回の非没譜面がtrue、初回の没譜面がfalse、追記で作る子versionがtrueになること。
- 親versionが同じchartに属する公開versionで、非中間履歴、file未削除、利用可能なprogressMapあり、`allow_append=1`の場合だけ追記できること。
- 没譜面の親でも`allow_append=1`なら追記でき、`allow_append=0`なら直接APIを呼んでも`PARENT_APPEND_DISABLED`の409になること。
- 公開中の取り下げ、削除申請、通常DL停止versionは`allow_append`に従い、これらの状態だけでは追記を拒否しないこと。
- 親なし、別chart、非表示、中間履歴、file削除済み、progressMap利用不可は、`allow_append`とは別の既存構造エラーになること。
- multipart前のBAN、投稿レート制限、Turnstileが従来どおり先に実行され、親の軽量検証はmultipart後かつfile hash/BMS解析/R2保存前に行われること。
- 最初の親確認後に`allow_append=0`へ変わった場合、条件付きINSERTが子versionを作らず、`PARENT_APPEND_DISABLED`を返すこと。
- 条件付きINSERTが0件でも親version再検証がすべて通る場合だけ、409 `PARENT_APPEND_CONFLICT`と再読込を促す安全な文言を返すこと。
- 条件付きINSERT後の再検証でchart・親version・所属chart・progressMap・中間履歴・`allow_append`の問題が判明した場合は、それぞれの既存エラー分類を維持すること。
- `PARENT_APPEND_CONFLICT`はclient rejected投稿レート制限へ数えず、旧`INVALID_REJECTED_FLAG_FOR_FOLLOWUP`と`REJECTED_CHART_CANNOT_BE_EXTENDED`は新コードとともにrolling window集計へ残ること。
- 投稿レート制限の回数、10分・1時間・24時間の時間窓、IP hash識別、BAN・レート制限の判定順序が変わらないこと。
- 条件付きINSERT失敗時に保存済み譜面R2 objectが削除され、子version、孤立object、raw R2 keyログが残らないこと。
- 条件付きINSERT失敗後のR2 cleanupに失敗しても元のHTTP分類を上書きせず、`R2_ORPHAN_FILE`をadmin_logsへ記録すること。
- 既存子versionがある親を追記停止にしても既存子と版ツリーは変化せず、新規追記だけが止まること。
- `GET /api/charts`、chart詳細、`GET /api/versions`、`POST /api/versions/query`、初回・追記成功レスポンスのversion情報がbooleanの`allowAppend`を返すこと。
- RC★/RC★★のheader/data JSONへ`allowAppend`が追加されず、掲載条件、ETag、キャッシュ規則が変わらないこと。
- 旧APIレスポンスで`allowAppend`欠落時、Pagesは非没譜面をtrue、没譜面をfalseとして表示すること。
- 投稿状態パネルが完成版・没譜面・追記受付の3行を同じ構造で表示し、390pxでは各行が縦積みになること。
- 初回の完成版ボタンは常にdisabledで、通常初回のprogress=100は`INITIAL_COMPLETION_NOT_ALLOWED`になること。
- 完成版ボタンは初回投稿、追記対象なし、フォーム閉鎖、ファイル未選択、解析中、解析失敗、progressMap未生成、進捗79%以下、没譜面でdisabled属性と`aria-disabled=true`になり、追記対象・解析済みファイル・利用可能なprogressMap・非没譜面・進捗80%以上が揃った場合だけenabledになること。
- 未指定時は`完成版にする`と`aria-pressed=false`、指定中は`完成版を解除`と`aria-pressed=true`になり、指定中も解除ボタンがenabledであること。
- 完成版指定時に押下直前のprogressMap、layers/ranges、contributor色、透明ブロック、進捗度、編集中layer状態をメモリ上のdeep copyへ保持し、未塗りを`completion_fill`で埋めてprogress=100にすること。snapshotがlocalStorage、FormData、D1、R2、生成PNGへ含まれないこと。
- 完成版指定中は進捗ブロックを編集できず、解除を案内する固定文が表示されること。解除時は色、ranges、透明ブロック、進捗度、編集状態が押下直前と同一に復元され、snapshotが破棄されること。
- 完成版指定中のファイル変更/解除、追記対象変更、追記キャンセル、form reset、投稿成功で指定状態とsnapshotが破棄され、古いsnapshotが新しいファイルや対象へ適用されないこと。
- ファイル未選択、解析中、解析失敗、80%未満、設定可能、完成版指定中で状態バッジと説明文が動的に切り替わり、`aria-live=polite`でフォーカスを奪わないこと。
- 完成版指定中の送信直前に、追記モード、選択ファイル、解析完了、有効なprogressMap、snapshot、progress=100、非没譜面を再検証し、不整合時はAPIへ送信せず「完成版の状態を確認できません。譜面ファイルを選択し直してください。」と表示すること。
- 完成版指定の解除後は未完成扱いへ戻り、追記受付がchecked・disabled・trueへ戻ること。同一フォーム内で再度完成版を指定した場合だけ、完成版用の追記受付選択を再利用できること。
- 追記の進捗79%では完成版ボタンがdisabled、80%以上ではenabledになり、押下時だけ`completion_fill`と`completionBaseRanges`を送ること。
- `completionBaseRanges`と親layerのunionが80%未満なら`COMPLETION_PROGRESS_TOO_LOW`、未完成親から完成指定なしで100%なら`COMPLETION_ACTION_REQUIRED`になること。
- 初回通常版と追記未完成版の追記受付はchecked・disabled・true、初回没譜面は初回OFF、追記完成版は初回ONで設定可能になること。
- 初回没譜面または追記完成版で利用者が選んだ値は同一フォーム内の状態往復で復元され、フォーム初期化、明示reset、投稿成功、追記対象切替、追記キャンセルで破棄されること。
- 初回・追記のFormDataがdisabled状態でも確定後の`allowAppend=true/false`を明示送信し、投稿失敗後は現在値を維持すること。
- `allowAppend`がdirty/beforeunload判定に含まれ、作者・パスワード・テーマなどのlocalStorageへ保存されないこと。
- `allowAppend=true`の未完成・完成・没譜面に追記操作があり、完成非没譜面だけ既存確認dialogを表示すること。
- `allowAppend=false`はversion情報側の`追記受付停止`バッジと読み上げ可能な理由を表示し、操作列は`DL / 追記停止 / …`の短い並びを維持すること。
- completion判定は`completed_at`を正とし、完成版指定なしでunionが100%になった通常子を一覧・難易度表で完成版扱いしないこと。
- 投稿管理dialogに`追記受付：許可/停止`が読み取り専用で表示され、編集UI・保存API・新しい`post_logs.action`がないこと。
- 390/760/1366/1920pxとwhite/default/darkでcheckbox、補足文、追記停止表示が読め、横overflowや既存見出しパネル崩れがないこと。
- テーマ切替でcheckbox値、touched/dirty状態、選択file、追記対象、フォーム開閉状態が変化しないこと。
- `list.html`の表示・検索・ページングに追記可否UIが追加されず、新しいAPIフィールドでも既存表示が壊れないこと。
- 通常投稿、通常追記、branch採番、ツリー展開/折り畳み、追加読込、検索、ページング、お気に入り、DL、管理操作、取り下げ、削除申請、Turnstile、rate limit、進捗Canvas、miniView、生成PNGに回帰がないこと。
- Pages JavaScript構文検査、HTML ID重複検査、Worker typecheck、Worker dry-run、`git diff --check`が成功すること。

## WITHDRAWAL-LIFECYCLE-16A

> 以下は16A時点の履歴試験。pendingの公開範囲・DL可否・理由入力は16R節を現行期待値として優先する。

### migration

- 隔離D1へ`0001`～`0007`を順番に適用でき、適用直後の`version_withdrawals`が空であること。
- 不正status、不正request_mode、不正processing_mode、`scheduled_at < requested_at`、負のattempt_countがCHECK制約で拒否されること。
- idempotency hash重複と、同一versionのpending/processing二重作成が拒否されること。
- canceled後は新しいpendingを作成でき、processing中は別pendingを作成できないこと。
- 既存version、`withdrawn_at`、`delete_requests`、R2 objectにmigration由来の変更がないこと。

### API

- 23時間59分および24時間ちょうどで依存なしはimmediate、24時間1秒後はdeferredになること。
- 公開・非表示を問わない直接子、`collapsed_by_version_id`参照、旧delete requestがある場合はimmediateにならないこと。旧pending requestは`LEGACY_LIFECYCLE_ACTIVE`になること。
- 同じidempotency keyの再送が既存結果を返し、別versionへの再利用は`IDEMPOTENCY_KEY_REUSED`になること。生key/hashをレスポンス・ログへ出さないこと。
- パスワード不一致、version不存在、非表示、file削除済み、legacy、processing、tombstonedを固定コード・固定文言で拒否すること。
- deferred pendingを予定時刻未満に取消でき、version本体のDL・追記状態を変更しないこと。immediate、7日ちょうど以降、processingは取消できないこと。
- 二重申請は`already_pending`、二重取消は`already_canceled`として安全に再実行できること。取消後のlifecycle応答はactiveで、申請日時・予定日時が`null`になること。
- 分類とINSERTの間に依存状態が変わった場合、immediateを誤作成せずdeferredまたは`WITHDRAWAL_STATE_CONFLICT`へ倒れること。

### 公開範囲・回帰

- pending/processing/tombstonedが最近の投稿、`list.html`、通常検索、COUNT、ページング、お気に入りquery、RC★/RC★★から除外されること。
- pendingは直接chart詳細の版ツリーに残り、状態バッジ、申請日時、予定時刻または削除処理待ちを表示すること。
- pendingのfile APIと追記APIは既存`download_blocked/allow_append`に従い、processing/tombstoned/deletedはDL・追記を拒否すること。
- pending中に子versionを作成しても申請行が変化しないこと。取消後は一般一覧とお気に入りへ再表示されること。
- lifecycle変更後に一覧・難易度表のETag/再取得結果が古い掲載を維持しないこと。
- 旧withdraw/delete-request API、旧管理承認・却下、既存R2 cleanup、生成PNG、progressMap、branch採番、版固有差分名を変更していないこと。

### Pages

- active immediate/deferredで操作が一本化され、理由入力がなく、確認後の二重送信を防止すること。
- deferred pendingだけ取消ボタンを表示し、immediate pending、processing、legacy、tombstonedは読み取り専用になること。
- ネットワーク再試行は同じidempotency keyを使い、成功、明示キャンセル、dialog close、対象version変更で破棄すること。別versionの遅いlifecycle応答が現在dialogを上書きしないこと。
- 取消後に予定情報とバッジが消え、対象chartと一般一覧を再取得すること。旧Workerの404時に旧APIへfallbackしないこと。
- white/default/dark、390/760/1366/1920pxで予定時刻、disabled、aria-live、focus、DL/追記/管理操作列、折り畳み、SVGツリーが崩れず横overflowがないこと。
- Pages JavaScript構文、HTML重複ID、Worker typecheck、Wrangler dry-run、`git diff --check`が成功すること。
- 16B完成前は本番migration、deploy、commit、push、本番D1/R2/Secret、Cron変更を実施しないこと。

## WITHDRAWAL-LIFECYCLE-16B

> 以下は16B時点の履歴試験。依存ありの自動墓標化期待値は16R節で廃止されている。

### claim・lease・再試行

- dueなpendingを1件だけclaimし、`status=processing`、一意なlease、`attempt_count + 1`になること。
- 有効なprocessing leaseは別処理がclaimできず、attempt countも変わらないこと。
- 期限切れprocessing leaseは再claimできること。
- 同じ要求を複数回finalizeしても、R2/D1/監査行が壊れないこと。

### 物理削除・墓標化

- 直接子、collapsed参照、legacy delete requestがないleafは譜面とprogressImageを削除し、versionを物理削除すること。最後のversion/chart/songなら空chart/songも削除すること。
- 非表示を含む直接子、collapsed参照、legacy delete requestのいずれかがある場合は墓標化すること。
- 墓標はversion行を残し、`allow_append=0`、`download_blocked=1`、`file_deleted_at`を持ち、譜面とprogressImageが存在しないこと。
- dependency確認後からD1確定前に子または参照が増えた場合、物理削除せず墓標化へ切り替わること。

### R2・D1異常系

- 譜面objectまたはprogressImage objectの削除に失敗した場合、残りobjectも処理を試みるがD1を終端更新せず、再試行可能なprocessingに残ること。
- R2 objectが最初からない場合も正常完了できること。
- R2削除成功後にD1更新が失敗した場合、次回にobject不在を検出してdeletedまたはtombstonedへ修復できること。
- 依存のない末端versionだけが物理削除され、version削除件数は1件で、同じchartの他versionは残ること。
- 公開・非表示を問わない直接子、`collapsed_by_version_id`参照、旧`delete_requests`の各ケースで対象versionが墓標化されること。
- 事前依存検査後、D1確定直前に直接子が追加された場合はDELETEが0件となり、同じleaseのまま墓標化へ切り替わること。
- 失敗が1件あっても`processDueVersionWithdrawals`が後続候補を処理し、最大20件を超えないこと。
- admin log失敗がcleanup結果を巻き戻さず、ログにraw R2 key、パスワード、Secret、生IP、生UA、完全hashがないこと。

### API・公開表示

- immediate要求が同期finalizeされ、leafではHTTP 200 `immediate_deleted`、依存ありではHTTP 200 `tombstoned`を返すこと。
- 同じidempotency keyの再送が、version物理削除後かつ異なるpassword入力でも同じ終端結果を返すこと。別versionへの同じkeyは409になること。
- processing/tombstonedが通常一覧、検索、version一覧、難易度表、お気に入りqueryへ出ないこと。
- 直接chart詳細の墓標は親子接続を保ちつつ固定文言だけを返し、作者、コメント、URL、hash、進捗、ファイル、miniView、progressImage、管理操作を公開しないこと。
- processing/tombstonedの譜面、progressImage、miniViewは404、追記と旧lifecycle操作は拒否されること。
- Pagesで`immediate_deleted`は対象詳細を閉じ、`tombstoned`は固定履歴表示へ更新し、`processing`は処理中表示になること。
- 削除済みversionの旧URLを開いた場合、同じchartに公開versionが残れば安全な残存versionへ`replaceState`で移動し、最後のversionとchartが削除済みなら選択を解除して一覧へ戻ること。
- processing/tombstoned行ではversion単位のお気に入り星を表示しないが、localStorageの既存お気に入りIDは削除しないこと。

### 回帰

- pendingの取消、通常投稿・追記、版ツリー、検索、ページング、お気に入り、DL、miniView、progressMap、生成PNG、管理承認・却下、手動R2 cleanup、既存cleanup Cronが変わらないこと。
- Worker typecheck、Pages JavaScript構文検査、Wrangler dry-run、`git diff --check`が成功すること。
- deploy、commit、push、本番D1/R2/Secret操作を実施しないこと。

## WITHDRAWAL-LIFECYCLE-16C

> 以下は16C時点の履歴試験。Observer分類は16R節のhandling mode基準を現行期待値として優先する。

### モードとScheduled handler

- `WITHDRAWAL_CRON_MODE=off`および未設定では候補検索・監視集計ログ・lifecycle変更がないこと。
- 厳密な`observe`だけが監視を実行し、`active`、`OBSERVE`、` observe `、空文字、`true`、`1`は不正値としてoffになること。
- 毎時`0 * * * *`ではobserverだけ、毎日`0 18 * * *`では既存R2 cleanupだけが1回実行されること。同時刻の別Scheduled Eventで処理が混線しないこと。
- Scheduled Eventの`scheduledTime`が候補検索と全候補の期限判定で共有され、未処理Promise rejectionがないこと。

### 候補と分類fixture

- 期限到達deferred・依存なしは`would_delete`、直接子あり、非表示直接子あり、collapsed参照あり、旧delete requestありは`would_tombstone`になること。
- 期限前deferredは候補外、immediate pendingは`scheduled_at`にかかわらず候補になること。
- lease期限切れまたはlease NULLのprocessingは、依存なしで`would_retry_delete`、依存ありで`would_retry_tombstone`になること。
- 有効lease中processing、canceled、deleted、tombstonedは候補外になること。
- version不存在の非terminal lifecycleは`manual_review`になり、chart不整合、legacy競合、外部状態競合も安全なreason codeで`manual_review`になること。
- 候補取得後の取消、terminal化、lease更新は`ignored`になり、1候補の読取例外が残りの分類を停止しないこと。
- 21件以上の候補で20件だけを分類し、`scanned_count=21`、`candidate_count=20`、`truncated=true`になること。

### 非変更・ログ・回帰

- observe前後で`songs`、`charts`、`versions`、`version_withdrawals`、`delete_requests`、`post_logs`の行内容が完全一致し、status、processing/lease、attempt、last error、resolved、allow append、download blocked、file deletedが変わらないこと。
- R2 objectの件数・内容・metadataが変わらず、observer経路からHEAD/GET/LIST/DELETE/PUTが呼ばれないこと。
- 実行単位の集計ログが1件だけ増え、通常候補の個別ログはなく、manual reviewと予期しない候補エラーの個別ログが合計最大5件であること。
- ログにパスワード、idempotency hash、lease token、IP/UA hash、R2 key、SQL、stack、作者、コメント、URL、ファイル名、譜面hash、progressMap、Secretがないこと。
- observer全体失敗でも安全な集計を試み、別イベントの既存cleanupに影響しないこと。既存cleanup失敗も別イベントのobserverへ影響しないこと。
- 隔離D1へmigration `0001`～`0007`を適用し、ローカルScheduled Event、既存R2 cleanup、Worker typecheck、Wrangler dry-run、`git diff --check`が成功すること。
- Pages差分、公開route、migration、Secret、active処理が16Cによって追加されていないこと。本番migration、deploy、commit、push、本番D1/R2/Secret操作を実施しないこと。

## WITHDRAWAL-LIFECYCLE-16R

### migration・分類

- 隔離D1へ0001～0008を適用でき、既存行を壊さないこと。既存immediateは`immediate_delete`、既存deferredは全直接子・collapsed参照・旧delete requestの有無により`grace_auto_delete/manual_review`へ分類されること。
- 23:59・依存なしと24:00ちょうど・依存なしは`immediate_delete`、24:00:01・依存なしは`grace_auto_delete`になること。
- 23:59/24時間超過の直接子あり、非表示直接子あり、collapsed参照あり、旧delete requestありは`manual_review`になること。
- preview後から確定までに依存が増減した場合、申請INSERT時のWorker再判定が優先されること。

### 申請・取消・DL

- immediateは理由なしで同期物理削除され、取消できないこと。
- grace/manualは理由10～500文字が必須で、空白のみ、短すぎ、長すぎを固定400コードで拒否すること。理由本文が公開API、post_logs、consoleへ出ないこと。
- grace/manual申請直後は`withdrawal_download_blocked=1`となり、file APIが404、一覧のDL操作が無効になること。追記は既存`allow_append`に従うこと。
- grace期限前とmanual処理開始前は取消でき、専用DL停止だけが0へ戻ること。既存`download_blocked=1`は取消後も維持されること。
- 申請・取消レスポンスがDB更新後の`downloadAvailable`、`appendAvailable`を返すこと。

### 公開範囲・7日後・observer

- grace/manual pendingは最近の投稿、list、検索、COUNT、お気に入り、chart詳細へ残り、RC★/RC★★だけから除外されること。processing/tombstoned/deletedは通常公開対象外であること。
- 期限前graceは処理せず、期限到達graceの依存なしはdeletedになること。期限到達までに依存が増えた場合はR2を触らずpending/manual_reviewへ移り、自動墓標化されないこと。
- manual reviewはpending/processingともfinalizer/observer候補外であること。observerはdue graceまたは期限切れprocessingの依存なしを`would_delete`/`would_retry_delete`、依存ありを`would_move_to_manual_review`とし、observe前後でD1/R2本体が不変であること。
- 管理画面でmanual reviewのversion、申請日時、理由、handling mode、依存内訳を確認でき、公開画面には理由を表示しないこと。
- 4条件すべてで指定された見出し・説明・状態文・確認ボタンを表示し、pendingでは「DL停止・自動削除待ち」または「DL停止・管理者確認待ち」と取消説明を表示すること。
- white/default/dark、390/760/1366px、Pages構文、HTML重複ID、Worker typecheck、Wrangler dry-run、`git diff --check`を確認すること。
- 16C observe検証後、16Dの隔離検証を完了してから`WITHDRAWAL_CRON_MODE=active`へ切り替える。deploy、push、本番D1/R2/Secretの変更操作を行わず、検査成功後は指定メッセージでローカルコミットだけを作成すること。

## WITHDRAWAL-LIFECYCLE-16D / 16D-R

### mode・候補・summary

- 未設定、不正値、`ACTIVE`はoffとなり、厳密なoff/observe/activeだけを分岐すること。offはdomain dataとadmin logを変更せず、observeはadmin log以外を変更せず、activeはobserverを同時実行しないこと。
- active候補はdueなpending grace、lease NULL/期限切れprocessing grace、未完了のpending immediate、lease NULL/期限切れprocessing immediateで、`scheduled_at ASC, id ASC`、最大20件、`limit + 1`でtruncatedを判定すること。期限前grace、manual review、有効lease、canceled/deleted/tombstonedは候補外であること。
- immediateは同期申請finalizerを主経路として維持し、activeでは未開始pending、retryable error後または中断後のprocessingだけを回復すること。summaryの`immediate_recovery_selected_count`は、上限内で実際に選択したimmediate件数と一致すること。
- 0件、deleted、manual review、retryable error、候補個別例外、fatal candidate選択、truncatedの各runでsystem summaryが1件増え、件数、reason、`fatal_error_code`が一致すること。`tombstoned_count`は常に0であること。

### lease・R2・D1・race

- 同じdue graceを並行finalizeしてもclaimは1回、`attempt_count=1`となること。期限切れleaseは再claimでき、有効leaseは処理しないこと。候補取得後にhandling modeが変わればclaimせずskipすること。
- pending immediateはactiveでdeletedとなり、R2またはD1のretryable error後はretry delay前に再claimせず、期限到達後のactiveでdeletedへ進むこと。有効lease中のprocessing immediateは処理しないこと。
- immediate回復前に直接子、collapsed参照、旧delete requestが増えた場合は、R2を削除せずpending/manual review、専用DL停止1へ移ること。R2が既に不存在でもD1物理削除を冪等に完了すること。
- 同じimmediateを同期finalizerとactiveが並行処理してもclaimは1回、`attempt_count=1`となり、片方だけがdeletedを確定すること。active summaryの`tombstoned_count`は0であること。
- 依存なしdue graceは譜面とprogressImageを削除し、versionと不要なchart/songを物理削除してwithdrawalをdeletedへ確定すること。R2 objectが最初からない場合も成功し、同じchartに他versionがあればchart/songを残すこと。
- R2片方失敗では他方の処理結果を保持してretryable processingとなり、retry delay後に不存在objectを正常扱いして残りを削除できること。R2削除後のD1終端失敗も同じ冪等経路で次回deletedへ進めること。
- claim直後、processing mode保存後、R2削除直前に、直接子・非表示子・collapsed参照・旧delete requestが増えた場合、R2削除0でpending/manual reviewへ移ること。
- R2削除後またはD1 DELETE直前に依存が増えた場合、R2削除済み件数と`WITHDRAWAL_DEPENDENCY_RACE_AFTER_R2`を記録し、versionをpending/manual review、専用DL停止1、lease/processing mode NULLへ安定させること。tombstone化・毎時無限retryをしないこと。
- legacy/external lifecycle競合とversion不存在はnon-retryable manual reviewへ終端し、version不存在をdeletedと推測しないこと。同じ行を次回activeが再claimせず、attempt countが増えないこと。
- 候補Aの予期しない例外で候補B以降を止めず、安全な固定codeだけを個別logへ保存すること。ログにパスワード、Secret、IP/UA、投稿本文、申請理由全文、R2 key全文がないこと。

### 隔離・公開回帰・Scheduled

- `node worker/scripts/test-version-withdrawal-active.mjs`でWrangler TestHarnessの隔離D1/R2へ0001～0008を適用し、mode、Workerd scheduled dispatch、graceの既存回帰、immediate pending回復、R2/D1再試行、有効lease除外、3依存、R2不存在、同期finalizerとの並行claim、5段階race、non-retryable、summary、公開範囲を確認すること。
- manual reviewは一般version一覧とlifecycle APIへ残り、file APIは404、RC★/RC★★から除外、ADMIN_TOKEN認証済み管理APIで理由を確認できること。取消は専用DL停止だけを解除し、既存`download_blocked=1`を維持すること。
- 一時persist領域へmigration後、`npx wrangler dev --test-scheduled --local --persist-to <temp>`を起動し、`/__scheduled?cron=0+*+*+*+*`がHTTP 200となり、`withdrawal_cron_active`の0件summaryを保存すること。本番D1/R2へ接続しないこと。
- 毎日`0 18 * * *`は`r2_cleanup_cron_run`だけを記録し、active summaryを作らないこと。Cron式、Pages、migration、schema、Secretを変更しないこと。
- `npx tsc --noEmit`、`npx wrangler deploy --dry-run`、利用可能な既存テスト、`git diff --check`が成功すること。本番deploy、push、本番D1/R2書換えを行わないこと。

## POST-ERROR-UI-9C

### ローカル入力・移動

- 2026-07-21、ローカルPagesを新規タブで開き、初回投稿を空送信した。ファイル、曲名、アーティスト、難易度、差分名、作者、パスワードの7件が同時表示され、フォームが開いたままDrop Zoneだけへフォーカスし、重複error IDがないことを確認した。
- 有効なBMS fixtureでタイトル・アーティスト・進捗Mapが解析され、該当エラーだけが解除されることを確認した。他項目を有効にして難易度だけ未選択にするとPickerが展開され、利用可能な難易度タブへフォーカスした。
- 進捗`101`、`1.5`、空欄で進捗欄へ移動し、範囲／整数または必須の具体文を表示した。差分名101文字は差分名、不正な原曲配布URLはURL欄へ移動した。
- 無効拡張子では既存`#chartFileDropError`だけを使用して形式エラーを表示し、`aria-invalid=true`と`aria-describedby`を設定した。次の有効BMSが解析成功した時点でファイルエラーだけが解除された。
- 1項目を修正したとき、その項目だけ`aria-invalid=false`とhiddenへ戻り、他項目の表示を維持した。最後の同一sourceエラーを解除した場合だけ共通概要を閉じる。

### 追記・Worker code

- 追記送信前検証は、追記元、ファイル未選択／解析中／解析失敗、難易度、差分名必須／100文字、作者、パスワード、完成版状態、追記範囲0、格子不一致、追記受付禁止を単一errors配列へ追加し、途中returnが最終の1か所だけであることを静的検査した。初回と同じ`BmsPostErrorUi.showValidationErrors`へ渡す。
- Worker実装の安定codeを照合し、ファイル、原曲URL、差分名重複、進捗／進捗Map、完成版、没譜面、追記受付、パスワード、Turnstile、追記元状態の対応を確認した。ローカルTurnstile失敗ではTurnstile欄のinline表示になった。
- `INVALID_FORM`はfile未添付・必須項目・差分名など複数用途のためdetailから推測せず共通欄へ送る。`SERVER_CONFIG_ERROR`、DB/R2障害、BAN、rate limit、network、JSON解析失敗、`ZIP_INSPECTION_FAILED`も共通欄とする。

### 表示・アクセシビリティ・静的検査

- white/default/darkの各テーマを390/760/1366pxで確認し、9組すべて横overflow 0、error文の表示領域あり、テーマ別danger文字色・背景・左枠を確認した。390pxでもerror文は折り返される。
- 動的error要素は16 fieldKeyで各1件、全要素に`role=alert`を付けた。ブラウザ上で重複ID 0、欠落した`aria-describedby`参照0、hidden inputへのフォーカス0を確認した。
- smooth scroll、`block=center`、focus時`preventScroll`、2回の`requestAnimationFrame`、`prefers-reduced-motion: reduce`時のauto、対象欠落時の安全な共通欄fallbackをコード確認した。
- `node --check`（app、branch append、post form、共通error UI）、Worker`tsc --noEmit`、HTML重複ID／script順序検査、`git diff --check`を実行する。ローカル検証中のfixtureは削除し、Worker、D1、R2、Cron、本番環境を変更しない。

## CHART-METADATA-EXTRACT

### parser fixture

- `node scripts/test-chart-metadata-extract.js`で、差分名の`[]/()/（）/-/--/ー`、末尾連続候補、空表記、末尾外、左右不一致、ASCIIハイフン3個を確認する。`曲名 （最終決戦）`、`曲名 [ANOTHER] （改造版）`、`曲名 （TT mix）`は候補となり、`曲名 （）`と`曲名 （最終決戦)`は候補外になること。
- `obj`の半角・全角記号、`@`、半角・全角空白、記号前後空白と、`note/notes/chart/charter`の半角・全角区切り、大文字小文字を確認する。`object/objective/notebook/chartreuse`、名前なしmarkerは候補外になること。
- 次marker、次の差分名候補、欄末尾で作者名が終了し、複数候補がsource位置順になること。title/subtitle/artist/subartistを独立解析し、別欄の`/`を作者へ関連付けないこと。
- 空白あり・なしの候補除去と関連`/`除去で他の`/`を維持し、XSS文字列を文字列のまま返し、128KiBを超えるsourceを候補外として即時終了すること。
- `scripts/fixtures/chart-metadata-extract-utf8.bms`の4メタ欄から期待候補を取得できること。

### 操作・状態

- 2026-07-21、ローカルPagesで`Faraway Sky (All I C Is U) [Nebula]`を入力し、初期選択`[Nebula]`、←で`(All I C Is U)`、端のdisabled、非循環、矢印操作でsource不変を確認した。
- `転記して除去`で差分名・作者を上書きし、sourceだけから選択rangeを除去すること。`除去のみ`ではdestination不変、処理後は再解析後の最も右の候補になること。
- `not Project Nirvana / obj:potechang`で作者処理後に`/`だけが除去専用候補となり、`/`除去後はUndo専用panel、Undo後は`/`だけが復元されること。
- titleからA、subtitleからBを同じ`chartName`へ転記した後にtitleをUndoしてもBを維持すること。destinationを手入力後にsourceをUndoしても手入力値を維持し、`aria-live`へ安全な通知を出すこと。
- source手入力でその欄のUndoと一時`/`候補を破棄し、通常inputは120ms debounce、composition中は停止、compositionendで即時解析すること。内部inputではUndoを破棄しないこと。
- ×はpanel右上で他操作と区別できる40pxのbuttonとして表示し、3テーマで枠・背景・文字、hover/focus-visible/activeを判別できること。×とEscapeで候補を処理せず閉じ、入力右端の「候補操作を表示」buttonから再表示できること。欄別開閉設定だけがlocalStorageへ残り、候補・source・Undoは保存されないこと。破損JSON、SecurityError、quota errorはcatchして全欄openへ戻ること。
- 新しいファイルで旧Undo・旧候補・旧`/`状態を破棄し、ファイル解除とform resetで候補host、再表示button、強調属性を消すこと。投稿成功経路でもresetすること。
- 追記開始前に`suspend()`、追記終了後に`resume()`を呼び、module自身も`.is-append-mode`中のmountを拒否すること。

### ファイル・Phase 9C・表示

- ローカル実ブラウザで単体UTF-8 fixture、UTF-8 BOM、CP932日本語メタ情報、UTF-8 BMSを1件含むZIPを順に選択し、4欄への反映、候補mount、ZIP内部名、解析完了を確認した。検証用一時BOM/CP932/ZIPは終了後に削除する。
- 空送信でPhase 9C欄別エラー3件と候補panelを同時表示し、candidate側が`aria-invalid`を変更せず、重複IDが0であることを確認した。candidate hostは動的error要素より前に残ること。
- white/default/darkの各テーマを390/760/1366pxで確認し、9組すべて横overflowなし、panelがviewport内、info系panel色とdanger系error色が分離されることを確認した。
- 全操作は`type=button`で、前後候補、閉じる、再表示に明示的なaccessible nameがあること。候補文字列と競合通知をlive regionで読め、候補表示でfocusを奪わず、focus-visibleとreduced motionへ対応すること。
- ブラウザconsoleはローカルoriginから本番一覧APIを取得できない既存`api-charts-list`エラーだけで、metadata候補の未捕捉例外がないこと。

### 静的検査

- `node --check docs/chart-metadata-extract.js`、`docs/app.js`、`docs/branch-append-ui.js`、`docs/post-form-ui.js`、`docs/post-form-error-ui.js`が成功すること。
- HTML重複ID、`aria-describedby`参照、script順序を検査し、`chart-metadata-extract.js`がPhase 9C共通UIの後、`app.js`の前に読み込まれること。
- `git diff --check`が成功し、`worker/**`と`worker/wrangler.toml`に差分がなく、`WITHDRAWAL_CRON_MODE=observe`、Cron式が維持されること。

## SONG-AND-CHART-LINKS

### 一覧API

- 隔離D1へ0001～0008を適用し、`GET /api/versions`でorigin URLあり／なしと、通常停止／取り下げ専用停止あり／なしの4表示状態を確認する。DL可はURL encode済み`/api/files/{fileId}`、DL不可は`file.downloadUrl=null`となること。
- hidden版とprocessing/tombstoned版は公開一覧へ出ず、レスポンスに`r2_key`、R2 object key、`file_id`自体が含まれないこと。
- pagination、曲名・差分名・作者検索、未完成／完成／没譜面、JST日付範囲が既存条件を維持すること。
- `POST /api/versions/query`もGETと同じ`originUrl`/`file.downloadUrl`形式を返し、重複ID除去、存在しないお気に入り件数、200件上限を維持すること。

### 版ツリー・コンパクト一覧

- 版ツリーは「曲 / DLまたはDL不可 / 追記 / 投稿管理」の順で、曲URLなしでは曲だけを省略する。取り下げpendingの曲は残し、processing/tombstonedでは操作欄を表示しない。完成版に置換された中間履歴は曲を残してDL不可にする。
- 同じrowを複数回enhanceしても曲／DLを重複せず、`.version-download-control`だけがDL可否変換の対象となり、曲リンクのhrefとaccessible nameを壊さないこと。
- コンパクト一覧は7列目「リンク」へ曲＋DL、DLのみ、曲＋DL不可、DL不可のみを表示する。曲名は当サイト詳細、曲は外部URL、DLはローカルWorker APIを開くこと。お気に入り絞り込みも同じ表示にする。
- `javascript:`, `data:`, `file:`, `blob:`と不正URLは曲リンクにせず、HTML特殊文字を含むタイトル・差分名・URL属性をescapeする。曲リンクは`target=_blank`と`noopener noreferrer`、DL不可は非リンク・フォーカス不可とする。

### 表示・回帰・静的検査

- white/default/darkを390/760/1366pxで確認し、横overflow 0、曲／DLの重なりなし、リンクのhover/focus-visible、DL不可の無効表示、visited色、タッチ高を確認する。
- `node scripts/test-song-and-chart-links-static.js`と`node worker/scripts/test-version-list-links.mjs`を実行し、HTML重複ID、専用class、外部URL制限、Worker URL制限、R2情報非公開を確認する。
- `node --check`（app、branch tree、list）、Worker typecheck、Wrangler dry-run、既存metadata parser/static、withdrawal active隔離回帰、`git diff --check`を実行する。migration、schema、`worker/wrangler.toml`、Cron、16D active、D1/R2/Secret、本番環境を変更しない。

### 実施結果（2026-07-22）

- `worker/scripts/test-version-list-links.mjs`は4 check成功。4表示状態、URL encode、hidden/processing除外、R2情報非公開、pagination、検索、状態、日付、お気に入りGET/POST同形、重複除去、未取得件数、200/201件境界を隔離D1で確認した。
- ローカルPages 8787と隔離D1/R2のWorker 8788を起動し、トップ版ツリー、通常コンパクト一覧、お気に入り1件絞り込みを確認した。曲名は詳細URL、曲は外部URL、DLはWorker URL、DL不可はspanとなり、不正`javascript:` URLとHTML文字列はリンク／要素へ解釈されなかった。
- white/default/dark × 390/760/1366pxのトップ版ツリーとコンパクト一覧で、横overflow、操作重なり、画面外要素、曲／DL重複はいずれも0。外部属性欠落0、専用DL class欠落0、操作順一致、32px以上の一覧リンク操作高、focus-visible 2px、Console error/warning 0を確認した。
- Node構文、専用static、metadata parser/static、Worker typecheck、Wrangler dry-run、`git diff --check`が成功した。`worker/scripts/test-version-withdrawal-active.mjs`は18件成功し、16D/16D-R、Cron、R2 cleanupの回帰なしを確認した。
