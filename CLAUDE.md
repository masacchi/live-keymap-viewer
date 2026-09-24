# CLAUDE.md

Vial キーボード(Cornix LP)の押下とレイヤーをリアルタイム表示する Tauri 2 アプリ
(外側は Rust、画面は React)。開発は WSL(Rust はコンテナ)、実行対象は Windows。

## まず読む

- 構成と設計の理由: docs/ARCHITECTURE.md
- 手順・よくある変更: docs/DEVELOPMENT.md
- プロトコル: docs/PROTOCOL.md
- 現状・制約・今後: docs/STATUS.md
- **Bluetooth 対応の調査と実装計画: docs/BLUETOOTH.md**(BT の作業はまずこれを読む)

## コマンド

- `npm run check` … 型チェック + Biome + テスト。**husky の pre-commit で自動実行**され、落ちるとコミットできない。`--no-verify` で逃げずに直す
- `npm run check:rust` … Rust の整形・clippy(Linux と Windows)・テスト。`src-tauri/` を触ったコミットで自動実行
- Rust の道具(cargo・cargo-xwin・vpk)は**コンテナ(podman)にだけ**ある。`npm run container -- <コマンド>` で中で動く。
  `package:win` / `installer:win` / `check:rust` は自動で中で動く(scripts/container.mjs)
- `npm test` / `npm run lint` / `npm run format`
- `npm run deploy:win` … Windows 版を作ってデスクトップに置く
- `npm run installer:win` … インストーラー(Velopack の Setup.exe)と更新の包みを作る(vpk はコンテナにある)。
  GitHub Actions(`.github/workflows/build-windows.yml`)も同じ手順で作り、タグならリリースに載せる
- `npm run diag:hid` … 実機の通信を OS の段で切り分ける(アプリには触らない。アプリも同じ Windows の HID API を使う)。
  「繋がらない」「候補に出ない」ときはまずこれ(docs/BLUETOOTH.md §8)

## 守ること

- **Windows 側で動いているアプリを終了させない**(`taskkill` しない)。確認中の画面を落とすことになる。
  `deploy:win` は置き場所の exe が起動中なら止まるので、ユーザーに閉じてもらってから再実行する
- **WSL からは実機が見えない**(USB が無い)。動作確認はモック、実機は Windows 側でユーザーが行う。
  Linux 版の Tauri はコンテナの仮想画面(Xvfb)で動かして撮れる(docs/DEVELOPMENT.md §4)
- **実機のファームは vial-qmk ではなく RMK v0.8.x**(`rmk-rs/rmk`)。プロトコルを触るときは
  vial-qmk / vial-gui に加えて RMK のソース(タグ `rmk-v0.8.3`)でも確かめ、docs/PROTOCOL.md に書く。
  両者で違うところ(アンロックのカウンタなど)は、どちらでも動くように作る。
  `MockTransport` はファームと同じバイト並びで答えること
- `*.generated.ts` は手で直さない(`scripts/gen-*.py` で作り直す)
- CSS のキーキャップは「基本 → 種類 → 状態」の順を崩さない(同じ詳細度なので後勝ち)
- 設定の範囲・既定値は `src/shared/settings.ts` と `src-tauri/src/settings.rs` の 2 か所にある。変えるときは両方
- 画面は Tauri を直接呼ばない。Rust との繋ぎは `src/renderer/src/platform/tauri.ts` だけ
- インストーラーのパッケージ ID(`live-keymap-viewer`)は変えない(変えると入っているものが更新されない)。
  vpk(Dockerfile の `VPK_VERSION`)と `velopack` crate は同じ版にする
- パス(フォルダ・ファイル名)に半角スペースを入れない。表示名(ショートカット・アプリ一覧)は「Live Keymap Viewer」
- コミットは小さくこまめに。push は頼まれたときだけ
- **コミットメッセージは日本語で書く**(何を直したかと、なぜそうしたか)。
  種類と範囲の接頭辞は英語のまま残す(`fix(session): …` / `feat(ui): …`)― 一覧が読みやすいので
- コメント・ドキュメントは日本語で、なぜそうしているかを書く
- 依存は増やしすぎない(最小限・保守しやすい構成が方針)

## 環境の癖

- このツールの中では `ELECTRON_RUN_AS_NODE=1` が立っていることがある。開発用の Electron
  (`npm run shots` / `gen:icon`。アプリ本体ではない)を直接起動するなら `env -u ELECTRON_RUN_AS_NODE` を付ける
- podman は毎回 `"/" is not a shared mount` と警告を出すが、害は無い
