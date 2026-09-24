# 開発ガイド

ビルド・テスト・配布の手順と、よくある変更のやり方。
コードの構成と設計の理由は [ARCHITECTURE.md](ARCHITECTURE.md) を先に読むと早い。

---

## 1. 準備

画面(TypeScript)は WSL の Node で、Rust と Windows 向けのビルドは**コンテナ**(podman)の中で扱う。
WSL に Rust を入れる必要は無い。

- Node.js 22 以上、`npm install`
- コンテナには Rust・cargo-xwin・clang / lld / llvm・.NET 10 と vpk(インストーラー)・WebKitGTK が入る
- podman(rootless)。Rust のビルドを使うコマンドは、中身を
  [scripts/container.mjs](../scripts/container.mjs) がコンテナの中で動かす。イメージは初回に自動で作る
  ([.devcontainer/Dockerfile](../.devcontainer/Dockerfile)。数分かかる)。Docker なら `CONTAINER_ENGINE=docker`
- VS Code の Dev Containers で開いてもよい([.devcontainer/devcontainer.json](../.devcontainer/devcontainer.json))。
  podman なら VS Code の設定で `"dev.containers.dockerPath": "podman"`。中では全部のコマンドがそのまま動く
  (Windows に置く `deploy:win` だけは powershell.exe が要るので WSL で打つ)

Windows で実機を相手に動かすときは、WSL で `npm run deploy:win` して Windows 側で起動する
(→ [§5](#5-windows-に置く))。

## 2. コマンド

| コマンド | やること |
|---|---|
| `npm run dev` | 画面だけを開発サーバーで出す(http://localhost:5173)。ブラウザで開いて触る(下記) |
| `npm run build` | 型チェック + `out/renderer/` に画面をビルド |
| `npm test` | 単体テスト(vitest) |
| `npm run test:watch` | テストを監視モードで |
| `npm run typecheck` | 画面側と、設定ファイル類を別々の tsconfig で型チェック |
| `npm run lint` | Biome で lint + フォーマット確認 |
| `npm run format` | Biome で整形と import の並べ替え |
| **`npm run check`** | **型チェック + lint + テスト。コミット時に自動で走る(下記)** |
| **`npm run check:rust`** | **Rust の整形・clippy(Linux 向けと Windows 向け)・テスト。`src-tauri/` を触ったコミットで自動で走る** |
| `npm run container -- <コマンド>` | コンテナの中でコマンドを動かす(`-- bash` でシェル) |
| `npm run package:win` | Windows 版の exe を作る(`dist/win32-x64/LiveKeymapViewer.exe`。コンテナの中で動く) |
| `npm run deploy:win` | 上に加えて、Windows のデスクトップに置く |
| `npm run installer:win` | `package:win` に加えて、`dist/releases/` にインストーラー(Setup.exe)と更新の包みを作る(vpk。[§5](#インストーラーと更新)) |
| `npm run diag:hid` | Windows の HID API から Cornix のインターフェースを調べ、Vial が答えるか・往復時間を見る(アプリには触らない) |
| `npm run shots` | モックを動かして状態ごとに画面を撮る(下記)。`-- --compare <前の出力>` で画素比較 |
| `npm run gen:icon` | `assets/icon.svg` から `icon.png` と `icon.ico` を作り直す([§6](#生成ファイルを作り直す)) |

### ビルドの構成

| 部分 | 中身 | ビルド |
|---|---|---|
| 画面 | `src/renderer/`(React)、`src/shared/` | Vite([vite.config.ts](../vite.config.ts))→ `out/renderer/` |
| 外側 | `src-tauri/`(Rust。ウィンドウ・HID・設定・ログ) | Tauri の CLI が cargo を呼ぶ([src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json)) |

`npm run package:win` は `tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle` を
呼ぶ。先に `npm run build`(型チェック + 画面のビルド)が走り、できた `out/renderer/` が exe に埋め込まれる。
cargo-xwin は MSVC の CRT と Windows SDK を落としてきて、Linux の clang / lld で Windows の exe を作る
(初回に 1GB ほど落とす。コンテナのボリュームに残る)。wine も Windows も要らない。

画面の開発は `npm run dev` をブラウザで開くのが速い。**Windows の Chrome / Edge で
http://localhost:5173 を開けば、WebView2 と同じ Chromium で見られる。** Tauri で動いていないときは
`window.api` が無いので保存やオーバーレイは効かないが、「モックで試す」で画面は全部触れる。
Chrome / Edge なら WebHID で実機にも繋がる(Tauri 版は Rust の hidapi を使うので、経路は違う)。

Tauri のウィンドウごと Linux で動かすこともできる。コンテナの中の仮想画面(Xvfb)で動かして撮る
やり方は [§4](#自動テストで確かめていないこと)。WSLg で手元の画面に出すには、WSLg のソケットを
コンテナに渡す設定が要る(まだ用意していない)。Linux の Tauri は WebKitGTK で描くので、
Windows の WebView2(Chromium)とは描き方が少し違う。見た目の確認は Chromium で行う。

### コミット時の自動チェック

`git commit` のたびに **husky** の pre-commit フック([.husky/pre-commit](../.husky/pre-commit))が
`npm run check` を走らせ、通らなければコミットを止める。5 秒ほどかかる。`src-tauri/` を触ったコミットでは
`npm run check:rust` も走る(コンテナで動くので数十秒)。

- `npm install` で自動的に有効になる(`prepare` で `husky` が `core.hooksPath` を設定する)
- 急ぎで飛ばしたいときは `git commit --no-verify`(または環境変数 `HUSKY=0`)
- 整形だけで落ちたなら `npm run format`(Rust は `npm run container -- cargo fmt --manifest-path src-tauri/Cargo.toml`)で直る
- 見るのは作業ツリー全体。一部だけステージしてコミットしても、ステージしていない変更込みで検査される
- VS Code のソース管理画面からのコミットで `npm` が見つからない場合に備えて、フックは nvm を読み込み直す

## 3. WSL で開発するときの注意

### キーボードが見えない

WSL2 には USB ホストコントローラが無く、`/dev/hidraw*` も作られない。**WSL やコンテナで動かすと
デバイスの候補に何も出ない**。アプリの不具合ではない。

- 画面の確認は「モックで試す」で行う
- 実機での確認は `npm run deploy:win` して Windows 側で行う

`usbipd-win` で USB を WSL に引き込めるが、その間キーボードは Windows から使えなくなる。
「Windows で実際に何が入力されているか」を見るアプリなので、その用途では意味がない。

### 日本語が豆腐(□)になる

`npm run shots` などで WSL の Electron が画面を描くとき、WSL には CJK フォントが入っていない。
Windows のフォントを使わせるのが手軽(sudo 不要)。コンテナには `fonts-noto-cjk` を入れてある:

```bash
mkdir -p ~/.config/fontconfig
cat > ~/.config/fontconfig/fonts.conf <<'XML'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>/mnt/c/Windows/Fonts</dir></fontconfig>
XML
fc-cache -f
```

または `sudo apt install -y fonts-noto-cjk`。

### 開発用の Electron が起動しない

アプリ本体は Tauri だが、`npm run shots` と `npm run gen:icon` は開発用に Electron を使う
(画面を Chromium で描いて撮る・SVG を描く。配布物には入らない)。

- `libnss3.so` などが無いと言われる → `sudo apt install -y libnss3 libnspr4 libasound2t64`
- `app` が undefined で落ちる → 環境変数 `ELECTRON_RUN_AS_NODE` が立っている。
  一部のツール(Claude Code など)の中から実行すると付いていることがある。`env -u ELECTRON_RUN_AS_NODE npm run shots`

### コンテナ(podman)

- 毎回 `"/" is not a shared mount` と警告が出るが、害は無い(rootless の podman が WSL で出すもの)
- `--userns=keep-id` でホストの自分とコンテナの `ubuntu` の uid を合わせている。これが無いと、
  コンテナで作ったファイル(`src-tauri/target/` など)がホストでは別人の持ち物になる
- crate と MSVC の CRT / Windows SDK は名前付きボリューム(`lkv-cargo-registry` / `lkv-xwin-cache`)に残る。
  `src-tauri/target/` は作業ツリーの中(git には入れない)
- Dockerfile を直すと、次に `scripts/container.mjs` を通したときにイメージを作り直す(名前が中身のハッシュ)

### 実機の通信を切り分ける

アプリで「繋がらない」「候補に出ない」ときは、`npm run diag:hid` で OS から見て答えるかを見る。
答えるならファームと OS は問題ない。Tauri 版は同じ Windows の HID API(hidapi)で話すので、
ここで答えるのにアプリで繋がらなければ、アプリの側の問題。

詳しい使い方と、2026-09-21 に分かったことは [BLUETOOTH.md §2.6・§8](BLUETOOTH.md)。
(Electron 版にあった `diag:webhid` は、アプリが WebHID を使わなくなったので外した。)

## 4. テスト

```
tests/
  decode / labels / kle / layoutOptions / encoderStrip   純粋ロジック
  layerState                                             レイヤー判定(HANDOFF §6)
  vial                                                   プロトコル(モック相手)と応答の照合
  keyboardSession                                        接続のライフサイクル
  webhidTransport                                        本物と同じ WebHidTransport 経路での読み込み、
                                                         答えるインターフェースの選び方
  nativeHid                                              Tauri 版の HID(Rust の hidapi を WebHID の形に)
  keyboardView.test.tsx                                  SVG の描画(react-dom/server で静的に)

src-tauri/src/*.rs の #[cfg(test)]                       設定の検証・画面外の復帰・ログの時刻など
                                                         (npm run check:rust で動く)
```

### モックデバイス

[`MockTransport`](../src/renderer/src/hid/mockTransport.ts) は vial-qmk の `via.c` / `vial.c` と
**同じバイト並び**で答える。キーマップは `reference/Cornix_設定_LT.vil`、定義は Cornix LP の
ファームから取り出した本物を XZ 圧縮のまま返すので、展開の経路まで通る。

テストから動かせるもの:

| メソッド | 用途 |
|---|---|
| `press(row, col)` / `release(row, col)` | 物理キーを押す・離す |
| `setKeycode(layer, row, col, code)` | Vial で編集された状況を作る |
| `abortUnlock()` | 挿し直しや別アプリの `vial_lock` を再現する |
| `requests` | 送られてきたリクエストの記録 |

呼び出し側が `validate` を付けて送ったのに応答が照合を通らなければ、**モックは例外を投げる**。
照合の条件を間違えるとテストが落ちる。

アプリの「モックで試す」では、図のキーをクリックすると押したまま / 離すが切り替わる
(`KeyboardConnection.toggleMockKey`)。マウスでは 1 つしか押さえられないので、押したままにできる
ようにしてある。アンロックは Tab と Q を押したままにして 10 秒ほど待つ(モックは vial-qmk 流に
200ms ごとに 50 から数える)。WSL で画面を確かめるときはこれを使う。

### 画面を撮って確かめる(`npm run shots`)

WSL では実機が見えないので、見た目は [`scripts/shots/`](../scripts/shots/) で撮って確かめる。
モックに繋いでアンロックし、レイヤーの長押し・Shift・プレビュー・メニュー・記号の出し方・設定・
狭い / 広いウィンドウ・オーバーレイを順に撮る(26 枚、1 分ほど)。画面は出さない。

```bash
npm run shots -- --out .shots/before          # 変える前に撮る
# …変更…
npm run shots -- --compare .shots/before      # .shots/latest に撮って、前と画素で比べる
```

- 撮るあいだはアニメーションと transition を止めるので、同じコードなら同じ絵になる。
  アンロックの進み具合(`02-unlocking-progress`)だけは、撮った瞬間でバーが少しずれる
- 画面は開発用の Electron(Chromium)で描く。Windows の WebView2 と同じ Chromium なので、見た目はそろう
- 保存の API(`window.api`)は `scripts/shots/preload.cjs` の、設定をメモリに持つだけのものに差し替えてある
- 撮る場面を足すなら `scripts/shots/electron.mjs` の `normalScenes` / `overlayScenes`。
  キーは図の `<title>` の先頭(`Space /` など)で探す
- 出力の `.shots/` はコミットしない

### 自動テストで確かめていないこと

実機・実ウィンドウ・見た目は Windows で手で確かめる:

1. 接続 → アンロック → キーを押すと光る
2. Space / BS / Del / `` ` `` の長押しで L2 / L1 / L3 / L4 に切り替わり、離すと戻る
3. `Ctrl+Alt+K` でオーバーレイ。クリックが下に抜ける。操作パネルにポインタを乗せると広がり、
   移動・濃さ・リサイズ・通常に戻すが効く
4. Vial でキーマップを変えてから「キーマップを読み直す」で反映される
5. JIS / US の切り替え
6. 最小化しているあいだに TG / DF を押しても、戻したときに表示が合っている
7. キーボードを抜き差しすると繋ぎ直す

Linux 版(WebKitGTK)なら、コンテナの中の仮想画面(Xvfb)で動かして撮れる。起動・モック・
モードの切り替え・`Ctrl+Alt+K`・設定の保存・オーバーレイの操作パネル(クリック透過中のカーソル)
は、2026-09-24 にこれで確かめた。Windows 固有のもの(WebView2・アクリル・実機の HID)は確かめられない。

## 5. Windows に置く

```bash
npm run deploy:win
```

`dist/win32-x64/LiveKeymapViewer.exe` を作り(コンテナの中で)、Windows のデスクトップの
`LiveKeymapViewer/` に置く。別の場所なら `npm run deploy:win -- --dest /mnt/c/Tools/LiveKeymapViewer`。

- **置き場所の exe が起動中なら、何もせずに止まる。** 閉じてからやり直す。勝手に終了させることはしない。
  見るのは置き場所の exe だけなので、別の場所に入れた版(インストーラーで入れたものなど)が
  動いていても置ける
- 隣に `.new` として完全にコピーしてから名前の付け替えで差し替えるので、途中で失敗しても
  元のフォルダは壊れない

**exe は 1 つで完結する。** 画面は Windows に入っている WebView2 で描く(Windows 11 には最初から
入っている。Windows 10 で無ければ Microsoft の配布ページから入れる)。アイコンとバージョン情報は
ビルドのときに exe に入る。

### インストーラーと更新

```bash
npm run installer:win
```

`dist/releases/` に次ができる。作るのは [Velopack](https://velopack.io/) の vpk
([scripts/pack-win.mjs](../scripts/pack-win.mjs))。vpk は .NET のツールで、コンテナに入っている。
Linux から Windows 向けの包みを作れる(`vpk [win] pack`)ので、ここでも wine は要らない。

| ファイル | 中身 |
|---|---|
| `live-keymap-viewer-win-Setup.exe` | インストーラー(13MB ほど)。ワンクリックで入れて起動する |
| `live-keymap-viewer-<版>-full.nupkg` | 更新の中身 |
| `releases.win.json` など | 更新の目録。入っているアプリはこれを読んで新しい版を知る |

- 入る場所は `%LOCALAPPDATA%\live-keymap-viewer`(パッケージ ID。ユーザーごとで、管理者権限は要らない)。
  **パッケージ ID(`live-keymap-viewer`)は変えない。** 変えると別のアプリとして扱われ、入っているものが
  更新されなくなる
- スタートメニューとデスクトップにショートカットを作る。名前と「設定 → アプリ」の表示は「Live Keymap Viewer」
- WebView2 が無ければ、Setup が先に入れる(`--framework webview2`)
- 設定とログは `%APPDATA%\live-keymap-viewer`。アンインストールしても残る
- Velopack のポータブル版は作らない。展開したところの起動用 exe に表示名(スペース入り)が付くため。
  ポータブル版は `dist/win32-x64/LiveKeymapViewer.exe` をそのまま使う(自分では更新しない)
- 署名していないので、初回は SmartScreen の「Windows によって PC が保護されました」が出る。
  「詳細情報」→「実行」で進む
- **vpk とアプリの `velopack` crate は同じ版にする**(`.devcontainer/Dockerfile` の `VPK_VERSION` と
  `src-tauri/Cargo.toml`)。CI は Dockerfile から版を読む

**更新の流れ。** インストーラーで入れたアプリは、起動して 5 秒後に GitHub のリリース
(`https://github.com/masacchi/live-keymap-viewer/releases/latest/download/releases.win.json`)を見に行く。
新しい版があれば設定ボタンに印が付き、設定パネルの「このアプリ」から「更新して再起動」で入れ替わる
(`src-tauri/src/updater.rs`)。見に行くのは**最新の正式リリース**だけで、プレリリースは対象にならない。
リポジトリが公開なので認証は要らない(exe にトークンを埋め込まない)。`deploy:win` で置いた exe や開発中は
Velopack の管理下に無いので、更新の欄には「インストーラーで入れたときに使えます」と出る。

**Electron 版(NSIS のインストーラー)から乗り換えるとき**は、先に「設定 → アプリ」から古い
「Live Keymap Viewer」をアンインストールしておく。入る場所が違う(`%LOCALAPPDATA%\Programs\LiveKeymapViewer`)
ので両方入ってしまい、ショートカットの名前も同じになる。設定(レイヤー名など)は、Tauri 版が初回の起動で
Electron 版の置き場所(`%APPDATA%\Live Keymap Viewer`)から写す。

### GitHub Actions でのビルド

[.github/workflows/build-windows.yml](../.github/workflows/build-windows.yml)。Ubuntu のランナーで、
手元と同じ `npm run check` → `check:rust` → `package:win` → `pack-win.mjs` を流し、ポータブル版
(exe 単体)も置く。ツールは Dockerfile と同じものを直に入れる(CI ではコンテナを通さない)。
Rust のビルド結果と MSVC の CRT / SDK はキャッシュする。キャッシュが無い初回は 10 分ほどかかる。

| きっかけ | やること |
|---|---|
| main への push(PR のマージを含む) | ビルドして、その実行の Artifacts にインストーラーとポータブル版を置く(14 日で消える) |
| `v*` のタグの push | ビルドして、GitHub のリリースを作って載せる(`vpk upload github`)。**入っているアプリはここから更新する** |
| 手動(Actions → 「Windows 版のビルド」→ Run workflow) | 選んだブランチでビルドする。「タグ」を書けばリリースも作る(無いタグなら、ビルドした commit に付ける) |

リリースするとき:

```bash
npm version 0.2.0 -m "chore: 版を %s に上げる"   # package.json を上げ、コミットと v0.2.0 のタグを作る
git push --follow-tags                          # タグの push でリリースまで走る
```

- **タグは `v` + package.json の版にする。** 合わないと最初の手順で止まる。アプリの画面・ログ・
  「設定 → アプリ」に出る版は package.json から来るので、リリースの名前と食い違わないように
- 手動で既にあるタグを書くと、そのタグの commit をビルドしているときだけ進む。別の commit なら止まる
  (既にあるタグでやり直すなら、「Use workflow from」でそのタグを選ぶ)
- `v0.2.0-beta.1` のように `-` の付くタグはプレリリースになる。**アプリの更新の対象にならない**
  (アプリは最新の正式リリースだけを見る)
- 同じタグでもう一度流すと、リリースは作り直さずに添付だけ差し替える
- リリースに載せるのは Setup.exe・更新の包み・目録(`releases.win.json` など)とポータブル版。
  目録と包みは vpk が付けた名前のまま載せる(アプリはその名前で取りに来る)
- リリースしないビルドは、ファイル名に commit の先頭 7 文字が付く
  (`LiveKeymapViewer-0.1.0-abc1234-win-x64-setup.exe`)。包みの版は `0.1.0-gabc1234`
  (SemVer にするため。commit が数字だけで 0 から始まると SemVer として正しくない)

## 6. よくある変更

### 文字の表示を変える・足す

[`keycodes/labels.ts`](../src/renderer/src/keycodes/labels.ts) の表を直す。

- `JIS_PRINTABLE` / `US_PRINTABLE` … 印字キーの `[通常, Shift]`
- `NAMED` … それ以外のキーの表示名と補足。US だけ変えるなら `us: { main, sub }`

`tests/labels.test.ts` にケースを足す。ベースレイヤーは `reference/keymap-preview.html` の
L0 と一致することを確かめるテストがある。

### 画面の文言を変える

ボタン・見出し・説明・ツールチップの文言は [`messages.ts`](../src/renderer/src/messages.ts) にまとめてある。
部品は `messages.toolbar.settings` のように引く。値の入る文言は関数(`messages.layerStrip.showBlank(5)`)。

- キーの表示名(`かな`・`マウス移動` など)は `keycodes/labels.ts` の表(上の「文字の表示を変える・足す」)
- 通信や定義の形式のエラー(`hid/`・`layout/`)は、原因の説明と切り離せないので起きた場所に書く
- テストは画面の文言で確かめているものが多い。文言を変えたらテストも直す
- **書き方の決まりは `messages.ts` の冒頭にある**(体言止めと常体の使い分け、
  「押す」はキーボードのキーだけ・マウスは「クリック」、専門用語を画面に出さない)
- 直したら `npm run shots` で撮って、実際の幅で読めるか・折り返しが増えていないかを見る

### 色やクラスを変える

- **色はすべて [`styles.css`](../src/renderer/src/styles.css) 冒頭の `@theme`**。`--color-surface` を足すと
  `bg-surface` / `text-surface` / `border-surface` … がそのまま使える。任意値(`text-[var(--…)]`)や
  Tailwind の既定色(`bg-rose-500` など)は直に書かない
- レイヤー色は番号で決まるのでクラスにできない。[`lib/theme.ts`](../src/renderer/src/lib/theme.ts) の
  `layerColor(n)` を style に渡す
- クラスの組み立ては [`lib/cn.ts`](../src/renderer/src/lib/cn.ts) の `cn()`。条件つきは
  `cn('…', active && '…')`、ぶつかるクラスは後ろが勝つ。独自の文字サイズを `@theme` に足すときの
  注意も同じファイルにある
- SVG のキーキャップは Tailwind ではなく `styles.css` のクラス(`.cap` `.key-pressed` …)。
  並びは「基本 → 種類 → 状態」を崩さない(ARCHITECTURE.md §7)

### レイヤー判定の規則を変える

- 押下 → レイヤーの流れ: [`engine/layerState.ts`](../src/renderer/src/engine/layerState.ts)
- 「長押しで出るレイヤー」の規則: [`keycodes/tapDance.ts`](../src/renderer/src/keycodes/tapDance.ts)
  の `holdLayerOf`。**レイヤー判定と色帯の描画の両方がこれを使う**ので、ここを直せば揃って変わる

`tests/layerState.test.ts` に Cornix のキー位置を使ったケースがある。

### プロトコルのコマンドを足す

1. [`hid/constants.ts`](../src/renderer/src/hid/constants.ts) にコマンドのバイトを足す
2. [`hid/vial.ts`](../src/renderer/src/hid/vial.ts) に関数を足す。送信は必ず内部の `send()` を通す。
   VIA コマンドなら応答の照合が自動で付く(`0xFE` は応答にエコーが無いので付かない)
3. [`hid/mockTransport.ts`](../src/renderer/src/hid/mockTransport.ts) に、ファームと同じ応答を書く。
   **根拠は vial-qmk のソースで確かめ、[PROTOCOL.md](PROTOCOL.md) に書き足す**
4. `tests/vial.test.ts` にテスト

### ほかのキーボードに対応する

キーマップ・配置はキーボードから読むので、**コードに足すものは基本的に無い**。条件は:

- Vial protocol 6 / VIA protocol 9
- `vial_protocol >= 3` かつ `(cols / 8 + 1) * rows <= 28`(matrix state が 1 パケットに収まる)

**これはモックで確かめてある**([tests/otherKeyboard.test.tsx](../tests/otherKeyboard.test.tsx))。
`MockTransport` は名乗るキーボードを差し替えられる(`MockOptions.keyboard`)ので、
行列の大きさもレイヤー数も違う・ノブ無し・レイアウトオプション無し・カスタムキーコード無し・
Tap Dance 無しのキーボードで、読み込み → 描画 → 押下 → レイヤー判定まで通している。
その定義 JSON は [`scripts/gen-test-boards.py`](../scripts/gen-test-boards.py) で作る
(実機と同じく XZ で固めた JSON)。

実機の `.vil` と定義 JSON が手に入るなら、`reference/` に置いて
[`scripts/gen-mock.py`](../scripts/gen-mock.py) 冒頭のパスを差し替えれば、その機種のモックになる。
定義 JSON をファームから取り出す手順は [reference/README.md](../reference/README.md)。

### 画面 ⇄ Rust のやり取りを足す

1. [`shared/ipc.ts`](../src/shared/ipc.ts) の `RendererApi` に関数を足す(部品はこれだけを知っている)
2. [`platform/tauri.ts`](../src/renderer/src/platform/tauri.ts) で、Rust のコマンドを呼んで実装する。
   引数の名前は camelCase で渡す(Rust の `vendor_id` なら `vendorId`)
3. [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs) にコマンドを書き、`main.rs` の
   `generate_handler!` に足す。**画面から来た値は範囲を確かめてから使う**(型は Tauri が確かめる)。
   待つ処理(HID・ウィンドウの作り直し)は `async` にする ― async でないコマンドはメインスレッドで動く
4. Rust から画面へ知らせるときはイベント。**このウィンドウ宛て**(`emit_to`)は画面で
   `getCurrentWebviewWindow().listen` で受ける(`platform/tauri.ts` の `subscribe(…, true)`)。
   全ウィンドウ宛ての `listen` で受けると、ほかのウィンドウ宛てのものまで届く

### 設定項目を足す

1. [`shared/settings.ts`](../src/shared/settings.ts) の `Settings`・`DEFAULT_SETTINGS`(画面が使う型と既定値)
2. [`src-tauri/src/settings.rs`](../src-tauri/src/settings.rs) の `Settings` と `sanitize`。**検証はこちらだけ**。
   壊れた値が来たら既定値に戻すこと。同じファイルの `#[cfg(test)]` にテスト
3. 画面から変えるなら、両方の `RENDERER_SETTINGS_KEYS` に足す。コマンドは足さなくてよい
   (`settings_update` 1 本で、Rust が変えてよい項目だけを取り出して検証する)
4. 画面では [`hooks/useSettings.ts`](../src/renderer/src/hooks/useSettings.ts) の `settings` で読み、
   `update({ 項目: 値 })` で変える
5. ウィンドウに効かせるもの(ぼかしなど)なら、[`src-tauri/src/windows.rs`](../src-tauri/src/windows.rs) の
   `apply_settings` で反映する

### 生成ファイルを作り直す

`*.generated.ts` は手で直さない。

```bash
python3 scripts/gen-keycodes.py   # vial-gui の keycodes_v6.py → keycodes/table.generated.ts
python3 scripts/gen-mock.py       # .vil + 定義 JSON → mock/cornix.generated.ts
```

`gen-keycodes.py` は vial-gui の `main` ブランチから取ってくるので、ネットワークが要る。

アイコンは `assets/icon.svg` が元で、`icon.png`(256px)と `icon.ico`(16〜256px)はそこから作る。
こちらも手で直さず、SVG を直して `npm run gen:icon` で作り直し、3 つともコミットする。
SVG を描くのに開発用の Electron の画面を使う。

- exe のアイコン(エクスプローラー・タスクバー・Alt+Tab)とインストーラーのアイコン・インストール中に
  出る絵(`icon.png`)はこれになる。
  exe へはビルドのときに Tauri が埋め込む(`src-tauri/tauri.conf.json` の `bundle.icon`)

## 7. 決まりごと

- **`npm run check` が通らないものはコミットしない。** pre-commit フックが止めるので、`--no-verify` で逃げない
- コミットは小さく。push は頼まれたときだけ
- コメントは日本語で、**何をしているかより、なぜそうしているか**を書く
- 依存は増やしすぎない(HANDOFF §2「最小限・保守しやすい構成」)
- Windows 側で動いているアプリを勝手に終了させない
