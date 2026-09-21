# 開発ガイド

ビルド・テスト・配布の手順と、よくある変更のやり方。
コードの構成と設計の理由は [ARCHITECTURE.md](ARCHITECTURE.md) を先に読むと早い。

---

## 1. 準備

- Node.js 22 以上
- `npm install`

Windows で実機を相手に動かすときは、WSL で `npm run deploy:win` して Windows 側で起動する
(→ [§5](#5-windows-に置く))。

## 2. コマンド

| コマンド | やること |
|---|---|
| `npm run dev` | 開発サーバーつきで起動(下記) |
| `npm run build` | 型チェック + `out/` にビルド |
| `npm start` | ビルド済みの `out/` を起動 |
| `npm test` | 単体テスト(vitest) |
| `npm run test:watch` | テストを監視モードで |
| `npm run typecheck` | main 側と renderer 側を別々の tsconfig で型チェック |
| `npm run lint` | Biome で lint + フォーマット確認 |
| `npm run format` | Biome で整形と import の並べ替え |
| **`npm run check`** | **型チェック + lint + テスト。コミット時に自動で走る(下記)** |
| `npm run package:win` | ビルドして `dist/win32-x64/` に Windows 版一式を作る |
| `npm run deploy:win` | 上に加えて、Windows のデスクトップに置く |

### ビルドの構成

Vite で 3 つを別々にビルドして `out/` に置く。electron-vite は使っていない(理由は
[ARCHITECTURE.md §6](ARCHITECTURE.md#6-設計の判断とその理由))。

| 対象 | 設定 | 出力 |
|---|---|---|
| renderer | [vite.config.ts](../vite.config.ts) | `out/renderer/` |
| main | [vite.main.config.ts](../vite.main.config.ts) | `out/main/index.js` |
| preload | [vite.preload.config.ts](../vite.preload.config.ts) | `out/preload/index.mjs` |

`npm run dev`([scripts/dev.mjs](../scripts/dev.mjs))は renderer の開発サーバーを立て、main と preload を
監視つきでビルドしてから Electron を起動する。

- renderer を変える → ホットリロード
- main を変える → Electron を再起動
- preload を変える → 画面を再読み込み
- Electron のウィンドウを閉じる → `npm run dev` も終わる

### コミット時の自動チェック

`git commit` のたびに **husky** の pre-commit フック([.husky/pre-commit](../.husky/pre-commit))が
`npm run check` を走らせ、通らなければコミットを止める。5 秒ほどかかる。

- `npm install` で自動的に有効になる(`prepare` で `husky` が `core.hooksPath` を設定する)
- 急ぎで飛ばしたいときは `git commit --no-verify`(または環境変数 `HUSKY=0`)
- 整形だけで落ちたなら `npm run format` で直る
- 見るのは作業ツリー全体。一部だけステージしてコミットしても、ステージしていない変更込みで検査される
- VS Code のソース管理画面からのコミットで `npm` が見つからない場合に備えて、フックは nvm を読み込み直す

## 3. WSL で開発するときの注意

### キーボードが見えない

WSL2 には USB ホストコントローラが無く、`/dev/hidraw*` も作られない。WebHID は Linux では
`/dev/hidraw*` を見るので、**WSL で起動するとデバイス選択に何も出ない**。アプリの不具合ではない。

- 画面の確認は「モックで試す」で行う
- 実機での確認は `npm run deploy:win` して Windows 側で行う

`usbipd-win` で USB を WSL に引き込めるが、その間キーボードは Windows から使えなくなる。
「Windows で実際に何が入力されているか」を見るアプリなので、その用途では意味がない。

### 日本語が豆腐(□)になる

WSL には CJK フォントが入っていない。Windows のフォントを使わせるのが手軽(sudo 不要):

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

### Electron が起動しない

- `libnss3.so` などが無いと言われる → `sudo apt install -y libnss3 libnspr4 libasound2t64`
- `app` が undefined で落ちる → 環境変数 `ELECTRON_RUN_AS_NODE` が立っている。
  一部のツール(Claude Code など)の中から実行すると付いていることがある。`env -u ELECTRON_RUN_AS_NODE npm run dev`

## 4. テスト

```
tests/
  decode / labels / kle / layoutOptions / encoderStrip   純粋ロジック
  layerState                                             レイヤー判定(HANDOFF §6)
  vial                                                   プロトコル(モック相手)と応答の照合
  keyboardSession                                        接続のライフサイクル
  keyboardView.test.tsx                                  SVG の描画(react-dom/server で静的に)
  settings                                               設定の検証、画面外の復帰
  main/                                                  main プロセス(electron をモック)
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

### 自動テストで確かめていないこと

実機・実ウィンドウ・見た目は Windows で手で確かめる:

1. 接続 → アンロック → キーを押すと光る
2. Space / BS / Del / `` ` `` の長押しで L2 / L1 / L3 / L4 に切り替わり、離すと戻る
3. `Ctrl+Alt+K` でオーバーレイ。クリックが下に抜ける。操作パネルの移動・濃さ・リサイズ・
   通常に戻すが効く
4. Vial でキーマップを変えてからこのアプリに戻ると反映される
5. JIS / US の切り替え

## 5. Windows に置く

```bash
npm run deploy:win
```

`dist/win32-x64/` を作り、Windows のデスクトップの `LiveKeymapViewer/` に置く。
別の場所なら `npm run deploy:win -- --dest /mnt/c/Tools/LiveKeymapViewer`。

- **アプリが起動中なら、何もせずに止まる。** 閉じてからやり直す。勝手に終了させることはしない
- 隣に `.new` として完全にコピーしてから名前の付け替えで差し替えるので、途中で失敗しても
  元のフォルダは壊れない

**exe 単体では動かない。** Electron の exe は同じフォルダの `icudtl.dat` / `*.pak` / `*.dll` /
`locales/` / `resources/app/` を読む。exe だけを持っていくと起動時に
`Invalid file descriptor to ICU data received.` で落ちる。

インストーラーは作っていない(HANDOFF §2 で配布は後回し)。wine を使わずに済むよう、
公式の win32 zip を展開して `out/` を置くだけにしてある(理由は ARCHITECTURE.md §6)。

## 6. よくある変更

### 文字の表示を変える・足す

[`keycodes/labels.ts`](../src/renderer/src/keycodes/labels.ts) の表を直す。

- `JIS_PRINTABLE` / `US_PRINTABLE` … 印字キーの `[通常, Shift]`
- `NAMED` … それ以外のキーの表示名と補足。US だけ変えるなら `us: { main, sub }`

`tests/labels.test.ts` にケースを足す。ベースレイヤーは `reference/keymap-preview.html` の
L0 と一致することを確かめるテストがある。

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

モックで確かめたいときは、`.vil` と定義 JSON を `reference/` に置き、
[`scripts/gen-mock.py`](../scripts/gen-mock.py) 冒頭のパスを差し替えて生成し直す。
定義 JSON をファームから取り出す手順は [reference/README.md](../reference/README.md)。

### renderer ⇄ main のやり取りを足す

1. [`shared/ipc.ts`](../src/shared/ipc.ts) の `IPC` にチャネル名、`RendererApi` に関数を足す
2. [`preload/index.ts`](../src/preload/index.ts) で実装する
3. [`main/ipc.ts`](../src/main/ipc.ts) で受ける。**renderer から来た値は型と範囲を確かめてから使う**
4. `tests/main/main.test.ts` にテスト

### 設定項目を足す

[`shared/settings.ts`](../src/shared/settings.ts) の `Settings`・`DEFAULT_SETTINGS`・
`sanitizeSettings` の 3 か所。壊れた値が来たら既定値に戻すこと。`tests/settings.test.ts` にテスト。

### 生成ファイルを作り直す

`*.generated.ts` は手で直さない。

```bash
python3 scripts/gen-keycodes.py   # vial-gui の keycodes_v6.py → keycodes/table.generated.ts
python3 scripts/gen-mock.py       # .vil + 定義 JSON → mock/cornix.generated.ts
```

`gen-keycodes.py` は vial-gui の `main` ブランチから取ってくるので、ネットワークが要る。

## 7. 決まりごと

- **`npm run check` が通らないものはコミットしない。** pre-commit フックが止めるので、`--no-verify` で逃げない
- コミットは小さく。リポジトリはローカルのみ(リモートは無い)
- コメントは日本語で、**何をしているかより、なぜそうしているか**を書く
- 依存は増やしすぎない(HANDOFF §2「最小限・保守しやすい構成」)
- Windows 側で動いているアプリを勝手に終了させない
