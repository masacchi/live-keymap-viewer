# CLAUDE.md

Vial キーボード(Cornix LP)の押下とレイヤーをリアルタイム表示する Electron アプリ。
開発は WSL、実行対象は Windows。

## まず読む

- 構成と設計の理由: docs/ARCHITECTURE.md
- 手順・よくある変更: docs/DEVELOPMENT.md
- プロトコル: docs/PROTOCOL.md
- 現状・制約・今後: docs/STATUS.md
- **Bluetooth 対応の調査と実装計画: docs/BLUETOOTH.md**(BT の作業はまずこれを読む)

## コマンド

- `npm run check` … 型チェック + Biome + テスト。**husky の pre-commit で自動実行**され、落ちるとコミットできない。`--no-verify` で逃げずに直す
- `npm test` / `npm run lint` / `npm run format`
- `npm run deploy:win` … Windows 版を作ってデスクトップに置く
- `npm run diag:hid` / `npm run diag:webhid` … 実機の通信を OS / Chromium の段で切り分ける(アプリには触らない)。
  「繋がらない」「候補に出ない」ときはまずこれ(docs/BLUETOOTH.md §8)

## 守ること

- **Windows 側で動いているアプリを終了させない**(`taskkill` しない)。確認中の画面を落とすことになる。
  `deploy:win` は起動中なら止まるので、ユーザーに閉じてもらってから再実行する
- **WSL からは実機が見えない**(USB が無い)。動作確認はモック、実機は Windows 側でユーザーが行う
- **実機のファームは vial-qmk ではなく RMK v0.8.x**(`rmk-rs/rmk`)。プロトコルを触るときは
  vial-qmk / vial-gui に加えて RMK のソース(タグ `rmk-v0.8.3`)でも確かめ、docs/PROTOCOL.md に書く。
  両者で違うところ(アンロックのカウンタなど)は、どちらでも動くように作る。
  `MockTransport` はファームと同じバイト並びで答えること
- `*.generated.ts` は手で直さない(`scripts/gen-*.py` で作り直す)
- CSS のキーキャップは「基本 → 種類 → 状態」の順を崩さない(同じ詳細度なので後勝ち)
- コミットは小さくこまめに。リポジトリはローカルのみで、push しない
- コメント・ドキュメントは日本語で、なぜそうしているかを書く
- 依存は増やしすぎない(最小限・保守しやすい構成が方針)

## 環境の癖

- このツールの中では `ELECTRON_RUN_AS_NODE=1` が立っていることがある。Electron を直接起動するなら
  `env -u ELECTRON_RUN_AS_NODE` を付ける
