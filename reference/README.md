# reference/

| ファイル | 出どころ |
|---|---|
| `Cornix_設定_LT.vil` | 実機のVialからエクスポートしたキーマップ。モックのデータとテストの期待値の元 |
| `keymap-preview.html` | 手で作った静的なキーマップの図。JISのラベルの表と見た目の参考。テストのJISのベースレイヤーの期待値はここから起こしている |
| `cornix-vial-definition.json` | **Cornix LPのファームV1.12から取り出した、キーボードの定義そのもの** |

## cornix-vial-definition.jsonの取り出し方

Vialの定義は、ファームにXZ圧縮で埋め込まれている(`vial_generated_keyboard_definition.h`)。
`jezailfunder/cornix-lp`の`cornix固件 V1.12/cornix-left.uf2`から、次の手順で取り出した。

1. UF2の512バイトのブロックごとに256バイトのペイロードを取り出し、アドレス順につなげてフラッシュの像を作る
2. XZのマジック`FD 37 7A 58 5A 00`を探す
3. そこから`lzma.decompress`する

これで得たJSONを整形したものがこのファイル。`matrix`、`layouts.keymap`(KLE)、
`customKeycodes`が入っていて、`USER00` = `BT0`であることの裏付けにもなっている
(docs/PROTOCOL.md §4)。

## ファームはRMK

同じuf2に埋め込まれたパニック時のソースパス(`/Users/haobogu/Projects/keyboard/fix/cornix_panic/rmk/src/...`)
と依存の版(`trouble-host 0.5.1` / `embassy-nrf 0.8.0`)から、ファームはvial-qmkではなく
**RMK v0.8.1〜v0.8.3**で作られていると分かる。詳しくはdocs/BLUETOOTH.md §2.1。

```bash
strings -n 6 cornix-left.uf2 | grep -E 'rmk/src|trouble-host|embassy-nrf'
```
