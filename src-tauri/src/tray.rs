//! タスクトレイのアイコン。
//!
//! オーバーレイはタスクバーに出さない(`skip_taskbar`)ので、オーバーレイで使っているあいだは
//! アプリを見つける場所が無い。トレイに置いて、通常ウィンドウとの切り替えと終了をできるようにする。
//! Windowsの起動時に自動で起動したとき(settings.rsではなくOSの登録。commands.rsのautostart_*)も、
//! ここから操作できる。

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::channel;
use crate::windows::WindowManager;

const SHOW: &str = "show";
const TOGGLE: &str = "toggle";
const QUIT: &str = "quit";

/// トレイのアイコンを作る。左クリックでウィンドウを前に出し、右クリックでメニューを出す。
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW, "ウィンドウを前に出す", true, None::<&str>)?;
    let toggle = MenuItem::with_id(
        app,
        TOGGLE,
        "通常ウィンドウとオーバーレイを切り替える",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, QUIT, "終了", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &toggle, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip(channel::TITLE)
        .menu(&menu)
        // 左クリックはウィンドウを前に出すだけにする(メニューは右クリック)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let windows = app.state::<Arc<WindowManager>>();
            match event.id.as_ref() {
                SHOW => windows.show(),
                TOGGLE => windows.toggle_mode(),
                // 終了の処理(設定の書き出し)はmain.rsのRunEvent::Exitで行う
                QUIT => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                tray.app_handle().state::<Arc<WindowManager>>().show();
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
