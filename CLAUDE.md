# CLAUDE.md

Vialキーボード(Cornix LP)の押しているキーとレイヤーをリアルタイムに表示するTauri 2アプリ
(ウィンドウ・HID・設定はRust、画面はReact)。開発はWSL(Rustはコンテナ)、実行するのはWindows。

## まず読む

- 構成と設計の理由: docs/ARCHITECTURE.md
- 手順・よくある変更: docs/DEVELOPMENT.md
- プロトコル: docs/PROTOCOL.md
- 現状・制約・今後: docs/STATUS.md
- **Bluetooth対応の調査と実装計画: docs/BLUETOOTH.md**(BTの作業はまずこれを読む)

## コマンド

- `npm run check` … 型チェック + Biome + テスト。**huskyのpre-commitで自動で走り**、落ちるとコミットできない。`--no-verify`で逃げずに直す
- `npm run check:rust` … Rustの整形・clippy(LinuxとWindows)・テスト。`src-tauri/`を変えたコミットで自動で走る
- Rustの道具(cargo・cargo-xwin・vpk)は**コンテナ(podman)にだけ**ある。`npm run container -- <コマンド>`で中で動く。
  `package:win` / `installer:win` / `check:rust`は自動で中で動く(scripts/container.mjs)
- `npm test` / `npm run lint` / `npm run format`
- `npm run deploy:win` … Windows版を作ってデスクトップに置く
- `npm run installer:win` … インストーラー(VelopackのSetup.exe)と更新用のパッケージを作る(vpkはコンテナにある)。
  GitHub Actions(`.github/workflows/build-windows.yml`)も同じ手順で作り、タグならリリースに載せる
- `npm run diag:hid` … 実機の通信をOSの段で切り分ける(アプリには触らない。アプリも同じWindowsのHID APIを使う)。
  「接続できない」「候補に出ない」ときはまずこれ(docs/BLUETOOTH.md §8)

## 守ること

- **Windows側で動いているアプリを終了させない**(`taskkill`しない)。確認中の画面を落とすことになる。
  `deploy:win`は置き場所のexeが起動中なら止まるので、ユーザーに閉じてもらってから再実行する
- **WSLからは実機が見えない**(USBが無い)。動作確認はモックで行い、実機はWindows側でユーザーが確認する。
  Linux版のTauriはコンテナの仮想画面(Xvfb)で動かして撮れる(docs/DEVELOPMENT.md §4)
- **実機のファームはvial-qmkではなくRMK v0.8.x**(`rmk-rs/rmk`)。プロトコルを触るときは
  vial-qmk / vial-guiに加えてRMKのソース(タグ`rmk-v0.8.3`)でも確認し、docs/PROTOCOL.mdに書く。
  両者で違うところ(アンロックのカウンタなど)は、どちらでも動くように作る。
  `MockTransport`はファームと同じバイト並びで答えること
- `*.generated.ts`は手で直さない(`scripts/gen-*.py`で作り直す)
- CSSのキーキャップは「基本 → 種類 → 状態」の順を崩さない(同じ詳細度なので後に書いた方が勝つ)
- 設定の範囲・既定値は`src/shared/settings.ts`と`src-tauri/src/settings.rs`の2か所にある。変えるときは両方
- 画面はTauriを直接呼ばない。Rustとのやり取りは`src/renderer/src/platform/tauri.ts`だけで行う
- インストーラーのパッケージID(`live-keymap-viewer`)は変えない(変えると、入っているものが更新されない)。
  vpk(Dockerfileの`VPK_VERSION`)と`velopack` crateは同じ版にする
- パス(フォルダ・ファイル名)に半角スペースを入れない。表示名(ショートカット・アプリ一覧)は「Live Keymap Viewer」
- コミットは小さくこまめに。pushは頼まれたときだけ
- **コミットメッセージは日本語で書く**(何を直したかと、なぜそうしたか)。
  種類と範囲の接頭辞は英語のまま残す(`fix(session): …` / `feat(ui): …`)。一覧が読みやすいため
- 依存は増やしすぎない(最小限で保守しやすい構成が方針)

## 書き方(コメント・ドキュメント・コミットメッセージ)

- 日本語で、何をしているかより**なぜそうしているか**を書く
- **日本語と英数字のあいだに半角スペースを入れない**(「Rustの道具」「2秒」「`npm run check`が通る」)。
  ただし画面の文言を引くときは、画面の表示どおりに書く(「L0 の濃さ」など。文言は`messages.ts`にある)
- 「以前は〜していた」という経緯は書かない。いまそうしている理由として書く(「〜すると…になるので、こうする」)
- ふだん使う言葉で書く(「接続する」「タイムアウト」「ダウンロードする」「オン/オフ」)
- READMEは利用者向けに「です・ます」、ほかのドキュメントとコメントは「だ・である」

## 環境の癖

- このツールの中では`ELECTRON_RUN_AS_NODE=1`が立っていることがある。開発用のElectron
  (`npm run shots` / `gen:icon`で使う。アプリ本体ではない)を直接起動するなら`env -u ELECTRON_RUN_AS_NODE`を付ける
- podmanは毎回`"/" is not a shared mount`と警告を出すが、害は無い
