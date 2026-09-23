#!/usr/bin/env python3
"""テスト用の「Cornix 以外のキーボード」の定義 JSON を作る。

    python3 scripts/gen-test-boards.py   # → tests/fixtures/boards.generated.ts

このアプリは固定データを持たない(配置もキーマップもキーボードから読む)。その前提が
本当かを、別の機種を名乗るモックで確かめるためのもの(tests/otherKeyboard.test.tsx)。

定義は実機と同じく **XZ で固めた JSON** として渡る(docs/PROTOCOL.md §3)ので、ここで
圧縮して base64 にしておく。JS 側には展開する口しか無いので、作るのは Python でやる。

作るもの:
  - plain60   … 5 行 14 列・ノブ無し・レイアウトオプション無し・カスタムキーコード無し
  - bigMatrix … 10 行 20 列。matrix state が 1 パケット(28 バイト)に収まらない大きさ
"""

import base64
import json
import lzma
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "boards.generated.ts"


def grid(rows: int, cols: int) -> list[list[str]]:
    """KLE の最小形。1 行を 1 配列にして "行,列" を並べるだけ。"""
    return [[f"{row},{col}" for col in range(cols)] for row in range(rows)]


def definition(name: str, rows: int, cols: int) -> dict:
    return {
        "name": name,
        "vendorId": "0xFEED",
        "productId": "0x0001",
        "matrix": {"rows": rows, "cols": cols},
        # labels(レイアウトオプション)も customKeycodes も置かない。
        # どちらも Cornix には有るので、無い機種の経路をここで通す
        "layouts": {"keymap": grid(rows, cols)},
    }


def packed(value: dict) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(lzma.compress(raw)).decode("ascii")


def wrap(name: str, base64_text: str) -> str:
    """80 桁くらいで折り返して TS の文字列にする。"""
    chunks = [base64_text[i : i + 76] for i in range(0, len(base64_text), 76)]
    body = "\n".join(f"  '{chunk}' +" for chunk in chunks)
    return f"export const {name} =\n{body[:-2]}\n"


boards = {
    "PLAIN60_DEFINITION_XZ_BASE64": definition("Plain60", 5, 14),
    "BIG_MATRIX_DEFINITION_XZ_BASE64": definition("BigMatrix", 10, 20),
}

lines = [
    "// 自動生成ファイル — 直接編集しないこと。",
    "// 再生成: python3 scripts/gen-test-boards.py",
    "//",
    "// Cornix 以外のキーボードを名乗るための定義 JSON(XZ 圧縮のまま、実機の応答と同じ形)。",
    "",
]
lines += [wrap(name, packed(value)) for name, value in boards.items()]

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"書いた: {OUT.relative_to(ROOT)}")
