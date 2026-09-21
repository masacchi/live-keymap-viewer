# CLAUDE.md

Vial キーボード(Cornix LP)の押下とレイヤーをリアルタイム表示する Electron アプリ。
開発は WSL、実行対象は Windows。

## まず読む

- 構成と設計の理由: docs/ARCHITECTURE.md
- 手順・よくある変更: docs/DEVELOPMENT.md
- プロトコル: docs/PROTOCOL.md
- 現状・制約・今後: docs/STATUS.md

## コマンド

- `npm run check` … 型チェック + Biome + テスト。**husky の pre-commit で自動実行**され、落ちるとコミットできない。`--no-verify` で逃げずに直す
- `npm test` / `npm run lint` / `npm run format`
- `npm run deploy:win` … Windows 版を作ってデスクトップに置く

## 守ること

- **Windows 側で動いているアプリを終了させない**(`taskkill` しない)。確認中の画面を落とすことになる。
  `deploy:win` は起動中なら止まるので、ユーザーに閉じてもらってから再実行する
- **WSL からは実機が見えない**(USB が無い)。動作確認はモック、実機は Windows 側でユーザーが行う
- プロトコルを触るときは vial-qmk / vial-gui のソースで確かめ、docs/PROTOCOL.md に書く。
  `MockTransport` はファームと同じバイト並びで答えること
- `*.generated.ts` は手で直さない(`scripts/gen-*.py` で作り直す)
- CSS のキーキャップは「基本 → 種類 → 状態」の順を崩さない(同じ詳細度なので後勝ち)
- コミットは小さくこまめに。リポジトリはローカルのみで、push しない
- コメント・ドキュメントは日本語で、なぜそうしているかを書く
- 依存は増やしすぎない(最小限・保守しやすい構成が方針)

## 環境の癖

- このツールの中では `ELECTRON_RUN_AS_NODE=1` が立っていることがある。Electron を直接起動するなら
  `env -u ELECTRON_RUN_AS_NODE` を付ける
