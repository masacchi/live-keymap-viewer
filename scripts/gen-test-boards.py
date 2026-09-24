#!/usr/bin/env python3
"""テスト用の「Cornix以外のキーボード」の定義JSONを作る。

    python3 scripts/gen-test-boards.py   # → tests/fixtures/boards.generated.ts

このアプリは固定データを持たない(配置もキーマップもキーボードから読む)。その前提が
本当かを、別の機種を名乗るモックで確かめるためのもの(tests/otherKeyboard.test.tsx)。

定義は実機と同じく**XZで固めたJSON**として渡る(docs/PROTOCOL.md §3)ので、ここで
圧縮してbase64にしておく。JS側には展開する口しか無いので、作るのはPythonでやる。

作るもの:
  - plain60   … 5行14列・ノブ無し・レイアウトオプション無し・カスタムキーコード無し
  - bigMatrix … 10行20列。matrix stateが1パケット(28バイト)に収まらない大きさ
"""

import base64
import json
import lzma
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "boards.generated.ts"


def grid(rows: int, cols: int) -> list[list[str]]:
    """KLEの最小形。1行を1配列にして"行,列"を並べるだけ。"""
    return [[f"{row},{col}" for col in range(cols)] for row in range(rows)]


def definition(name: str, rows: int, cols: int) -> dict:
    return {
        "name": name,
        "vendorId": "0xFEED",
        "productId": "0x0001",
        "matrix": {"rows": rows, "cols": cols},
        # labels(レイアウトオプション)もcustomKeycodesも置かない。
        # どちらもCornixには有るので、無い機種の経路をここで通す
        "layouts": {"keymap": grid(rows, cols)},
    }


def packed(value: dict) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(lzma.compress(raw)).decode("ascii")


def wrap(name: str, base64_text: str) -> str:
    """80桁くらいで折り返してTSの文字列にする。"""
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
