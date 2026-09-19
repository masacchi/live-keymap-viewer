#!/usr/bin/env python3
"""モックデバイス用のデータを生成する。

  python3 scripts/gen-mock.py

入力:
  reference/Cornix_設定_LT.vil          Vial からエクスポートした実機のキーマップ
  reference/cornix-vial-definition.json Cornix LP V1.12 のファームから取り出した定義 JSON

出力:
  src/renderer/src/mock/cornix.generated.ts

定義 JSON は実機と同じく XZ で固めて base64 で埋め込む。モックを相手にしても
LZMA の展開経路がそのまま通るようにするため。
"""
import base64
import json
import lzma
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIL = ROOT / "reference/Cornix_設定_LT.vil"
DEF = ROOT / "reference/cornix-vial-definition.json"
OUT = ROOT / "src/renderer/src/mock/cornix.generated.ts"
KEYCODES_SRC = (
    "https://raw.githubusercontent.com/vial-kb/vial-gui/main/"
    "src/main/python/keycodes/keycodes_v6.py"
)


def load_keycodes() -> dict[str, int]:
    source = urllib.request.urlopen(KEYCODES_SRC, timeout=60).read().decode()
    ns: dict = {}
    exec(compile(source, "keycodes_v6.py", "exec"), ns)
    return ns["keycodes_v6"].kc


def deserialize(name: str, kc: dict[str, int]) -> int:
    """Vial の文字列キーコードを生の u16 に戻す(vial-gui の Keycode.deserialize 相当)。"""
    if name in kc:
        return kc[name]
    m = re.fullmatch(r"([A-Z0-9_]+)\((.+)\)", name)
    if m:
        outer, inner = m.group(1), m.group(2)
        if f"{outer}(kc)" in kc:
            return kc[f"{outer}(kc)"] | deserialize(inner, kc)
    raise KeyError(f"unknown keycode: {name}")


def main() -> int:
    kc = load_keycodes()
    vil = json.loads(VIL.read_text(encoding="utf-8"))
    definition = json.loads(DEF.read_text(encoding="utf-8"))

    layers = len(vil["layout"])
    rows = definition["matrix"]["rows"]
    cols = definition["matrix"]["cols"]
    assert len(vil["layout"][0]) == rows and len(vil["layout"][0][0]) == cols

    keymap: list[int] = []
    for layer in vil["layout"]:
        for row in layer:
            for name in row:
                keymap.append(deserialize(name, kc))

    tap_dance = [
        [deserialize(e[0], kc), deserialize(e[1], kc), deserialize(e[2], kc),
         deserialize(e[3], kc), e[4]]
        for e in vil["tap_dance"]
    ]

    encoders = [
        [[deserialize(d[0], kc), deserialize(d[1], kc)] for d in layer]
        for layer in vil["encoder_layout"]
    ]

    compressed = lzma.compress(
        json.dumps(definition, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        format=lzma.FORMAT_XZ,
        preset=6,
    )
    assert compressed[:6] == b"\xfd7zXZ\x00"

    def hex16(values) -> str:
        return ", ".join(f"0x{v:04x}" for v in values)

    lines = [
        "// 自動生成ファイル — 直接編集しないこと。",
        "// 生成元: reference/Cornix_設定_LT.vil + reference/cornix-vial-definition.json",
        "// 再生成: python3 scripts/gen-mock.py",
        "",
        f"export const MOCK_LAYERS = {layers}",
        f"export const MOCK_ROWS = {rows}",
        f"export const MOCK_COLS = {cols}",
        f"export const MOCK_VIAL_PROTOCOL = {vil['vial_protocol']}",
        f"export const MOCK_VIA_PROTOCOL = {vil['via_protocol']}",
        f"export const MOCK_UID = {vil['uid']}n",
        "",
        "/** 定義 JSON を XZ で固めたもの(base64)。実機の応答と同じ形。 */",
        "export const MOCK_DEFINITION_XZ_BASE64 =",
    ]
    b64 = base64.b64encode(compressed).decode()
    for i in range(0, len(b64), 76):
        chunk = b64[i : i + 76]
        sep = " +" if i + 76 < len(b64) else ""
        lines.append(f"  '{chunk}'{sep}")
    lines += [
        "",
        "/** [layer][row][col] を平らにした生キーコード列。big-endian u16 で送られるもの。 */",
        "export const MOCK_KEYMAP: readonly number[] = [",
    ]
    for i in range(0, len(keymap), cols):
        lines.append(f"  {hex16(keymap[i : i + cols])},")
    lines += [
        "]",
        "",
        "/** [on_tap, on_hold, on_double_tap, on_tap_hold, tapping_term] */",
        "export const MOCK_TAP_DANCE: ReadonlyArray<readonly number[]> = [",
    ]
    for entry in tap_dance:
        lines.append(f"  [{hex16(entry[:4])}, {entry[4]}],")
    lines += [
        "]",
        "",
        "/** [layer][encoder][direction] */",
        "export const MOCK_ENCODERS: ReadonlyArray<ReadonlyArray<readonly number[]>> = [",
    ]
    for layer in encoders:
        inner = ", ".join("[" + hex16(d) + "]" for d in layer)
        lines.append(f"  [{inner}],")
    lines += ["]", ""]

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT} ({layers}x{rows}x{cols} keymap, {len(tap_dance)} tap dance, "
          f"{len(compressed)} bytes xz)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
