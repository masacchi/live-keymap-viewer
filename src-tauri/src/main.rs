//! アプリの入口。起動と終了の段取りだけを持つ。
//!
//!   windows.rs  … 通常ウィンドウ / クリック透過オーバーレイの作り分けと切り替え
//!   hid.rs      … キーボードとの raw HID(画面からは WebHID と同じ形に見せる)
//!   commands.rs … 画面からの要求の受け口
//!   settings.rs … settings.json の検証と読み書き
//!   logfile.rs  … log.txt(実機で何が起きたかを残す)

// 配布ビルドでコンソールの窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod hid;
mod logfile;
mod settings;
mod windows;

use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::hid::HidBridge;
use crate::settings::SettingsStore;
use crate::windows::WindowManager;

/// 設定とログを置くフォルダの名前(OS の設定の置き場所の下)。
/// Electron 版(userData = %APPDATA%\Live Keymap Viewer)と同じにして、乗り換えても
/// レイヤー名・ウィンドウの位置・許可したキーボードをそのまま使えるようにする。
const DATA_DIR_NAME: &str = "Live Keymap Viewer";

/// 通常ウィンドウ ⇄ オーバーレイの切り替え。オーバーレイ中の最後の逃げ道でもある。
const TOGGLE_SHORTCUT: &str = "Ctrl+Alt+K";

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::settings_get,
            commands::settings_update,
            commands::settings_set_layer_name,
            commands::settings_forget_device,
            commands::window_get_mode,
            commands::window_toggle_mode,
            commands::window_set_overlay_blur_active,
            commands::window_set_ignore_mouse,
            commands::window_move_by,
            commands::window_resize_by,
            commands::hid_released,
            commands::hid_devices,
            commands::hid_remember,
            commands::hid_open,
            commands::hid_write,
            commands::hid_close,
            commands::log_report,
            commands::log_open,
        ])
        .setup(|app| {
            // いちばん先に入れる。これより前に転んだものは記録できない
            let dir = app.path().config_dir()?.join(DATA_DIR_NAME);
            logfile::init(dir.join("log.txt"));
            logfile::install_panic_hook();
            logfile::info(
                &format!("起動 v{} ({})", app.package_info().version, commands::runtime_label()),
                None,
            );

            let settings = SettingsStore::new(dir.join("settings.json"));
            let hid = HidBridge::new(app.handle().clone());
            hid.start_monitor();
            let windows = WindowManager::new(app.handle().clone(), settings.clone(), hid.clone());
            app.manage(settings);
            app.manage(hid);
            app.manage(windows.clone());

            windows.open();
            windows.start_cursor_forwarding();

            let toggle = windows.clone();
            let registered = app.global_shortcut().on_shortcut(
                TOGGLE_SHORTCUT,
                move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle.toggle_mode();
                    }
                },
            );
            if let Err(error) = registered {
                logfile::warn(
                    &format!("グローバルショートカット {TOGGLE_SHORTCUT} を登録できなかった"),
                    Some(&error.to_string()),
                );
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("アプリを起動できなかった");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // 設定の書き込みはまとめてあるので、最後のぶんをここで落とさずに書く
            app.state::<Arc<SettingsStore>>().flush();
        }
    });
}
