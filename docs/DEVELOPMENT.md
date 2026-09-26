# 開発ガイド

ビルド・テスト・配布の手順と、よくある変更のやり方。
コードの構成と設計の理由は、先に[ARCHITECTURE.md](ARCHITECTURE.md)を読むと早い。

---

## 1. 準備

画面(TypeScript)はWSLのNodeで、Rustと、Windows向けのビルドは**コンテナ**(podman)の中で扱う。
WSLにRustを入れる必要は無い。

- Node.js 22以上、`npm install`
- podman(rootless)。Rustのビルドを使うコマンドは、[scripts/container.mjs](../scripts/container.mjs)が
  コンテナの中で動かす。イメージは初回に自動で作る([.devcontainer/Dockerfile](../.devcontainer/Dockerfile)。
  数分かかる)。Dockerを使うなら`CONTAINER_ENGINE=docker`
- コンテナには、Rust・cargo-xwin・clang / lld / llvm・.NET 10とvpk(インストーラー)・WebKitGTKが入っている
- VS CodeのDev Containersで開いてもよい([.devcontainer/devcontainer.json](../.devcontainer/devcontainer.json))。
  podmanならVS Codeの設定で`"dev.containers.dockerPath": "podman"`にする。中では全部のコマンドがそのまま動く
  (Windowsに置く`deploy:win`だけはpowershell.exeが要るので、WSLで打つ)
- Dev Containersの中でもClaude Code(VS Codeの拡張)が使える。初回だけ中でログインする。
  ログインと設定は名前付きボリューム(`lkv-claude-config`)に残るので、作り直しても入り直さなくてよい。
  WSLの`~/.claude`とは別なので、WSLで入れた設定やメモリは中では見えない

Windowsで実機を相手に動かすときは、WSLで`npm run deploy:win`を打ち、Windows側で起動する
(→ [§5](#5-windowsに置く))。

## 2. コマンド

| コマンド | やること |
|---|---|
| `npm run dev` | 画面だけを開発サーバーで出す(<http://localhost:5173>)。ブラウザで開いて触る(下記) |
| `npm run build` | 型チェックと、`out/renderer/`への画面のビルド |
| `npm test` | 単体テスト(vitest) |
| `npm run test:watch` | テストを監視モードで |
| `npm run typecheck` | 画面と設定ファイル類を、別々のtsconfigで型チェック |
| `npm run lint` | Biomeでlintとフォーマットの確認 |
| `npm run format` | Biomeで整形と、importの並べ替え |
| **`npm run check`** | **型チェック + lint + テスト。コミット時に自動で走る(下記)** |
| **`npm run check:rust`** | **Rustの整形・clippy(Linux向けとWindows向け)・テスト。`src-tauri/`を変えたコミットで自動で走る** |
| `npm run container -- <コマンド>` | コンテナの中でコマンドを動かす(`-- bash`でシェルを開く) |
| `npm run package:win` | Windows版のexeを作る(`dist/win32-x64/LiveKeymapViewer.exe`。コンテナの中で動く) |
| `npm run deploy:win` | 上に加えて、Windowsのデスクトップに置く |
| `npm run installer:win` | `package:win`に加えて、`dist/releases/`にインストーラー(Setup.exe)と更新用のパッケージを作る(vpk。[§5](#インストーラーと更新)) |
| `npm run diag:hid` | WindowsのHID APIからCornixのインターフェースを調べ、Vialが答えるかと往復時間を見る(アプリには触らない) |
| `npm run shots` | モックを動かして、状態ごとに画面を撮る(下記)。`-- --compare <前の出力>`で画素を比べる |
| `npm run gen:icon` | `assets/icon.svg`から`icon.png`と`icon.ico`を作り直す([§6](#生成ファイルを作り直す)) |

### ビルドの構成

| 部分 | 中身 | ビルド |
|---|---|---|
| 画面 | `src/renderer/`(React)、`src/shared/` | Vite([vite.config.ts](../vite.config.ts))→ `out/renderer/` |
| Rust側 | `src-tauri/`(ウィンドウ・HID・設定・ログ・更新) | TauriのCLIがcargoを呼ぶ([src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json)) |

`npm run package:win`は`tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle`を
呼ぶ。先に`npm run build`(型チェックと画面のビルド)が走り、できた`out/renderer/`がexeに埋め込まれる。
cargo-xwinはMSVCのCRTとWindows SDKをダウンロードして、Linuxのclang / lldでWindowsのexeを作る
(初回に1GBほどダウンロードする。コンテナのボリュームに残る)。wineもWindowsも要らない。

画面の開発は、`npm run dev`をブラウザで開くのが速い。**WindowsのChrome / Edgeで
<http://localhost:5173>を開けば、WebView2と同じChromiumで見られる。** Tauriで動いていないときは
`window.api`が無いので、設定の保存やオーバーレイは効かないが、「モックで試す」で画面は全部触れる。
Chrome / EdgeならWebHIDで実機にも接続できる(デスクトップ版はRustのhidapiを使うので、経路は違う)。

Linux版のTauri(WebKitGTK)はコンテナの中でも動く。画面が要るので、仮想画面(Xvfb)を用意して起動する
([§4](#自動テストで確認していないこと))。WebKitGTKはWebView2(Chromium)と描き方が少し違うので、
見た目の確認はChromiumで行う。

### コミット時の自動チェック

`git commit`のたびに、**husky**のpre-commitフック([.husky/pre-commit](../.husky/pre-commit))が
`npm run check`を走らせ、通らなければコミットを止める。5秒ほどかかる。`src-tauri/`を変えたコミットでは
`npm run check:rust`も走る(コンテナで動くので数十秒)。

- `npm install`で自動的に有効になる(`prepare`で`husky`が`core.hooksPath`を設定する)
- 急ぎで飛ばしたいときは`git commit --no-verify`(または環境変数`HUSKY=0`)
- 整形だけで落ちたなら`npm run format`(Rustは`npm run container -- cargo fmt --manifest-path src-tauri/Cargo.toml`)で直る
- 見るのは作業ツリー全体。一部だけステージしてコミットしても、ステージしていない変更も込みで検査される
- VS Codeのソース管理画面からのコミットで`npm`が見つからない場合に備えて、フックはnvmを読み込み直す

## 3. WSLで開発するときの注意

### キーボードが見えない

WSL2にはUSBのホストコントローラが無く、`/dev/hidraw*`も作られない。**WSLやコンテナで動かすと、
デバイスの候補に何も出ない**。アプリの不具合ではない。

- 画面の確認は「モックで試す」で行う
- 実機での確認は`npm run deploy:win`して、Windows側で行う

`usbipd-win`でUSBをWSLに引き込むこともできるが、そのあいだキーボードはWindowsから使えなくなる。
「Windowsで実際に何が入力されているか」を見るアプリなので、この用途では意味がない。

### 日本語が豆腐(□)になる

`npm run shots`などでWSLのChromiumが画面を描くとき、WSLにはCJKフォントが入っていない。
Windowsのフォントを使わせるのが手軽(sudoは要らない)。コンテナには`fonts-noto-cjk`を入れてある。

```bash
mkdir -p ~/.config/fontconfig
cat > ~/.config/fontconfig/fonts.conf <<'XML'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>/mnt/c/Windows/Fonts</dir></fontconfig>
XML
fc-cache -f
```

または`sudo apt install -y fonts-noto-cjk`。

### 開発用のElectronが起動しない

`npm run shots`と`npm run gen:icon`は、画面をChromiumで描いて撮る・SVGを描くために、開発用のElectronを
使う(アプリ本体ではなく、配布物にも入らない)。

- `libnss3.so`などが無いと言われる → `sudo apt install -y libnss3 libnspr4 libasound2t64`
  (Dev Containerのイメージには入れてある)
- `app`がundefinedで落ちる → 環境変数`ELECTRON_RUN_AS_NODE`が立っている。
  一部のツール(Claude Codeなど)の中から実行すると付いていることがある。`env -u ELECTRON_RUN_AS_NODE npm run shots`

### コンテナ(podman)

- 毎回`"/" is not a shared mount`と警告が出るが、害は無い(rootlessのpodmanがWSLで出すもの)
- `--userns=keep-id`で、ホストの自分とコンテナの`ubuntu`のuidを合わせている。これが無いと、
  コンテナで作ったファイル(`src-tauri/target/`など)がホストでは別人の持ち物になる
- crateとMSVCのCRT / Windows SDKは、名前付きボリューム(`lkv-cargo-registry` / `lkv-xwin-cache`)に残る。
  `src-tauri/target/`は作業ツリーの中(gitには入れない)
- **Dev Containerのビルド結果は`src-tauri/target/devcontainer/`に分けてある**(devcontainer.jsonの
  `CARGO_TARGET_DIR`)。WSLから`npm run container`で動かすときは作業ツリーをホストと同じパスに置き、
  Dev Containerは`/workspaces/…`に置くので、同じ場所を使うとビルドスクリプトが残した絶対パスが食い違い、
  「failed to read plugin permissions」などで失敗する。`package-win.mjs`は`CARGO_TARGET_DIR`に従う
- Dockerfileを直すと、次に`scripts/container.mjs`を通したときにイメージを作り直す(イメージの名前が中身のハッシュ)

### 実機の通信を切り分ける

アプリで接続できない・候補に出ないときは、`npm run diag:hid`で、OSから見てキーボードが答えるかを確認する。
答えるならファームとOSは問題ない。アプリも同じWindowsのHID API(hidapi)で話すので、
ここで答えるのにアプリで接続できなければ、アプリの側の問題。

詳しい使い方と、これまでに分かったことは[BLUETOOTH.md §2.6・§8](BLUETOOTH.md)にある。

## 4. テスト

```
tests/
  decode / labels / kle / layoutOptions /     純粋なロジック
  encoderStrip / knobButtons /
  layerSummary / symbolRoutes
  layerState                                  レイヤーの判定(ARCHITECTURE.md §4)
  preview                                     プレビューの規則(usePreviewのreducer)
  vial                                        プロトコル(モック相手)と応答の照合
  definitionCache / keymapCache               キャッシュの読み書き
  keyboardSession                             接続1回ぶんのライフサイクル
  keyboardConnection                          接続の持ち方と再接続
  webhidTransport                             本物と同じWebHidTransportの経路での読み込み、
                                              答えるインターフェースの選び方
  bluetoothLatency                            Bluetoothの遅さ(往復250〜500ms)でも正しい回に読めるか。
                                              本物の時間で待つので、ファイルを分けて並べて走らせる
  nativeHid                                   デスクトップ版のHID(RustのhidapiをWebHIDの形に)
  otherKeyboard                               Cornix以外のキーボード(別の機種を名乗るモック)
  keyboardView / panels                       SVGの描画と部品(react-dom/serverで静的に)

src-tauri/src/*.rsの#[cfg(test)]              設定の検証・画面外からの復帰・ログの時刻など
                                              (npm run check:rustで動く)
```

### モックデバイス

[`MockTransport`](../src/renderer/src/hid/mockTransport.ts)は、vial-qmkの`via.c` / `vial.c`と
**同じバイト並び**で答える。キーマップは`reference/Cornix_設定_LT.vil`、定義はCornix LPの
ファームから取り出した本物をXZ圧縮のまま返すので、展開の経路まで通る。

テストから動かせるもの:

| メソッド | 用途 |
|---|---|
| `press(row, col)` / `release(row, col)` | 物理キーを押す・離す |
| `setKeycode(layer, row, col, code)` | Vialで編集された状況を作る |
| `abortUnlock()` | 挿し直しや、別アプリからの`vial_lock`を再現する |
| `requests` | 送られてきたリクエストの記録 |

呼び出し側が`validate`を付けて送ったのに、応答が照合を通らなければ、**モックは例外を投げる**。
照合の条件を間違えるとテストが落ちる。

アプリの「モックで試す」では、図のキーをクリックすると押したまま / 離すが切り替わる
(`KeyboardConnection.toggleMockKey`)。マウスでは1つしか押さえられないので、押したままにできる
ようにしてある。アンロックはTabとQを押したままにして10秒ほど待つ(モックはvial-qmkと同じく、
200msごとに50から数える)。WSLで画面を確認するときはこれを使う。

### 画面を撮って確認する(`npm run shots`)

WSLでは実機が見えないので、見た目は[`scripts/shots/`](../scripts/shots/)で撮って確認する。
モックに接続してアンロックし、レイヤーの長押し・Shift・プレビュー・メニュー・記号の出し方・設定・
狭い / 広いウィンドウ・オーバーレイを順に撮る(26枚、1分ほど)。画面は出さない。

```bash
npm run shots -- --out .shots/before          # 変える前に撮る
# …変更…
npm run shots -- --compare .shots/before      # .shots/latestに撮って、前と画素で比べる
```

- 撮るあいだはアニメーションとtransitionを止めるので、同じコードなら同じ絵になる。
  アンロックの進み具合(`02-unlocking-progress`)だけは、撮った瞬間でバーが少しずれる
- 画面は開発用のElectron(Chromium)で描く。WindowsのWebView2と同じChromiumなので、見た目はそろう
- `window.api`は`scripts/shots/preload.cjs`の、設定をメモリに持つだけのものに差し替えてある
- 撮る場面を足すなら`scripts/shots/electron.mjs`の`normalScenes` / `overlayScenes`。
  キーは図の`<title>`の先頭(`Space /`など)で探す
- 出力の`.shots/`はコミットしない

### 自動テストで確認していないこと

実機・実際のウィンドウ・見た目は、Windowsで手で確認する。

1. 接続 → アンロック → キーを押すと光る
2. Space / BS / Del / `` ` ``の長押しでL2 / L1 / L3 / L4に切り替わり、離すと戻る
3. `Ctrl+Alt+K`でオーバーレイになる。クリックが下に抜ける。操作パネルにポインタを乗せると広がり、
   移動・濃さ・リサイズ・通常ウィンドウに戻すが効く
4. Vialでキーマップを変えてから「キーマップを読み直す」で反映される
5. JIS / USの切り替え
6. 最小化しているあいだにTG / DFを押しても、戻したときに表示が合っている
7. キーボードを抜き差しすると再接続する

Linux版(WebKitGTK)なら、コンテナの中の仮想画面(Xvfb)で動かして撮れる。起動・モック・
モードの切り替え・`Ctrl+Alt+K`・設定の保存・オーバーレイの操作パネル(クリック透過中のカーソル)は、
これで確認できる。Xvfb・xdotool・ImageMagickはコンテナに入れていないので、使うときに入れる。
Windows固有のもの(WebView2・アクリル・実機のHID)は確認できない。

## 5. Windowsに置く

```bash
npm run deploy:win
```

`dist/win32-x64/LiveKeymapViewer.exe`を作り(コンテナの中で)、Windowsのデスクトップの
`LiveKeymapViewer/`に置く。別の場所なら`npm run deploy:win -- --dest /mnt/c/Tools/LiveKeymapViewer`。

- **置き場所のexeが起動中なら、何もせずに止まる。** 閉じてからやり直す。勝手に終了させることはしない。
  見るのは置き場所のexeだけなので、別の場所に入れた版(インストーラーで入れたものなど)が
  動いていても置ける
- 隣に`.new`として完全にコピーしてから、名前の付け替えで差し替えるので、途中で失敗しても
  元のフォルダは壊れない

**exeは1つで完結する。** 画面はWindowsに入っているWebView2で描く(Windows 11には最初から
入っている。Windows 10で無ければ、Microsoftの配布ページから入れる)。アイコンとバージョン情報は
ビルドのときにexeに入る。

### インストーラーと更新

```bash
npm run installer:win
```

`dist/releases/`に次のものができる。作るのは[Velopack](https://velopack.io/)のvpk
([scripts/pack-win.mjs](../scripts/pack-win.mjs))。vpkは.NETのツールで、コンテナに入っている。
LinuxからWindows向けのパッケージを作れる(`vpk [win] pack`)ので、ここでもwineは要らない。

| ファイル | 中身 |
|---|---|
| `live-keymap-viewer-win-Setup.exe` | インストーラー(13MBほど)。ワンクリックで入れて起動する |
| `live-keymap-viewer-<版>-full.nupkg` | 更新用のパッケージ |
| `releases.win.json`など | リリースの一覧。インストール済みのアプリは、これを読んで新しい版を知る |

- 入る場所は`%LOCALAPPDATA%\live-keymap-viewer`(パッケージIDから決まる。ユーザーごとで、管理者権限は要らない)。
  **パッケージID(`live-keymap-viewer`)は変えない。** 変えると別のアプリとして扱われ、入っているものが
  更新されなくなる
- スタートメニューとデスクトップにショートカットを作る。名前と「設定 → アプリ」の表示は「Live Keymap Viewer」
- WebView2が無ければ、Setupが先に入れる(`--framework webview2`)
- 設定とログは`%APPDATA%\live-keymap-viewer`。アンインストールしても残る
- Velopackのポータブル版は作らない。展開したところの起動用exeに表示名(スペース入り)が付くため。
  ポータブル版は`dist/win32-x64/LiveKeymapViewer.exe`をそのまま使う(自分では更新しない)
- 署名していないので、初回はSmartScreenの「WindowsによってPCが保護されました」が出る。
  「詳細情報」→「実行」で進む
- **vpkとアプリの`velopack` crateは同じ版にする**(`.devcontainer/Dockerfile`の`VPK_VERSION`と
  `src-tauri/Cargo.toml`)。CIはDockerfileから版を読む

**更新の流れ。** インストーラーで入れたアプリは、起動して5秒後(その後も6時間ごと)にGitHubのリリース
(`https://github.com/masacchi/live-keymap-viewer/releases/latest/download/releases.win.json`)を見に行く。
新しい版があれば設定ボタンに印が付き、設定パネルの「このアプリ」から「更新して再起動」で入れ替わる
(`src-tauri/src/updater.rs`)。見に行くのは**最新の正式リリース**だけで、プレリリースは対象にならない。
リポジトリが公開なので、認証は要らない(exeにトークンを埋め込まない)。`deploy:win`で置いたexeや
開発中のものはVelopackの管理下に無いので、更新の欄には「更新は、インストーラーで入れたときに使えます」と出る。

### 開発版とリリース版

mainへのpushでCIが作る**開発版**は、リリース版とは別のアプリとして入る。1台に両方を並べて入れられ、
開発版は開発版どうしで更新する。リリース版には自動では移らない(使い続けるなら、リリース版を別に入れる)。

| | リリース版 | 開発版 |
|---|---|---|
| 作るきっかけ | `v*`のタグ | mainへのpush |
| パッケージID・入る場所 | `live-keymap-viewer` | `live-keymap-viewer-dev` |
| 表示名(ショートカット・ウィンドウ) | Live Keymap Viewer | Live Keymap Viewer Dev |
| 設定とログ | `%APPDATA%\live-keymap-viewer` | `%APPDATA%\live-keymap-viewer-dev` |
| WebView2のデータ(キャッシュ) | identifierが`io.github.masacchi.live-keymap-viewer` | 同じく`…-dev` |
| 更新を探す場所 | `releases/latest/download`(最新の正式リリース) | `releases/download/dev-build` |
| 版 | package.jsonの版(`0.1.0`) | 次のパッチ版 + 実行番号(`0.1.1-dev.42`) |

- 分けるのは、並べて動かしたときに同じ`settings.json`を書き合わないようにするため。どちらになるかは
  ビルドのときに決まる(`package-win.mjs --dev`が環境変数`LKV_DEV`を立て、Rustの`src-tauri/src/channel.rs`が読む。
  identifierは`tauri build --config`で差し替える)。パッケージは`pack-win.mjs --dev`で開発版のIDにする
- 開発版の版に実行番号を使うのは、ビルドのたびに必ず増やすため(commitのハッシュでは新しい順に並ばない)。
  次のパッチ版にするのは、`0.1.0-dev.N`だと出したばかりの`0.1.0`より古い扱いになるため
- 2つを同時に起動すると、`Ctrl+Alt+K`は先に起動した方だけが受け取る(後の方はログに警告を残す)
- 手元で開発版を作るなら`npm run package:win -- --dev --version 0.1.1-dev.0`のあと
  `npm run container -- node scripts/pack-win.mjs --dev --version 0.1.1-dev.0`

### GitHub Actionsでのビルド

[.github/workflows/build-windows.yml](../.github/workflows/build-windows.yml)。Ubuntuのランナーで、
手元と同じ`npm run check` → `check:rust` → `package:win` → `pack-win.mjs`を流し、ポータブル版
(exe単体)も置く。ツールはDockerfileと同じものを直に入れる(CIではコンテナを通さない)。
Rustのビルド結果と、MSVCのCRT / SDKはキャッシュする。キャッシュが無い初回は10分ほどかかる。

cargo-xwinは、配布されているバイナリ(`taiki-e/install-action`などが入れるmusl版)を**使わない**。
メモリの扱いが遅く、キャッシュの無いときの「Downloading MSVC CRT...」が10分以上進まなくなる。
crates.ioから`cargo install`したglibc版なら十数秒で終わる。版はDockerfileの`CARGO_XWIN_VERSION`を
CIも読む(入れたcargo-xwinもキャッシュに残るので、ビルドし直すのは初回だけ)。

| きっかけ | やること |
|---|---|
| mainへのpush(PRのマージを含む)で、package.jsonの版のタグがまだ無い | **リリースする**。ビルドして正式リリースを作り、そのcommitに`v` + 版のタグを付ける(`v*`のタグのpushと同じ結果) |
| mainへのpush(PRのマージを含む)で、タグが既にある | **開発版**をビルドして、GitHubのリリース**dev-build**(プレリリース)にインストーラー・ポータブル版・更新用のパッケージとリリースの一覧を置く。前のビルドのファイルは消す。入っている開発版はここから更新する。プレリリースなので、リリース版の更新の対象にはならない |
| `v*`のタグのpush | ビルドして、GitHubのリリースを作って載せる(`vpk upload github`)。**インストール済みのアプリはここから更新する** |
| 手動(Actions → 「Windows版のビルド」→ Run workflow) | 選んだブランチでビルドする。「タグ」を書けばリリースも作る(無いタグなら、ビルドしたcommitに付ける)。書かなければdev-buildを更新する |

リリースするとき:

```bash
npm version 0.2.0 -m "chore: 版を%sに上げる"   # 版を上げてコミットする(Cargo.tomlの版も合わせる)
git push                                       # v0.2.0のタグがまだ無いので、CIがリリースしてタグを付ける
```

- **版を上げてmainにpushするだけでリリースになる。** タグは手元に残さない。`npm version`はコミットと
  タグを作るが、package.jsonの`postversion`でタグを消す。手元で作ってpushすると、mainへのpushと
  タグのpushで同じ版のビルドが2回走るため(npmの`git-tag-version=false`では、タグだけでなくコミットも
  作らなくなるので使わない)。タグがあるかは`git ls-remote`で確かめ、確かめられなければ止まる
  (既にある版を作り直さないように)
- `npm version`は、コミットする前に`version`スクリプトで`src-tauri/Cargo.toml`と`Cargo.lock`の版を
  package.jsonに合わせ、同じコミットに入れる(`scripts/sync-version.mjs`)。画面とexeに出る版は
  package.jsonから来るので表示には効かないが、ビルドのログの版が食い違わないように
- 版を上げずにpushしたものは開発版になる

- **タグは`v` + package.jsonの版にする。** 合わないと最初の手順で止まる。手動実行で`0.1.0`のように
  `v`を付け忘れたときは、CIが補う。アプリの画面・ログ・
  「設定 → アプリ」に出る版はpackage.jsonから来るので、リリースの名前と食い違わないようにする
- 手動で既にあるタグを書くと、そのタグのcommitをビルドしているときだけ進む。別のcommitなら止まる
  (既にあるタグでやり直すなら、「Use workflow from」でそのタグを選ぶ)
- `v0.2.0-beta.1`のように`-`の付くタグはプレリリースになる。**アプリの更新の対象にならない**
  (アプリは最新の正式リリースだけを見る)
- 同じタグでもう一度流すと、リリースは作り直さずに添付だけ差し替える
- リリースに載せるのは、Setup.exe・更新用のパッケージ・リリースの一覧(`releases.win.json`など)とポータブル版。
  リリースの一覧とパッケージは、vpkが付けた名前のまま載せる(アプリはその名前で取りに来る)
- リリースしないビルドは開発版になり、ファイル名に開発版の版が付く
  (`LiveKeymapViewer-Dev-0.1.1-dev.42-win-x64-setup.exe`)。どのcommitかはリリースの題名に出る

## 6. よくある変更

### 文字の表示を変える・足す

[`keycodes/labels.ts`](../src/renderer/src/keycodes/labels.ts)の表を直す。

- `JIS_PRINTABLE` / `US_PRINTABLE` … 印字キーの`[通常, Shift]`
- `NAMED` … それ以外のキーの表示名と補足。USだけ変えるなら`us: { main, sub }`

`tests/labels.test.ts`にケースを足す。ベースレイヤーが`reference/keymap-preview.html`の
L0と一致することを確かめるテストがある。

### 画面の文言を変える

ボタン・見出し・説明・ツールチップの文言は[`messages.ts`](../src/renderer/src/messages.ts)にまとめてある。
部品は`messages.toolbar.settings`のように引く。値の入る文言は関数にする(`messages.layerStrip.showBlank(5)`)。

- キーの表示名(`かな`・`マウス移動`など)は`keycodes/labels.ts`の表(上の「文字の表示を変える・足す」)
- 通信や定義の形式のエラー(`hid/`・`layout/`)は、原因の説明と切り離せないので、起きた場所に書く
- テストは画面の文言で確認しているものが多い。文言を変えたらテストも直す
- **書き方の決まりは`messages.ts`の冒頭にある**(体言止めとですます調の使い分け、
  「押す」はキーボードのキーだけに使いマウスは「クリック」、専門用語を画面に出さない)
- 直したら`npm run shots`で撮って、実際の幅で読めるか、折り返しが増えていないかを見る

### 色やクラスを変える

- **色はすべて[`styles.css`](../src/renderer/src/styles.css)の冒頭の`@theme`**。`--color-surface`を足すと
  `bg-surface` / `text-surface` / `border-surface` … がそのまま使える。任意値(`text-[var(--…)]`)や
  Tailwindの既定色(`bg-rose-500`など)は直に書かない
- レイヤー色は番号で決まるのでクラスにできない。[`lib/theme.ts`](../src/renderer/src/lib/theme.ts)の
  `layerColor(n)`をstyleに渡す
- クラスの組み立ては[`lib/cn.ts`](../src/renderer/src/lib/cn.ts)の`cn()`。条件つきは
  `cn('…', active && '…')`、ぶつかるクラスは後ろが勝つ。独自の文字サイズを`@theme`に足すときの
  注意も同じファイルにある
- SVGのキーキャップはTailwindではなく、`styles.css`のクラス(`.cap` `.key-pressed` …)。
  並びは「基本 → 種類 → 状態」を崩さない(ARCHITECTURE.md §7)

### レイヤーの判定の規則を変える

- 押下 → レイヤーの流れ: [`engine/layerState.ts`](../src/renderer/src/engine/layerState.ts)
  (規則はARCHITECTURE.md §4の「レイヤーの判定」)
- 「長押しで出るレイヤー」の規則: [`keycodes/tapDance.ts`](../src/renderer/src/keycodes/tapDance.ts)
  の`holdLayerOf`。**レイヤーの判定と色帯の描画の両方がこれを使う**ので、ここを直せば両方そろって変わる

`tests/layerState.test.ts`に、Cornixのキーの位置を使ったケースがある。

### プロトコルのコマンドを足す

1. [`hid/constants.ts`](../src/renderer/src/hid/constants.ts)にコマンドのバイトを足す
2. [`hid/vial.ts`](../src/renderer/src/hid/vial.ts)に関数を足す。送信は必ず内部の`send()`を通す。
   VIAコマンドなら応答の照合が自動で付く(`0xFE`は応答にエコーが無いので付かない)
3. [`hid/mockTransport.ts`](../src/renderer/src/hid/mockTransport.ts)に、ファームと同じ応答を書く。
   **根拠はvial-qmkとRMKのソースで確認し、[PROTOCOL.md](PROTOCOL.md)に書き足す**
4. `tests/vial.test.ts`にテストを足す

### ほかのキーボードに対応する

キーマップ・配置はキーボードから読むので、**コードに足すものは基本的に無い**。条件は次のとおり。

- Vial protocol 6 / VIA protocol 9
- `vial_protocol >= 3`かつ`(cols / 8 + 1) * rows <= 28`(matrix stateが1パケットに収まる)

**これはモックで確認してある**([tests/otherKeyboard.test.tsx](../tests/otherKeyboard.test.tsx))。
`MockTransport`は名乗るキーボードを差し替えられる(`MockOptions.keyboard`)ので、
行列の大きさもレイヤー数も違う・ノブ無し・レイアウトオプション無し・カスタムキーコード無し・
Tap Dance無しのキーボードで、読み込み → 描画 → 押下 → レイヤーの判定まで通している。
その定義JSONは[`scripts/gen-test-boards.py`](../scripts/gen-test-boards.py)で作る
(実機と同じく、XZで固めたJSON)。

実機の`.vil`と定義JSONが手に入るなら、`reference/`に置いて
[`scripts/gen-mock.py`](../scripts/gen-mock.py)の冒頭のパスを差し替えれば、その機種のモックになる。
定義JSONをファームから取り出す手順は[reference/README.md](../reference/README.md)にある。

### 画面とRustのやり取りを足す

1. [`shared/ipc.ts`](../src/shared/ipc.ts)の`RendererApi`に関数を足す(部品はこれだけを知っている)
2. [`platform/tauri.ts`](../src/renderer/src/platform/tauri.ts)で、Rustのコマンドを呼んで実装する。
   引数の名前はcamelCaseで渡す(Rustの`vendor_id`なら`vendorId`)
3. [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs)にコマンドを書き、`main.rs`の
   `generate_handler!`に足す。**画面から来た値は範囲を確認してから使う**(型はTauriが確認する)。
   待つ処理(HID・ウィンドウの作り直し)は`async`にする(asyncでないコマンドはメインスレッドで動く)
4. Rustから画面へ知らせるときはイベントを使う。**このウィンドウ宛て**(`emit_to`)のものは、画面で
   `getCurrentWebviewWindow().listen`で受ける(`platform/tauri.ts`の`subscribe(…, true)`)。
   全ウィンドウ宛ての`listen`で受けると、ほかのウィンドウ宛てのものまで届く

### 設定の項目を足す

1. [`shared/settings.ts`](../src/shared/settings.ts)の`Settings`・`DEFAULT_SETTINGS`(画面が使う型と既定値)
2. [`src-tauri/src/settings.rs`](../src-tauri/src/settings.rs)の`Settings`と`sanitize`。**検証はこちらだけ**。
   壊れた値が来たら既定値に戻すこと。同じファイルの`#[cfg(test)]`にテストを足す
3. 画面から変えるなら、両方の`RENDERER_SETTINGS_KEYS`に足す。コマンドは足さなくてよい
   (`settings_update`の1つで、Rustが変えてよい項目だけを取り出して検証する)
4. 画面では[`hooks/useSettings.ts`](../src/renderer/src/hooks/useSettings.ts)の`settings`で読み、
   `update({ 項目: 値 })`で変える
5. ウィンドウに効かせるもの(ぼかしなど)なら、[`src-tauri/src/windows.rs`](../src-tauri/src/windows.rs)の
   `apply_settings`で反映する

### 生成ファイルを作り直す

`*.generated.ts`は手で直さない。

```bash
python3 scripts/gen-keycodes.py   # vial-guiのkeycodes_v6.py → keycodes/table.generated.ts
python3 scripts/gen-mock.py       # .vil + 定義JSON → mock/cornix.generated.ts
```

`gen-keycodes.py`はvial-guiの`main`ブランチから取ってくるので、ネットワークが要る。

アイコンは`assets/icon.svg`が元で、`icon.png`(256px)と`icon.ico`(16〜256px)はそこから作る。
こちらも手で直さず、SVGを直して`npm run gen:icon`で作り直し、3つともコミットする。
SVGを描くのに、開発用のElectronの画面を使う。

- exeのアイコン(エクスプローラー・タスクバー・Alt+Tab)と、インストーラーのアイコン・インストール中に
  出る絵(`icon.png`)はこれになる。exeへはビルドのときにTauriが埋め込む(`src-tauri/tauri.conf.json`の`bundle.icon`)

## 7. 決まりごと

- **`npm run check`が通らないものはコミットしない。** pre-commitフックが止めるので、`--no-verify`で逃げない
- コミットは小さく。pushは頼まれたときだけ
- コメントとドキュメントは日本語で、**何をしているかより、なぜそうしているか**を書く。
  日本語と英数字のあいだに半角スペースを入れない(書き方の決まりは[CLAUDE.md](../CLAUDE.md)の「書き方」)
- 依存は増やしすぎない(最小限で保守しやすい構成にする)
- Windows側で動いているアプリを勝手に終了させない
