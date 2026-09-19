# Live Keymap Viewer

Vial キーボード(まずは Cornix LP)の **押しているキー** と **いまのレイヤー** を、
リアルタイムに表示するデスクトップアプリ。

キーマップ・レイヤー・物理配置はすべてキーボードから読み取る。アプリ側に固定データは持たない。

- Windows を日本語(JIS)キーボード設定のまま使っている前提で、**実際に入力される文字**を出す
  (Vial / Pipette は US 配列前提の表示なので、JIS だとずれる)
- 通常ウィンドウと、常に最前面のクリック透過オーバーレイを切り替えられる

仕様は [HANDOFF.md](HANDOFF.md)、プロトコルの確認結果は [docs/PROTOCOL.md](docs/PROTOCOL.md)。

---

## 動かす

```bash
npm install
npm run dev      # 開発
npm run build    # 型チェック + ビルド
npm start        # ビルド済みのものを起動
npm test         # 単体テスト (vitest)
```

> **Linux / WSL で動かす場合**
>
> 画面のラベルは日本語を含む(かな / 英数 / 消音 / 長押し→L2 …)。
> CJK を持つフォントが 1 つも入っていないと、そこが豆腐(□)になる。
>
> ```bash
> sudo apt install -y fonts-noto-cjk
> ```
>
> WSL なら、Windows 側のフォントを使うほうが早い(sudo も不要):
>
> ```bash
> mkdir -p ~/.config/fontconfig
> cat > ~/.config/fontconfig/fonts.conf <<'XML'
> <?xml version="1.0"?>
> <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
> <fontconfig><dir>/mnt/c/Windows/Fonts</dir></fontconfig>
> XML
> fc-cache -f
> ```
>
> Electron 自体も Chromium のランタイムを要求する:
> `sudo apt install -y libnss3 libnspr4 libasound2t64`。
> 本来の対象である Windows では、どちらも既定で揃っている。

実機が無くても、画面右上の **「モックで試す」** で動きを確かめられる。
モックは `reference/Cornix_設定_LT.vil` のキーマップと、Cornix LP V1.12 のファームから
取り出した本物の定義 JSON(XZ 圧縮のまま)を返す。

## Windows 用の exe を作る

```bash
npm run package:win           # x64
npm run package:win -- arm64  # arm64
```

`dist/win32-x64/` ができる。**フォルダごと** Windows 側にコピーして、その中の
`LiveKeymapViewer.exe` を実行する:

```bash
cp -r dist/win32-x64 /mnt/c/Users/$USER/Desktop/LiveKeymapViewer
```

> **exe 単体をコピーしても動かない。** Electron の exe は、同じフォルダにある
> `icudtl.dat` / `resources.pak` / `*.dll` / `locales/` / `resources/app/` を読む。
> exe だけを持っていくと、起動時に
> `ERROR:base\i18n\icu_util.cc:237 Invalid file descriptor to ICU data received.`
> で落ちる。これは Electron に限らず Chromium 系アプリ共通の構成。

インストーラーは作らない(HANDOFF §2 で配布は後回しと決めた)。ポータブルな一式がそのまま動く。
単一 exe にまとめたい場合は electron-builder の `portable` ターゲットがあるが、
NSIS を使うので Linux からだと wine が要る。

この方式にした理由は [scripts/package-win.mjs](scripts/package-win.mjs) の先頭にも書いてあるが、
要点は **wine を使わずに済む**こと。electron-builder や @electron/packager は exe に
アイコンとバージョン情報を書き込むため rcedit(Windows バイナリ)を呼ぶので、
Linux からだと wine が要る。このアプリは

- ネイティブモジュールを使っていない(HID は renderer の WebHID)
- main / preload は `electron` と node 標準しか import していない
- xz の WASM は renderer のバンドルに埋め込まれている

ので、公式の win32 zip に `out/` を置いて `electron.exe` をリネームするだけで動く。
アイコンや署名が要るようになったら、そのとき electron-builder を入れる。

## 使い方

1. **接続** — 「キーボードに接続」で Vial の raw HID インターフェース
   (usagePage `0xFF60` / usage `0x61`)を選ぶ。一度許可したデバイスには次回から自動で繋がる。
2. **アンロック** — 押下状態(matrix state)の読み取りには Vial のアンロックが要る。
   ロック中は画面上部に案内が出て、押すべきキーが図の上で色付きになる。
   「アンロックを始める」を押し、そのキーを 5 秒ほど押し続ける。
3. **表示** — 20ms ごとに matrix を読み、押しているキーを光らせる。
   レイヤーは押下状態から計算して出す。
4. **切り替え** — `Ctrl+Alt+K` で通常ウィンドウ ⇄ オーバーレイ。
   **オーバーレイ中はクリックが透過するので、戻すのはこのショートカットだけ。**
   サイズと位置の調整は通常ウィンドウで行う(Windows では透明ウィンドウをリサイズできないことがある)。
5. **JIS / US** — ツールバーのトグルで、ラベルを JIS の実出力と US 表記で切り替える。

## 構成

```
src/main/          ウィンドウ、モード切替、HID 許可、グローバルショートカット、設定
src/preload/       contextBridge の最小 API
src/shared/        main / preload / renderer で共有する型
src/renderer/src/
  hid/             transport(WebHID / モック)、vial(プロトコル)、xz(定義の展開)
  keycodes/        decode(u16 → 構造体)、labels(JIS / US)、table.generated
  layout/          kle(KLE パース)、geometry(物理配置)、layoutOptions
  engine/          layerState(押下 → アクティブレイヤー)
  components/      KeyboardView(SVG)、KeyCap、Toolbar、UnlockPanel、DevicePicker
  mock/            cornix.generated(モックのデータ)
scripts/           vial-gui / .vil から生成物を作り直すスクリプト
tests/             vitest
```

### 設計で効いている点

- **HID は renderer の WebHID で扱う**。node-hid のネイティブビルドを避けるため。
  main 側は `select-hid-device` と `setDevicePermissionHandler` で許可を保持するだけ。
- **リクエストは 1 本のキューで直列化する**。ファームはリクエストとレスポンスを
  対応づける ID を持たないので、matrix ポーリングと読み出しが並走すると取り違える。
- **transport はインターフェース**。`MockTransport` が同じ口を実装しているので、
  実機なしで UI も単体テストも回せる。
- **透明ウィンドウは後から切り替えられない**ので、モード切替ではウィンドウを作り直し、
  位置とサイズを引き継ぐ。

### 生成ファイルの作り直し

```bash
python3 scripts/gen-keycodes.py   # vial-gui の keycodes_v6.py → キーコード表
python3 scripts/gen-mock.py       # .vil + 定義 JSON → モックのデータ
```

## 対応範囲

- Vial protocol **6** / VIA protocol **9** のみ。それ以外はエラーを出す。
- matrix state は `vial_protocol >= 3` かつ `(cols / 8 + 1) * rows <= 28` のときだけ読める
  (Cornix LP は 8 行 7 列なので OK)。

### まだ入っていないもの(HANDOFF §3「MVP の対象外」)

- エンコーダーの割り当て表示(位置だけ描いている)
- Combo / Key Override / One Shot / TT の厳密な再現
- 他キーボード向けの汎用化、インストーラーの配布
- BT で matrix が取れなかった場合の、キー入力からの推測表示

## WSL では実機に繋がらない

WSL2 には USB ホストコントローラが無く、`/sys/bus/usb/devices/` は空、`/dev/hidraw*` も作られない。
Chromium の WebHID は Linux では `/dev/hidraw*` を見るので、WSL 上で動かすと
**デバイス選択に何も出ない**。アプリ側の問題ではない。

実機で試すときは `npm run package:win` で作った exe を **Windows 側で実行する**こと。

> `usbipd-win` を使えば WSL に USB デバイスを引き込めるが、その間そのキーボードは
> **Windows からは使えなくなる**。「Windows で実際に何が入力されているか」を見るのが
> このアプリの目的なので、その用途では意味がない。

## 接続の確認状況

| 接続 | 状態 |
|---|---|
| USB | **未確認**(Windows 側の exe で要確認。WSL からは上記の理由で繋がらない) |
| Bluetooth | **未確認**(Windows 側の exe で要確認) |

> この実装は Linux (WSL2) 上で、モックデバイスに対してのみ検証してある。
> プロトコルのバイト並びは vial-qmk / vial-gui の一次ソースと突き合わせ済み
> ([docs/PROTOCOL.md](docs/PROTOCOL.md))だが、**実機での USB / BT 接続はまだ試していない**。
> Windows の実機で確認したら、この表を埋めること。特に Bluetooth では、
> matrix state が返るか(ファームが `VIAL_ENABLE` 付きで raw HID を BT 側にも出しているか)
> を最初に見る。取れない場合の代替は HANDOFF §3 の「MVP の対象外」にある。

## ライセンスについて

プロトコルの仕様は `vial-kb/vial-gui` と `vial-kb/vial-qmk`(どちらも GPL-2.0-or-later)を
読んで確認したが、コードは独自に TypeScript で書き起こしている。
`src/renderer/src/keycodes/table.generated.ts` は `keycodes_v6.py` の数値定数を抽出したもの。
詳細は [docs/PROTOCOL.md](docs/PROTOCOL.md) §8。
