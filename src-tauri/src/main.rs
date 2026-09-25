//! アプリの入口。起動と終了の段取りだけを持つ。
//!
//!   windows.rs  … 通常ウィンドウ / クリック透過オーバーレイの作り分けと切り替え
//!   hid.rs      … キーボードとのraw HID(画面からはWebHIDと同じ形に見せる)
//!   commands.rs … 画面から呼ばれるコマンド
//!   settings.rs … settings.jsonの検証と読み書き
//!   logfile.rs  … log.txt(実機で何が起きたかを残す)
//!   updater.rs  … インストーラーで入れたときの更新(Velopack)

// 配布ビルドでコンソールの窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod hid;
mod logfile;
mod settings;
mod updater;
mod windows;

use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::hid::HidBridge;
use crate::settings::SettingsStore;
use crate::windows::WindowManager;

/// 設定とログを置くフォルダの名前(OSの設定の置き場所 = Windowsなら%APPDATA%の下)。
/// パスに半角スペースを入れない(コマンドラインやスクリプトで扱うときに引用符が要らないように)。
const DATA_DIR_NAME: &str = "live-keymap-viewer";

/// 通常ウィンドウとオーバーレイの切り替え。オーバーレイ中はクリックが下に抜けるので、
/// キー操作で戻れるようにしておく。
const TOGGLE_SHORTCUT: &str = "Ctrl+Alt+K";

fn main() {
    // いちばん先に動かす。インストール・アンインストール・更新の途中でVelopackが
    // このプロセスを呼んだときは、ここで用を済ませて終わる(ウィンドウは出さない)
    velopack::VelopackApp::build().run();

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
            commands::update_check,
            commands::update_apply,
        ])
        .setup(|app| {
            // ログはいちばん先に用意する。これより前に起きたエラーは記録できない
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
            // 設定はまとめて書き込んでいるので、終了時に残りを書き出す
            app.state::<Arc<SettingsStore>>().flush();
        }
    });
}
