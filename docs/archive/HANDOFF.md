# Live Keymap Viewer — 引き継ぎ仕様

> **この文書は当初の引き継ぎ仕様**で、実装前に書かれたもの。実装の現状・変えた点・残っている課題は
> [docs/STATUS.md](../STATUS.md)、プロトコルの確認結果は [docs/PROTOCOL.md](../PROTOCOL.md) を参照。

Vialキーボード(まずは Cornix LP)の **押しているキー** と **今のレイヤー** を、リアルタイムに画面表示するデスクトップアプリ。
キーマップ・レイヤー・物理配置はキーボードから読み取り、固定データを持たない。

---

## 1. 背景

- ユーザーは Windows を日本語(JIS)キーボード設定のまま使い、Cornix LP を Vial / Pipette でカスタムしている。
- JIS 前提でキーコードを置き換えている(例:`KC_QUOTE` → `:`、`KC_LBRACKET` → `@`)。そのため Vial / Pipette の表示(US配列前提)と実際の入力が一致せず、分かりにくい。
- `reference/keymap-preview.html` は、この不一致を解消するために作った **静的な** キーマップ図。キーマップはハードコードしている。今回はこれを **キーボードから読み取って、リアルタイムに動く** アプリにする。

## 2. 決定済みの要件

| 項目 | 決定 |
|---|---|
| 形態 | Electron デスクトップアプリ(Windows がメイン) |
| スタック | TypeScript / React / **Tailwind CSS** / electron-vite(UI ライブラリは使わず Tailwind で組む。キーボード描画は SVG) |
| 読み取るもの | キーボードの設定(キーマップ全レイヤー、Tap Dance、物理配置の定義、カスタムキーコード名)。**固定データを持たない** |
| 表示モード | **通常ウィンドウ** と **常に最前面の半透明オーバーレイ(クリック透過)** を切り替えられる |
| 文字表示 | **日本語(JIS)モード** と US モードを切り替えられる。JIS モードでは、Windows JIS 環境で実際に入力される文字を表示する |
| 接続 | USB と Bluetooth の両方を想定。ユーザーによると、BT でも Vial で読み取れる。最初に実機で両方を確認すること |
| 範囲 | **まず動く最小版(MVP)**。他キーボード向けの汎用化や配布(インストーラー)は後回し |
| 設定方針 | 最小限・保守しやすい構成を好む。複雑な仕組みは避ける |

## 3. MVP の機能

1. **接続**:Vial デバイス(raw HID: usagePage `0xFF60`, usage `0x61`)を選んで接続する。以前許可したデバイスには自動で再接続する。
2. **読み取り**:定義(物理配置 KLE + matrix サイズ + customKeycodes)、レイヤー数、全レイヤーのキーマップ、Tap Dance を読み取る。
3. **アンロック**:matrix state の取得には Vial のアンロックが必要。ロック中は、押すべきキー(unlock keys)を図の上で示してアンロックを進める。
4. **押下表示**:matrix state を 15〜20ms 程度でポーリングし、押している物理キーをハイライトする。
5. **レイヤー判定**:押下状態とキーマップから、アクティブなレイヤーをアプリ側で計算して表示する(§6)。
6. **ラベル表示**:キーコードを JIS / US の実際の入力文字に変換する。Shift 時の文字も併記する。透過キーは下のレイヤーの値を薄く表示する。
7. **モード切替**:ボタンとグローバルショートカット(例:`Ctrl+Alt+K`)で、通常ウィンドウとオーバーレイを切り替える。オーバーレイ中はクリックが透過するので、戻すのはショートカットで行う。

### MVP の対象外(後で検討)

- エンコーダーの表示
- Combo / Key Override / One Shot / TT などの厳密な再現
- 汎用化、配布
- BT でも matrix が取れなかった場合の、キー入力からの推測表示(フォールバック)

## 4. 設計の要点

- **HID は renderer の WebHID で扱う**(node-hid のネイティブビルドを避けるため)。main 側では次を設定する。
  - `session.on('select-hid-device')`:デバイス選択の処理
  - `setPermissionCheckHandler` / `setDevicePermissionHandler`:許可の保持
- **リクエスト/レスポンス**:32 バイト固定、report ID 0。1 リクエストに 1 レスポンスを返すキューで直列化する。matrix ポーリングとの競合に注意すること。
- **ウィンドウ**:透明ウィンドウは作成後に切り替えられないので、モード切替時にウィンドウを作り直す。サイズと位置は引き継ぐ。renderer は起動時に `navigator.hid.getDevices()` で自動再接続する。
  - 透明ウィンドウは Windows でリサイズできないことがある。サイズ調整は通常モードで行う想定。
- **モックデバイス**:実機がなくても開発・テストできるように、transport をインターフェース化しておく。`reference/Cornix_設定_LT.vil` のキーマップを返すモックを用意すると、UI 確認と単体テストに使える。

推奨ディレクトリ構成:

```
src/main/index.ts          ウィンドウ、モード切替、HID許可、グローバルショートカット、設定の保存(userData の JSON)
src/preload/index.ts       最小限の IPC API
src/renderer/hid/          transport.ts(WebHID/モック)、vial.ts(プロトコル)
src/renderer/keycodes/     decode.ts(u16→構造体)、labels.ts(JIS/US 表示)
src/renderer/layout/       kle.ts(定義の KLE → キーの座標・回転・matrix 位置)
src/renderer/engine/       layerState.ts(押下 → アクティブレイヤー)
src/renderer/components/   KeyboardView(SVG)、Toolbar、UnlockPanel など
```

## 5. Vial / VIA プロトコルの要点

> ⚠ 以下はメモとして書いたもの。**実装前に必ず一次ソースで確認すること**:
> `vial-kb/vial-gui` の `src/main/python/protocol/*.py`、`keycodes/keycodes_v6.py`、`widgets/matrix_test.py`、
> および `vial-kb/vial-qmk` の `quantum/vial.c` と `quantum/via.c`。
> 既存の TS 実装として `darakuneko/pipette-desktop`(Electron 製の Vial エディタ)も参考になる。**ライセンスを確認のうえ**参照すること。

| 用途 | リクエスト | レスポンス |
|---|---|---|
| VIA プロトコルバージョン | `[0x01]` | `[0x01, hi, lo]` |
| レイヤー数 | `[0x11]` | `[0x11, count]` |
| キーマップバッファ | `[0x12, off_hi, off_lo, size≤28]` | `data[4:4+size]`。全体は layers×rows×cols×2 バイト、**big-endian u16** |
| matrix state | `[0x02, 0x03]`(get keyboard value / switch matrix state) | `data[2:]` から、行ごとに `ceil(cols/8)` バイト。`col_byte = row_size-1-floor(col/8)`、`bit = col%8`(vial-gui の matrix_test.py を確認) |
| Vial キーボード ID | `[0xFE, 0x00]` | vial_protocol(u32 LE)+ uid(8 バイト)… |
| 定義サイズ | `[0xFE, 0x01]` | u32 LE |
| 定義本体 | `[0xFE, 0x02, block(u32 LE)]` | 32 バイトずつ。**LZMA 圧縮**。Python の `lzma.decompress` で自動判別しているので、XZ か LZMA-alone かを実データで判定すること |
| アンロック状態 | `[0xFE, 0x05]` | `[unlocked, in_progress, (row,col)×最大15 …(0xFF 終端)]` |
| アンロック開始 / ポーリング | `[0xFE, 0x06]` / `[0xFE, 0x07]` | ポーリング:`[unlocked, in_progress, counter]` |
| 動的エントリ数 | `[0xFE, 0x0D, 0x00]` | TD 数、Combo 数、… |
| Tap Dance 取得 | `[0xFE, 0x0D, 0x01, idx]` | `[status, on_tap, on_hold, on_double_tap, on_tap_hold, tapping_term]`(u16 LE ×5) |

- 定義 JSON:`matrix.rows` / `matrix.cols`、`layouts.keymap`(KLE。各キーの legend 0 が `"row,col"`)、`customKeycodes`(Cornix では BT0 / BT1 / Switch Output などの名前がここにある)。
- KLE は `@ijprest/kle-serial` で解析できる。回転(`r` / `rx` / `ry`)に対応すること(Cornix の親指キーは回転している)。レイアウトオプション(legend 8)と、エンコーダー(legend に `e`)の扱いは vial-gui を参照。
- この環境では Cornix の vial_protocol は 6、via_protocol は 9(.vil より)。**v6 のキーコードだけ対応**すればよく、それ以外のバージョンはエラーを表示する。

### キーコード(QMK v6 系。要確認)

| 範囲 | 意味 |
|---|---|
| `0x0000` / `0x0001` | KC_NO / KC_TRNS |
| `0x0004`〜`0x00FF` | 基本キー(HID usage)。JIS 関連:`0x87` = RO / INT1、`0x89` = JYEN / INT3、`0x90` = LANG1、`0x91` = LANG2 |
| `0x00A5`〜`0x00DF` | システム、メディア、マウスキー(値は要確認) |
| `0x0100`〜`0x1FFF` | モディファイア付き。`LSFT(kc) = 0x0200 \| kc`。右モディファイアは bit `0x1000` |
| `0x2000`〜`0x3FFF` | Mod-Tap |
| `0x4000`〜`0x4FFF` | `LT(layer, kc) = 0x4000 \| layer<<8 \| kc` |
| `0x5200`〜 | TO / MO(`0x5220\|l`)/ DF / TG / OSL / OSM / TT |
| `0x5700`〜`0x57FF` | `TD(n)` |
| `0x7700`〜 | マクロ |
| `0x7E00`〜 | カスタムキーコード(USER00〜)。`customKeycodes[n]` の名前で表示する。**開始値が `0x7E00` か `0x7E40` かは要確認**(Cornix で USER00 = BT0 になれば正しい) |

## 6. レイヤー判定のルール(MVP)

- 押されたキーのキーコードは、**押した瞬間**のレイヤー状態で決まる(QMK と同じ)。キーごとに、押下時点で解決したキーコードを保持しておく。
- `MO(n)`:押している間、レイヤー n を有効にする。
- `LT(n, kc)`、または Tap Dance の on_hold が `MO(n)`:次のどちらかを満たしたらレイヤー n を有効にする。
  - 押し続けた時間が tapping term(既定 200ms。Tap Dance は各エントリの値)を超えた
  - 押している間に他のキーが押された
  - 表示用の近似でよい。Permissive Hold / Chordal Hold / Flow Tap の厳密な再現は不要
- `TG(n)` / `TO(n)`:押した時点でトグルまたは切り替える(最低限)。
- 表示するレイヤーは、有効なレイヤーのうち最も上のもの。各キーのラベルは、透過(KC_TRNS)なら下の有効レイヤーへたどる。
- 押されているレイヤーキー自体は「押下中」として強調する(`reference/keymap-preview.html` と同じ表現)。

## 7. JIS / US のラベル表

`reference/keymap-preview.html` の `JIS` / `NAMED` オブジェクトが、そのまま出発点になる。JIS の主な対応(HID キー → 通常 / Shift):

```
1 1/!  2 2/"  3 3/#  4 4/$  5 5/%  6 6/&  7 7/'  8 8/(  9 9/)  0 0/(なし)
MINUS -/=   EQUAL ^/~   JYEN ¥/|   LBRACKET @/`   RBRACKET [/{
SCOLON ;/+  QUOTE :/*   NONUS_HASH ]/}   COMMA ,/<   DOT ./>   SLASH //?   RO \/_
LANG1 かな   LANG2 英数
```

- `LSFT(x)` は、x の Shift 側の文字を表示する。
- US モードは、通常の US 配列の表記にする。

## 8. 受け入れ基準(MVP)

- [ ] Cornix LP に接続すると、物理配置どおりに全キーが描画される(親指キーの回転を含む)
- [ ] ベースレイヤーのラベルが、JIS モードで `reference/keymap-preview.html` の L0 と一致する
- [ ] キーを押すと、20〜30ms 程度の遅れでハイライトされる
- [ ] Space(`LT(2, Space)`)を長押しすると L2 の表示に切り替わり、離すと戻る。BS → L1、Del → L3、右下の `` ` ``(TD(3))→ L4 も同様
- [ ] ロック中は、アンロック手順が画面上で分かる
- [ ] `Ctrl+Alt+K` で、通常ウィンドウとクリック透過オーバーレイを行き来できる
- [ ] USB 接続で動く。BT 接続で動くかを確認し、結果を README に書く
- [ ] モックデバイスで、キーコードのデコード、ラベル、レイヤー判定の単体テスト(vitest)が通る

## 9. 参考資料

- `reference/Cornix_設定_LT.vil`:現在のキーマップ(Vial エクスポート)。TD(0)〜TD(2) を LT に置き換え済みで、L2 に `|` と `~` を追加している。モックデータとテストの期待値に使う。
- `reference/keymap-preview.html`:静的なキーマップ図。JIS ラベル表、物理配置の近似値、見た目(色分け、透過の表現、長押しの色帯、「押下中」の表現)の参考。
- 既存ツール:Vial(vial.rocks)、Pipette(darakuneko/pipette-desktop)。ユーザーは現在 Vial で設定している。
