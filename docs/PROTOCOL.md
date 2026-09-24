# Vial / VIAプロトコル — 一次ソースで確認したメモ

アプリが使うVial / VIAのコマンドと、そのバイト並びを、次の一次ソースで確認した結果。

| ソース | 参照した版 |
|---|---|
| `vial-kb/vial-qmk` | ブランチ`vial` / `quantum/via.c`、`quantum/vial.c`、`quantum/vial.h` |
| `vial-kb/vial-gui` | ブランチ`main` / `src/main/python/**` |
| Cornix LPのファーム | `jezailfunder/cornix-lp` V1.12(`cornix-left.uf2`)から定義ブロックを取り出して確認 |

> **実機のCornix LPのファームは、vial-qmkではなくRMK(v0.8.x)。**
> この文書はvial-qmk / vial-guiで確認した内容で、USBでの動作は一致している(アプリは動いている)が、
> アンロックの細部やUSB / BLEの扱いはRMK独自。違いは§11と[BLUETOOTH.md](BLUETOOTH.md) §2にある。

---

## 1. トランスポート

- raw HID、`usagePage = 0xFF60` / `usage = 0x61`(`vial-gui/util.py: is_rawhid`)。
- パケットは**32バイト固定**(`VIAL_RAW_EPSIZE`)。`vial.c: vial_handle_cmd`は、`length != VIAL_RAW_EPSIZE`なら即returnする。
- ファームは**受け取ったバッファを書き換えて、同じ32バイトを返す**(`via.c`冒頭のコメント: "raw_hid_send() is called at the end, with the same buffer")。
  つまりレスポンスのバイト位置は、リクエストのバイト位置と同じ数え方になる。
- `via.c:212`で`command_id = &data[0]`、`command_data = &data[1]`。
  **VIAコマンドの戻り値は`data[1]`以降**、**Vialコマンド(`0xFE`)の戻り値は`data[0]`以降**(`vial.c`は`msg[0]`から上書きする)。この非対称は実装でまちがえやすい。
- hidapi(vial-gui)は、書き込み時に先頭へレポートID `0x00`を足す。WebHIDでは`sendReport(0x00, data32)`が同じ意味になる。

## 2. VIAコマンド

| 用途 | リクエスト | レスポンス | 根拠 |
|---|---|---|---|
| VIAプロトコルの版 | `[0x01]` | `data[1..2]` = **big-endian u16** | `via.c:227-231`、`keyboard_comm.py:107-109` |
| レイヤー数 | `[0x11]` | `data[1]` | `via.c:416-419`、`keyboard_comm.py:104` |
| キーマップのバッファ | `[0x12, off_hi, off_lo, size]`(`>BHB`、size ≤ 28) | `data[4 : 4+size]` | `via.c:420-426`、`keyboard_comm.py:205-206` |
| レイアウトオプション | `[0x02, 0x02]` | `data[2..5]` = big-endian u32 | `keyboard_comm.py:228-230` |
| matrix state | `[0x02, 0x03]` | `data[2..]` | `via.c:250-273`、`matrix_test.py:107-125` |

- キーマップ全体の大きさは`layers * rows * cols * 2`バイト。1つのキーコードは**big-endian u16**(`keyboard_comm.py:216`の`>H`)。
- 1リクエストあたりの転送量は`BUFFER_FETCH_CHUNK = 28`(`protocol/constants.py`)。

### matrix stateのデコード

```
row_size   = ceil(cols / 8)
row_bytes  = data[2 + row*row_size : 2 + (row+1)*row_size]
col_byte   = row_size - 1 - floor(col / 8)     # 行の中はMSBのバイトが先頭
pressed    = (row_bytes[col_byte] >> (col % 8)) & 1
```

`via.c:257-271`が行の値を`(value>>24), (value>>16), (value>>8), value`の順(MSBが先)で詰めるため、
`matrix_test.py:117`の`col_byte = len(row_data) - 1 - floor(col/8)`と一致する。

**前提条件が2つある**:

1. `via.c:251-255` — `vial_unlocked`でなければmatrix stateは返らない(キーロガー対策)。
2. `matrix_test.py:60-64` — vial-guiは`vial_protocol >= 3`かつ`(cols // 8 + 1) * rows <= 28`のときだけこの機能を出す。
   Cornix LPは8行7列なので、`(7//8 + 1) * 8 = 8 ≤ 28`で条件を満たす。

さらに`via.c:215-224`により、**アンロックの進行中は`0xFE`系の一部のコマンドしか通らない**。
そのあいだはmatrix stateもkeymapも取れないので、ポーリングを止める必要がある。

### 応答の取り違え

raw HIDの入力レポートは、**そのHIDを開いているすべてのプロセスに配られる**。
VialやPipetteを同時に開いていると、そちら宛ての応答もこちらに届く。
VIAコマンドはファームが`data[0]`にコマンドIDを残す(`via.c:213`が
`command_data = &data[1]`以降にしか書かない)ので、それで自分宛てかを判定できる。
`0x12`(keymapのバッファ)はオフセットと大きさもそのまま返るので、より厳密に照合できる。

Vialコマンド(`0xFE`)は`msg[0]`から上書きするため照合できない。ただし`0xFE`系は
読み込みのときにしか使わず、ポーリングには出てこない。

## 3. Vialコマンド(`0xFE`で始まる)

`vial.c:84`で`msg[1]`がサブコマンド。レスポンスは`msg[0]`から。

| 用途 | リクエスト | レスポンス | 根拠 |
|---|---|---|---|
| キーボードID | `[0xFE, 0x00]` | `data[0..3]` = vial_protocol(u32 **LE**)、`data[4..11]` = uid(8バイト)、`data[12]` = VialRGBのフラグ | `vial.c:91-104`、`keyboard_comm.py:125-126` |
| 定義の大きさ | `[0xFE, 0x01]` | `data[0..3]` = u32 LE | `vial.c:106-113` |
| 定義ブロック | `[0xFE, 0x02, block_lo, block_hi]` | 32バイトの生データ | `vial.c:115-126` |
| アンロックの状態 | `[0xFE, 0x05]` | `data[0]`=unlocked、`data[1]`=in_progress、`data[2+2i]`/`data[3+2i]` = アンロックキーの(row, col)最大15組、未使用は`0xFF` | `vial.c:143-159`、`keyboard_comm.py:469-483` |
| アンロックの開始 | `[0xFE, 0x06]` | — | `vial.c:160-165` |
| アンロックのポーリング | `[0xFE, 0x07]` | `data[0]`=unlocked、`data[1]`=in_progress、`data[2]`=counter | `vial.c:166-189` |
| ロック | `[0xFE, 0x08]` | — | `vial.c:190-196` |
| dynamic entryの数 | `[0xFE, 0x0D, 0x00]` | `data[0]`=TDの数、`[1]`=Comboの数、`[2]`=KeyOverrideの数、`[3]`=AltRepeatの数、`data[31]`=機能のビット | `vial.c:228-245` |
| Tap Danceの取得 | `[0xFE, 0x0D, 0x01, idx]` | `data[0]`=status(0が成功)、`data[1..10]` = u16 **LE** ×5 = on_tap、on_hold、on_double_tap、on_tap_hold、tapping_term | `vial.c:247-254`、`vial.h:99-100`、`tap_dance.py:16-17` |

### アンロックの動き

`vial.c:29,166-189`:

- `vial_unlock_start`でカウンタを`VIAL_UNLOCK_COUNTER_MAX = 50`にする。
- `vial_unlock_poll`のたびに、**アンロックキーを全部押していて**、かつ前回から100ms以上経っていればカウンタを1減らす。
  離すと50に戻る。0になったらアンロック完了。
- したがって、最短でも約5秒の長押しが要る。vial-guiは200ms間隔でポーリングしている(`unlocker.py:104`)。
- 進み具合のバーは`max - counter`で描ける(`unlocker.py:69-72`)。

### 定義ブロックの取り込み

`keyboard_comm.py:133-142`:

```python
while sz > 0:
    data = usb_send(pack("<BBI", 0xFE, 0x02, block))   # ブロック番号はu32 LEで送る
    if sz < 32: data = data[:sz]                        # 最後のブロックは余りを切り捨て
    payload += data; block += 1; sz -= 32
payload = json.loads(lzma.decompress(payload))
```

**圧縮形式**: Cornix LP V1.12のファームから定義ブロックを実際に取り出したところ、
先頭が`FD 37 7A 58 5A 00`で**XZコンテナ**だった(LZMA-aloneではない)。
Pythonの`lzma.decompress`は両方を自動で判別するので、vial-guiのコードからはどちらか分からないが、
JSの側ではXZのデコーダが要る。このアプリは`xz-decompress`(WASM。ネイティブのビルドは無い)を使い、
`5D`で始まるLZMA-aloneが来たときは、それと分かるエラーにしてある。

なお`vial.c:117`は`page = msg[2] + (msg[3] << 8)`と、**2バイトしか読んでいない**。
vial-guiがu32 LEで送っていても、上位2バイトは常に0なので実害は無い。

## 4. 定義JSON

Cornix LP V1.12から取り出した構造(`reference/cornix-vial-definition.json`に置いてある。モックは
`scripts/gen-mock.py`でこれをXZに固めて、`src/renderer/src/mock/cornix.generated.ts`に埋め込む):

```jsonc
{
  "name": "HID Keyboard", "vendorId": "0xE118", "productId": "0x0001",
  "lighting": "none",
  "matrix": { "rows": 8, "cols": 7 },
  "customKeycodes": [ { "name": "BT0", "title": "...", "shortName": "BT0" }, ... 8 個 ],
  "layouts": { "labels": [["Firmware Version", "V1.12"]], "keymap": [ /* KLE */ ] }
}
```

**`customKeycodes[n]`は`USER{n:02}` = `0x7E00 + n`に対応する**(`keycodes_v6.py:568,608` / `keycodes.py:833-843`)。
Cornixでは`customKeycodes[0] = BT0`で、`USER00` = `BT0`になることも確認した。

### KLEの解釈(`kle_serial.py`)

- ラベルは`"\n"`区切りで最大12個。`align`(`{"a": n}`、既定は4)に応じて`labelMap`で並べ替える。
- 並べ替えた**後**の意味づけ(`keyboard_comm.py:160-194`):
  - `labels[0]` … `"row,col"`(通常のキー)または`"encoder_idx,direction"`(エンコーダー)
  - `labels[4] === "e"` … エンコーダー。Cornixでは`"0,0\n\n\n\n\n\n\n\n\ne"`の形で入っている
  - `labels[8]` … `"layout_index,layout_option"`
- `{"r": deg}` / `{"rx": x}` / `{"ry": y}`は**行の先頭のキーでしか指定できない**(それ以外はエラー)。
  `rx` / `ry`はクラスタの原点をリセットする(`current.x = cluster.x`など)。回転は`(rx, ry)`を中心に`r`度。
- 行の終わりで`current.y += 1`、`current.x = current.rotation_x`。

Cornixの親指キーは`{"r": 11.93, "rx": 5, "ry": 4.75}` / `{"r": 23}` / `{"r": -23}` / `{"r": -11.93, "rx": 9.25}`で回っている。

## 5. キーコード(Vial protocol 6)

`keycodes_v6.py`の定数。構造で解釈する範囲:

| 範囲 | 意味 |
|---|---|
| `0x0000` / `0x0001` | `KC_NO` / `KC_TRNS` |
| `0x0002`–`0x00FF` | 基本のキー(HID usage)。JIS関連は`0x87`=`KC_RO`、`0x89`=`KC_JYEN`、`0x90`=`KC_LANG1`、`0x91`=`KC_LANG2` |
| `0x0100`–`0x1FFF` | モディファイア付き。`mods = (code >> 8) & 0x1F`、`0x10`のビットが立っていれば右 |
| `0x2000`–`0x3FFF` | Mod-Tap(`QK_MOD_TAP`)。modsと内側のキーの取り方は上と同じ |
| `0x4000`–`0x4FFF` | `LT(layer, kc)`: `layer = (code >> 8) & 0xF`(レイヤーは0–15) |
| `0x5000`–`0x51FF` | `LM(layer, mod)`: `QK_LAYER_MOD`。`layer = (code >> 5) & 0xF`、`mod = code & 0x1F` |
| `0x5200`–`0x521F` | `TO(n)` |
| `0x5220`–`0x523F` | `MO(n)` |
| `0x5240`–`0x525F` | `DF(n)` |
| `0x5260`–`0x527F` | `TG(n)` |
| `0x5280`–`0x529F` | `OSL(n)` |
| `0x52A0`–`0x52BF` | `OSM(mod)` |
| `0x52C0`–`0x52DF` | `TT(n)` |
| `0x52E0`–`0x52FF` | `PDF(n)`(Persistent Default Layer) |
| `0x5700`–`0x57FF` | `TD(n)` |
| `0x7700`–`0x77FF` | `M(n)`(マクロ) |
| `0x7E00`–`0x7E3F` | `USER00`–`USER63` = `customKeycodes[n]` |

それ以外(MAGIC `0x7000`〜、MIDI `0x7100`〜、Audio `0x7480`〜、Backlight/RGB `0x7800`〜、`QK_BOOT` `0x7C00`〜 ほか)は
名前の表で引く。表は`keycodes_v6.py`から機械的に生成して、`src/renderer/src/keycodes/table.generated.ts`に置いた。

対応する版: `keyboard_comm.py:27-28`は`via_protocol == 9`、`vial_protocol ∈ 0..6`を受け付ける。
このアプリは**vial_protocol 6 / via_protocol 9だけ**を対象とし、ほかはエラーを表示する。

## 6. エンコーダーの回転は取得できない

`vial_get_encoder`(`[0xFE, 0x03, layer, idx]`)で取れるのは、そのエンコーダーの
**各方向に割り当てられたキーコード**であって、回されたという事実ではない(`vial.c:130-139`)。

状態を返すコマンドは`id_get_keyboard_value`の3つだけで、

- `id_uptime`
- `id_layout_options`
- `id_switch_matrix_state`

回転に当たるものは無い(`via.c:232-274`)。しかも`id_switch_matrix_state`が読むのは
`matrix_get_row()`だけ(`via.c:260`)。QMKのエンコーダーはmatrixのスキャンとは別の系統で
読まれ、matrixのビットには現れない。

したがって、**回転はこのプロトコルでは観測できない**。ファームに独自のraw HIDコマンドを
足してエンコーダーのイベントを返させない限り、ホスト側でできることは無い。

一方、**ノブの押し込みはmatrixに出る**。多くのキーボードでは、エンコーダーのスイッチが
通常のキーとして配線されているため。Cornix LPでは左が`2,6`(`KC_MUTE`)、
右が`5,6`(`KC_BTN3`)。

## 7. リクエストの直列化

ファームは1つのリクエストにつき1つのレスポンスを返すだけで、**リクエストとレスポンスを対応づけるIDが無い**。
したがってホスト側でキューを持ち、前のレスポンスが来るまで次を送らない、という直列化が欠かせない。
matrix stateのポーリング(20ms間隔)とキーマップの読み出しを並行して送ると、取り違えが起きる。
このアプリでは`src/renderer/src/hid/transport.ts`の`WebHidTransport`が、1本のキューで全リクエストを
直列化する。ポーリングとキーマップの読み直しは同じキューに並ぶので、読み直しのあいだはmatrixの間隔が
延びるだけで、取り違えは起きない。

## 8. ポーリングの間隔

- matrix state: vial-guiは20ms(`matrix_test.py:152`)。このアプリも20ms。
- アンロックのポーリング: 200ms(`unlocker.py:104`)。

## 9. ライセンス

vial-gui / vial-qmkはどちらも**GPL-2.0-or-later**。このリポジトリのコードは、
仕様(バイト列の並び・定数の値)を参照して**独自にTypeScriptで書き起こした**もので、
GPLのコードを複製・翻案してはいない。`table.generated.ts`は`keycodes_v6.py`の
**数値定数**(事実のデータ)を抜き出したもの。Pipette(`darakuneko/pipette-desktop`)のコードは参照していない。

## 10. 間違えやすいところ

| # | 項目 | 確認した結果 |
|---|---|---|
| 1 | customKeycodesの開始値 | **`0x7E00`**。`QK_KB = 0x7E00`、`USER{x} = QK_KB + x`(xは0–63)。`0x7E40`ではない |
| 2 | 定義ブロックの圧縮形式 | Cornix LP V1.12は**XZ**(`FD 37 7A 58 5A 00`)。LZMA-aloneが来たときは、それと分かるエラーにする |
| 3 | エンコーダーの印 | 正確には、**並べ替えた後の`labels[4] === "e"`**。このとき`labels[0]`は`"idx,dir"`になる |
| 4 | 定義ブロックの番号 | 送るのはu32 LEだが、ファームは**下位2バイトしか読まない** |
| 5 | レイヤー系のキーコードの範囲 | `0x5200`〜のTO / MO / DF / TG / OSL / OSM / TTに加えて、**`PDF(n)`(`0x52E0`〜)がある**。また`0x4000`–`0x4FFF`と`0x5200`のあいだに、**`LM()`(`0x5000`–`0x51FF`)がある** |
| 6 | matrix stateとアンロック | Vialのアンロックが要る。加えて、**アンロックの進行中はVIAコマンドが一切通らない**(`via.c:215-224`)ので、そのあいだはポーリングを止める |
| 7 | matrix stateの前提 | vial-guiは`(cols // 8 + 1) * rows <= 28`と`vial_protocol >= 3`を条件にしている |
| 8 | Tap Danceのレスポンス | `status` + u16 LE ×5。`status != 0`はエラー |

## 11. 実機のファームはRMK

Cornix LP V1.12のファームに埋め込まれたソースパス(`.../rmk/src/host/via/vial.rs`など)と
依存の版から、**RMK v0.8.1〜v0.8.3**(`rmk-rs/rmk`)で作られていると分かった。
調べた内容と行番号は[BLUETOOTH.md](BLUETOOTH.md) §2にある。要点:

| 項目 | vial-qmk(この文書の§1〜§9) | RMK v0.8.3 |
|---|---|---|
| matrix state | `data[2..]`、行ごとにMSBのバイトが先 | 同じ(USBで動作を確認済み) |
| アンロックのカウンタ | 50から100msごとに1減る | **まだ押されていないアンロックキーの数**。全部押した瞬間に解除 |
| アンロック進行中の状態 | ファームにタイムアウトが無い | 最後のポーリングから100msで解ける |
| アンロック中のVIAコマンド | 通さない | 止める処理は見当たらない |
| USBとBLE | (BLEは無い) | **どちらか一方しか動かさない**。BLE側にも同じ形(レポートID無し・32バイト)のVialがある |

この文書の§1〜§9を読むときは、「vial-qmkではこうなっている」と読み替えること。
アプリは両方で動くように作る(例: アンロックの進み具合は、見たカウンタの最大値を最大にする。BLUETOOTH.md P5)。
