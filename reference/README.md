# reference/

| ファイル | 出どころ |
|---|---|
| `Cornix_設定_LT.vil` | 実機の Vial からエクスポートしたキーマップ(HANDOFF §9)。モックデータとテストの期待値の元。 |
| `keymap-preview.html` | 手で作った静的なキーマップ図。JIS ラベル表と見た目の参考。テストの JIS ベースレイヤー期待値はここから起こしている。 |
| `cornix-vial-definition.json` | **Cornix LP ファームウェア V1.12 から取り出した、キーボード定義そのもの。** |

## cornix-vial-definition.json の取り出し方

Vial の定義はファームに XZ 圧縮で埋め込まれている(`vial_generated_keyboard_definition.h`)。
`jezailfunder/cornix-lp` の `cornix固件 V1.12/cornix-left.uf2` から次の手順で取り出した:

1. UF2 の各 512 バイトブロックから 256 バイトのペイロードを取り出し、アドレス順に連結してフラッシュ像を作る
2. XZ のマグリック `FD 37 7A 58 5A 00` を探す
3. そこから `lzma.decompress` する

これで得た JSON を整形したものがこのファイル。`matrix`、`layouts.keymap`(KLE)、
`customKeycodes` が入っていて、`USER00` = `BT0` であることの裏付けにもなっている
(docs/PROTOCOL.md §4)。
