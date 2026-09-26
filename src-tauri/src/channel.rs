//! 開発版かリリース版か。
//!
//! 開発版(mainへのpushでCIが作るもの)は、リリース版と1台に並べて入れられるように、
//! 設定とログの置き場所・更新を探す場所・ウィンドウの名前をリリース版と分ける。
//! 同じにすると、並べて動かしたときに同じsettings.jsonを書き合い、更新もリリース版の方を見てしまう。
//! どちらになるかはビルドのときの環境変数`LKV_DEV`で決まる(scripts/package-win.mjsの`--dev`が立てる)。

/// 開発版ならtrue。
pub const DEV: bool = option_env!("LKV_DEV").is_some();

/// ウィンドウの名前。タスクバーで開発版とリリース版を見分けられるようにする。
pub const TITLE: &str = if DEV { "Live Keymap Viewer Dev" } else { "Live Keymap Viewer" };
