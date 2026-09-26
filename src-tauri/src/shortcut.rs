//! 通常ウィンドウとオーバーレイを切り替えるグローバルショートカット。
//!
//! オーバーレイ中はクリックが下に抜けるので、キー操作で戻れるようにしておく。
//! 組み合わせは設定で変えられる(settings.rsの`toggle_shortcut`)。ほかのアプリが同じ組み合わせを
//! 使っていると登録できない(開発版とリリース版を同時に起動したときの後の方も)。そのときは
//! ログに残し、画面が`shortcut_registered`で知って案内する。

use std::str::FromStr;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::logfile;
use crate::windows::WindowManager;

/// いま登録しているショートカット。登録できていなければNone。
#[derive(Default)]
pub struct ToggleShortcut(Mutex<Option<Shortcut>>);

impl ToggleShortcut {
    /// `text`を登録できているか(読めない組み合わせならfalse)。
    pub fn is_registered(&self, text: &str) -> bool {
        let Ok(shortcut) = Shortcut::from_str(text) else { return false };
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) == Some(shortcut)
    }
}

/// `text`を登録し直す。前に登録したものは外す。登録できたらtrue。
///
/// ロックは持ったままプラグインを呼ばない(登録はメインスレッドで行われ、そちらで同じロックを
/// 待つ処理と互いに待ち合わないように。docs/ARCHITECTURE.md §7)。
pub fn apply(app: &AppHandle, text: &str) -> bool {
    let state = app.state::<ToggleShortcut>();
    let Ok(next) = Shortcut::from_str(text) else {
        logfile::warn(&format!("ショートカット{text}を読めなかった"), None);
        return false;
    };
    let previous = state.0.lock().unwrap_or_else(|p| p.into_inner()).take();
    if previous == Some(next) {
        *state.0.lock().unwrap_or_else(|p| p.into_inner()) = previous;
        return true;
    }
    if let Some(previous) = previous {
        let _ = app.global_shortcut().unregister(previous);
    }
    let registered = app.global_shortcut().on_shortcut(next, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            app.state::<Arc<WindowManager>>().toggle_mode();
        }
    });
    match registered {
        Ok(()) => {
            *state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(next);
            true
        }
        Err(error) => {
            logfile::warn(
                &format!("グローバルショートカット{text}を登録できなかった"),
                Some(&error.to_string()),
            );
            false
        }
    }
}
