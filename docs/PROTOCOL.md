# Vial / VIA プロトコル — 一次ソース確認メモ

`HANDOFF.md` §5 の内容を、以下の一次ソースに当たって検証した結果。

| ソース | 参照した版 |
|---|---|
| `vial-kb/vial-qmk` | ブランチ `vial` / `quantum/via.c`, `quantum/vial.c`, `quantum/vial.h` |
| `vial-kb/vial-gui` | ブランチ `main` / `src/main/python/**` |
| Cornix LP ファームウェア | `jezailfunder/cornix-lp` V1.12 (`cornix-left.uf2`) から定義ブロックを実測 |

結論:**§5 の記述はほぼ正しい**。相違点・補足は「10. HANDOFF §5 との差分」にまとめた。

> **注意(2026-09-21 追記):実機の Cornix LP のファームは vial-qmk ではなく RMK(v0.8.x)だった。**
> この文書は vial-qmk / vial-gui で確かめた内容で、USB での動作は一致している(アプリは動いている)が、
> アンロックの細部や USB / BLE の扱いは RMK 独自。違いは §11 と [BLUETOOTH.md](BLUETOOTH.md) §2 を参照。

---

## 1. トランスポート

- raw HID、`usagePage = 0xFF60` / `usage = 0x61`(`vial-gui/util.py: is_rawhid`)。
- パケットは **固定 32 バイト**(`VIAL_RAW_EPSIZE`)。`vial.c: vial_handle_cmd` は `length != VIAL_RAW_EPSIZE` なら即 return する。
- ファームは**受け取ったバッファを書き換えて同じ 32 バイトを返す**(`via.c` 冒頭コメント: "raw_hid_send() is called at the end, with the same buffer")。
  つまりレスポンスのバイト位置は、リクエストのバイト位置と同じ土俵で数える。
- `via.c:212` で `command_id = &data[0]`、`command_data = &data[1]`。
  **VIA コマンドの戻り値は `data[1]` 以降**、Vial コマンド (`0xFE`) の戻り値は **`data[0]` 以降**(`vial.c` は `msg[0]` から上書きする)。この非対称は実装時にハマりやすい。
- hidapi (vial-gui) は書き込み時に先頭へ report ID `0x00` を足す。WebHID では `sendReport(0x00, data32)` が同じ意味になる。

## 2. VIA コマンド

| 用途 | リクエスト | レスポンス | 根拠 |
|---|---|---|---|
| VIA プロトコル版 | `[0x01]` | `data[1..2]` = **big-endian u16** | `via.c:227-231`, `keyboard_comm.py:107-109` |
| レイヤー数 | `[0x11]` | `data[1]` | `via.c:416-419`, `keyboard_comm.py:104` |
| キーマップバッファ | `[0x12, off_hi, off_lo, size]` (`>BHB`, size ≤ 28) | `data[4 : 4+size]` | `via.c:420-426`, `keyboard_comm.py:205-206` |
| レイアウトオプション | `[0x02, 0x02]` | `data[2..5]` = big-endian u32 | `keyboard_comm.py:228-230` |
| matrix state | `[0x02, 0x03]` | `data[2..]` | `via.c:250-273`, `matrix_test.py:107-125` |

- キーマップ全体のサイズは `layers * rows * cols * 2` バイト。1 キーコードは **big-endian u16**(`keyboard_comm.py:216` の `>H`)。
- 1 リクエストあたりの転送量は `BUFFER_FETCH_CHUNK = 28`(`protocol/constants.py`)。

### matrix state のデコード

```
row_size   = ceil(cols / 8)
row_bytes  = data[2 + row*row_size : 2 + (row+1)*row_size]
col_byte   = row_size - 1 - floor(col / 8)     # 行内は MSB バイトが先頭
pressed    = (row_bytes[col_byte] >> (col % 8)) & 1
```

`via.c:257-271` が行の値を `(value>>24), (value>>16), (value>>8), value` の順(MSB 先)で詰めるため、
`matrix_test.py:117` の `col_byte = len(row_data) - 1 - floor(col/8)` と一致する。HANDOFF の記述どおり。

**前提条件が 2 つある**:

1. `via.c:251-255` — `vial_unlocked` でなければ matrix state は返らない(キーロガー対策)。
2. `matrix_test.py:60-64` — vial-gui は `vial_protocol >= 3` かつ `(cols // 8 + 1) * rows <= 28` のときだけこの機能を出す。
   Cornix LP は 8 行 7 列なので `(7//8 + 1) * 8 = 8 ≤ 28` で条件を満たす。

さらに `via.c:215-224` により、**アンロック進行中は `0xFE` 系の一部コマンドしか通らない**。
この間は matrix state も keymap も取れないので、ポーリングを止める必要がある。

### 応答の取り違え

raw HID の入力レポートは、**その HID を開いているすべてのプロセスに配られる**。
Vial や Pipette を同時に開いていると、相手宛ての応答もこちらに届く。
幸い VIA コマンドはファームが `data[0]` にコマンド ID を残す(`via.c:213` が
`command_data = &data[1]` 以降にしか書かない)ので、それで自分宛てかを判定できる。
`0x12`(keymap バッファ)はオフセットとサイズもそのまま返るので、より厳密に照合できる。

Vial コマンド(`0xFE`)は `msg[0]` から上書きするため照合できない。ただし 0xFE 系は
読み込み時にしか使わず、ポーリングの本流には出てこない。

## 3. Vial コマンド (`0xFE` プレフィクス)

`vial.c:84` で `msg[1]` がサブコマンド。レスポンスは `msg[0]` から。

| 用途 | リクエスト | レスポンス | 根拠 |
|---|---|---|---|
| キーボード ID | `[0xFE, 0x00]` | `data[0..3]` = vial_protocol (u32 **LE**)、`data[4..11]` = uid(8B)、`data[12]` = VialRGB フラグ | `vial.c:91-104`, `keyboard_comm.py:125-126` |
| 定義サイズ | `[0xFE, 0x01]` | `data[0..3]` = u32 LE | `vial.c:106-113` |
| 定義ブロック | `[0xFE, 0x02, block_lo, block_hi]` | 32 バイト生データ | `vial.c:115-126` |
| アンロック状態 | `[0xFE, 0x05]` | `data[0]`=unlocked, `data[1]`=in_progress, `data[2+2i]`/`data[3+2i]` = unlock キーの (row, col) 最大 15 組、未使用は `0xFF` | `vial.c:143-159`, `keyboard_comm.py:469-483` |
| アンロック開始 | `[0xFE, 0x06]` | — | `vial.c:160-165` |
| アンロックポーリング | `[0xFE, 0x07]` | `data[0]`=unlocked, `data[1]`=in_progress, `data[2]`=counter | `vial.c:166-189` |
| ロック | `[0xFE, 0x08]` | — | `vial.c:190-196` |
| 動的エントリ数 | `[0xFE, 0x0D, 0x00]` | `data[0]`=TD数, `[1]`=Combo数, `[2]`=KeyOverride数, `[3]`=AltRepeat数, `data[31]`=機能ビット | `vial.c:228-245` |
| Tap Dance 取得 | `[0xFE, 0x0D, 0x01, idx]` | `data[0]`=status(0 が成功), `data[1..10]` = u16 **LE** ×5 = on_tap, on_hold, on_double_tap, on_tap_hold, tapping_term | `vial.c:247-254`, `vial.h:99-100`, `tap_dance.py:16-17` |

### アンロックの挙動

`vial.c:29,166-189`:

- `vial_unlock_start` でカウンタを `VIAL_UNLOCK_COUNTER_MAX = 50` にセット。
- `vial_unlock_poll` のたびに、**unlock キーを全部押していて**かつ前回から 100ms 以上経っていればカウンタを 1 減らす。
  離すと 50 に戻る。0 になったらアンロック完了。
- したがって最短でも約 5 秒の長押しが要る。vial-gui は 200ms 間隔でポーリングしている(`unlocker.py:104`)。
- 進捗バーは `max - counter` で描ける(`unlocker.py:69-72`)。

### 定義ブロックの取り込み

`keyboard_comm.py:133-142`:

```python
while sz > 0:
    data = usb_send(pack("<BBI", 0xFE, 0x02, block))   # ブロック番号は u32 LE で送る
    if sz < 32: data = data[:sz]                        # 最終ブロックは余りを切り捨て
    payload += data; block += 1; sz -= 32
payload = json.loads(lzma.decompress(payload))
```

**圧縮形式**:Cornix LP V1.12 のファームから定義ブロックを実際に取り出したところ、
先頭が `FD 37 7A 58 5A 00` で **XZ コンテナ**だった(LZMA-alone ではない)。
Python の `lzma.decompress` は両方を自動判別するので vial-gui のコードからは判らないが、
JS 側では XZ デコーダが必要。本アプリは `xz-decompress`(WASM、ネイティブビルドなし)を使い、
`5D` 始まりの LZMA-alone も一応フォールバックできる形にしてある。

なお `vial.c:117` は `page = msg[2] + (msg[3] << 8)` と **2 バイトしか読んでいない**。
vial-gui が u32 LE で送っているのは上位 2 バイトが常に 0 になるため実害がないから。

## 4. 定義 JSON

Cornix LP V1.12 から実測した構造(`reference/cornix-vial-definition.json` に置き、モックは `scripts/gen-mock.py` で XZ に固めて `src/renderer/src/mock/cornix.generated.ts` に埋め込んでいる):

```jsonc
{
  "name": "HID Keyboard", "vendorId": "0xE118", "productId": "0x0001",
  "lighting": "none",
  "matrix": { "rows": 8, "cols": 7 },
  "customKeycodes": [ { "name": "BT0", "title": "...", "shortName": "BT0" }, ... 8 個 ],
  "layouts": { "labels": [["Firmware Version", "V1.12"]], "keymap": [ /* KLE */ ] }
}
```

`customKeycodes[n]` は **`USER{n:02}` = `0x7E00 + n`** に対応する(`keycodes_v6.py:568,608` / `keycodes.py:833-843`)。
Cornix では `customKeycodes[0] = BT0` なので、HANDOFF が「要確認」としていた開始値は **`0x7E00` が正**。

### KLE の解釈(`kle_serial.py`)

- ラベルは `"\n"` 区切りで最大 12 個。`align`(`{"a": n}`、既定 4)に応じて `labelMap` で並べ替える。
- 並べ替え **後** の意味づけ(`keyboard_comm.py:160-194`):
  - `labels[0]` … `"row,col"`(通常キー)または `"encoder_idx,direction"`(エンコーダー)
  - `labels[4] === "e"` … エンコーダー。Cornix では `"0,0\n\n\n\n\n\n\n\n\ne"` の形で入っている
  - `labels[8]` … `"layout_index,layout_option"`
- `{"r": deg}` / `{"rx": x}` / `{"ry": y}` は**行の先頭キーでしか指定できない**(それ以外はエラー)。
  `rx` / `ry` はクラスタ原点をリセットする(`current.x = cluster.x` など)。回転は `(rx, ry)` を中心に `r` 度。
- 行末で `current.y += 1`、`current.x = current.rotation_x`。

Cornix の親指キーは `{"r": 11.93, "rx": 5, "ry": 4.75}` / `{"r": 23}` / `{"r": -23}` / `{"r": -11.93, "rx": 9.25}` で回っている。

## 5. キーコード(Vial protocol 6)

`keycodes_v6.py` の定数。構造で解釈する範囲:

| 範囲 | 意味 |
|---|---|
| `0x0000` / `0x0001` | `KC_NO` / `KC_TRNS` |
| `0x0002`–`0x00FF` | 基本キー(HID usage)。JIS 関連は `0x87`=`KC_RO`, `0x89`=`KC_JYEN`, `0x90`=`KC_LANG1`, `0x91`=`KC_LANG2` — **HANDOFF どおり** |
| `0x0100`–`0x1FFF` | モディファイア付き。`mods = (code >> 8) & 0x1F`、`0x10` ビットが立っていれば右 |
| `0x2000`–`0x3FFF` | Mod-Tap(`QK_MOD_TAP`)。mods / 内側キーの取り方は上と同じ |
| `0x4000`–`0x4FFF` | `LT(layer, kc)`:`layer = (code >> 8) & 0xF`(レイヤーは 0–15) |
| `0x5000`–`0x51FF` | `LM(layer, mod)`:`QK_LAYER_MOD`。`layer = (code >> 5) & 0xF`, `mod = code & 0x1F` |
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
名前テーブル引き。テーブルは `keycodes_v6.py` から機械生成して `src/renderer/src/keycodes/table.generated.ts` に置いた。

対応バージョン:`keyboard_comm.py:27-28` は `via_protocol == 9`、`vial_protocol ∈ 0..6` を受け付ける。
本アプリは HANDOFF の方針どおり **vial_protocol 6 / via_protocol 9 のみ**を対象とし、他はエラー表示にする。

## 6. エンコーダーの回転は取得できない

`vial_get_encoder`(`[0xFE, 0x03, layer, idx]`)で取れるのは、そのエンコーダーの
**各方向に割り当てられたキーコード**であって、回された事実ではない(`vial.c:130-139`)。

状態を返すコマンドは `id_get_keyboard_value` の 3 つだけで、

- `id_uptime`
- `id_layout_options`
- `id_switch_matrix_state`

回転に相当するものは無い(`via.c:232-274`)。しかも `id_switch_matrix_state` が読むのは
`matrix_get_row()` だけ(`via.c:260`)。QMK のエンコーダーは matrix スキャンとは別系統で
読まれ、matrix のビットには現れない。

したがって **回転はこのプロトコルでは観測できない**。ファームに独自の raw HID コマンドを
足してエンコーダーイベントを吐かせない限り、ホスト側でできることは無い。

一方、**ノブの押し込みは matrix に出る**。多くのキーボードでエンコーダーのスイッチは
通常のキーとして配線されているため。Cornix LP では左が `2,6`(`KC_MUTE`)、
右が `5,6`(`KC_BTN3`)。

## 7. リクエストの直列化

ファームは 1 リクエストにつき 1 レスポンスを返すだけで、**リクエストとレスポンスを対応づける ID がない**。
したがってホスト側でキューを持ち、前のレスポンスが来るまで次を送らない、という直列化が必須になる。
matrix state のポーリング(20ms 間隔)と、キーマップ読み出しのような長いシーケンスが
並走すると取り違えが起きる。本アプリでは `src/renderer/src/hid/transport.ts` の
`WebHidTransport` が 1 本のキューで全リクエストを直列化し、ポーリングは読み出し完了後にだけ回す。

## 8. ポーリング間隔

- matrix state:vial-gui は 20ms(`matrix_test.py:152`)。HANDOFF の「15〜20ms」と整合。
- unlock poll:200ms(`unlocker.py:104`)。

## 9. ライセンス

vial-gui / vial-qmk はいずれも **GPL-2.0-or-later**。本リポジトリのコードは
仕様(バイト列レイアウト・定数値)を参照して**独自に TypeScript で書き起こした**もので、
GPL コードの複製・翻案は行っていない。`table.generated.ts` は `keycodes_v6.py` の
**数値定数**(事実データ)を抽出したもの。Pipette (`darakuneko/pipette-desktop`) のコードは参照していない。

## 10. HANDOFF §5 との差分

| # | HANDOFF の記述 | 確認結果 |
|---|---|---|
| 1 | 「customKeycodes の開始値が `0x7E00` か `0x7E40` か要確認」 | **`0x7E00`**。`QK_KB = 0x7E00`、`USER{x} = QK_KB + x`(x は 0–63) |
| 2 | 「XZ か LZMA-alone かを実データで判定」 | Cornix LP V1.12 は **XZ**(`FD 37 7A 58 5A 00`)。念のため LZMA-alone フォールバックも実装 |
| 3 | 「エンコーダー(legend に `e`)」 | 正確には **並べ替え後の `labels[4] === "e"`**。`labels[0]` が `"idx,dir"` になる |
| 4 | 定義本体のリクエストは `block(u32 LE)` | 送るのは u32 LE で正しいが、ファームは **下位 2 バイトしか読まない** |
| 5 | `0x5200〜 TO / MO / DF / TG / OSL / OSM / TT` | これに加えて **`PDF(n)` = `0x52E0`**。また `0x4000`–`0x4FFF` と `0x5200` の間に **`LM()` = `0x5000`–`0x51FF`** がある |
| 6 | matrix state に「Vial のアンロックが必要」 | 正しい。加えて**アンロック進行中は VIA コマンドが一切通らない**(`via.c:215-224`)ので、その間はポーリングを止める |
| 7 | matrix state のバイト並び | 記述どおり。ただし vial-gui は `(cols // 8 + 1) * rows <= 28` と `vial_protocol >= 3` を前提条件にしている |
| 8 | Tap Dance レスポンス | 記述どおり(`status` + u16 LE ×5)。`status != 0` はエラー |

## 11. 実機のファームは RMK

Cornix LP V1.12 のファームに埋め込まれたソースパス(`.../rmk/src/host/via/vial.rs` など)と
依存の版から、**RMK v0.8.1〜v0.8.3**(`rmk-rs/rmk`)で作られていると分かった。
調べた内容と行番号は [BLUETOOTH.md](BLUETOOTH.md) §2 にある。要点:

| 項目 | vial-qmk(この文書の §1〜§9) | RMK v0.8.3 |
|---|---|---|
| matrix state | `data[2..]`、行ごと MSB バイトが先 | 同じ(USB で動作確認済み) |
| アンロックのカウンタ | 50 から 100ms ごとに 1 減る | **まだ押されていないアンロックキーの数**。全部押した瞬間に解除 |
| アンロック進行中の状態 | ファームにタイムアウトが無い | 最後のポーリングから 100ms で解ける |
| アンロック中の VIA コマンド | 通さない | 止める処理は見当たらない |
| USB と BLE | (BLE は無い) | **どちらか一方しか動かさない**。BLE 側にも同じ形(レポート ID 無し・32 バイト)の Vial がある |

この文書の §1〜§9 を読むときは、「vial-qmk ではこうなっている」と読み替えること。
アプリは両方で動くように作る(例:アンロックの進捗は、見たカウンタの最大値を最大にする)。
