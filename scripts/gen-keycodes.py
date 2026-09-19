#!/usr/bin/env python3
"""vial-gui の keycodes_v6.py から、値→QMK 名のテーブルを TypeScript として生成する。

  python3 scripts/gen-keycodes.py

構造的にデコードできるもの(モディファイア付き、Mod-Tap、LT、LM、レイヤー系、
TD、マクロ、USER)はテーブルに入れない。decode.ts が範囲から計算する。
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

SRC = "https://raw.githubusercontent.com/vial-kb/vial-gui/main/src/main/python/keycodes/keycodes_v6.py"
OUT = Path(__file__).resolve().parent.parent / "src/renderer/src/keycodes/table.generated.ts"

# decode.ts が範囲計算で扱うため、テーブルから除外する生成系の名前
FAMILY = re.compile(
    r"^(M\d+|TD\(\d+\)|MO\(\d+\)|DF\(\d+\)|TG\(\d+\)|TT\(\d+\)|OSL\(\d+\)|TO\(\d+\)"
    r"|PDF\(\d+\)|LT\d+\(kc\)|USER\d\d|OSM\(.*\))$"
)
# キーコードではなく、範囲の先頭やビット定数を表す名前
CONSTANTS = {
    "MOD_LCTL", "MOD_LSFT", "MOD_LALT", "MOD_LGUI", "MOD_RCTL", "MOD_RSFT",
    "MOD_RALT", "MOD_RGUI", "MOD_HYPR", "MOD_MEH", "ON_PRESS",
    "QMK_LM_SHIFT", "QMK_LM_MASK",
    "QK_LCTL", "QK_LSFT", "QK_LALT", "QK_LGUI", "QK_RCTL", "QK_RSFT", "QK_RALT", "QK_RGUI",
    "QK_MOD_TAP", "QK_LAYER_TAP", "QK_LAYER_MOD", "QK_TO", "QK_MOMENTARY", "QK_DEF_LAYER",
    "QK_TOGGLE_LAYER", "QK_ONE_SHOT_LAYER", "QK_ONE_SHOT_MOD", "QK_LAYER_TAP_TOGGLE",
    "QK_PERSISTENT_DEF_LAYER", "QK_TAP_DANCE", "QK_MACRO", "QK_KB",
}


def main() -> int:
    source = urllib.request.urlopen(SRC, timeout=60).read().decode()
    ns: dict = {}
    exec(compile(source, "keycodes_v6.py", "exec"), ns)
    kc: dict[str, int] = ns["keycodes_v6"].kc

    table: dict[int, str] = {}
    for name, value in kc.items():
        if name.endswith("(kc)") or FAMILY.match(name) or name in CONSTANTS:
            continue
        # 同じ値に複数の名前がある場合は、ソースに先に出てきた方を正とする
        table.setdefault(value, name)

    lines = [
        "// 自動生成ファイル — 直接編集しないこと。",
        "// 生成元: vial-kb/vial-gui src/main/python/keycodes/keycodes_v6.py (GPL-2.0-or-later)",
        "// 再生成: python3 scripts/gen-keycodes.py",
        "//",
        "// 構造的にデコードできる範囲(モディファイア付き / Mod-Tap / LT / LM / レイヤー系 /",
        "// TD / マクロ / USER)は含まない。decode.ts を参照。",
        "",
        "export const KEYCODE_NAMES: Readonly<Record<number, string>> = Object.freeze({",
    ]
    for value in sorted(table):
        lines.append(f"  0x{value:04x}: {json.dumps(table[value])},")
    lines.append("})")
    # 内側キーを取るマスク系(LSFT(kc) / LSFT_T(kc) など)。接頭辞だけを残す。
    masks: dict[int, str] = {}
    for name, value in kc.items():
        if name.endswith("(kc)"):
            masks.setdefault(value, name[: -len("(kc)")])

    lines.append("")
    lines.append("/** マスク系キーコードの上位バイト → 接頭辞(例: 0x0200 -> \"LSFT\")。 */")
    lines.append("export const KEYCODE_MASKS: Readonly<Record<number, string>> = Object.freeze({")
    for value in sorted(masks):
        lines.append(f"  0x{value:04x}: {json.dumps(masks[value])},")
    lines.append("})")
    lines.append("")
    lines.append("/** QMK 名 → 生の値。KEYCODE_NAMES の逆引き。 */")
    lines.append("export const KEYCODE_VALUES: Readonly<Record<string, number>> = Object.freeze(")
    lines.append("  Object.fromEntries(Object.entries(KEYCODE_NAMES).map(([v, n]) => [n, Number(v)]))")
    lines.append(")")
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT} ({len(table)} keycodes, {len(masks)} masks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
