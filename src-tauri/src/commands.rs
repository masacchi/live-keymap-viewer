//! 画面(WebView)から呼ばれるコマンド。Electron 版の ipc.ts にあたる。
//!
//! 画面から来た値は、ここで範囲を確かめてから使う。型は Tauri が確かめる(合わなければ
//! 呼び出しが失敗する)。画面が使うものだけを置く ― 対になる TS は src/renderer/src/platform/tauri.ts。
//!
//! 引数の名前は画面からは camelCase で渡す(`vendor_id` なら `vendorId`)。
//!
//! 待つ処理(HID の読み書き・一覧・ウィンドウの作り直し)は async にしてメインスレッドの外で動かす。
//! async でないコマンドはメインスレッドで動くので、そこで待つと画面ごと止まる。

use std::sync::Arc;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::hid::{HidBridge, HidDeviceInfo};
use crate::logfile;
use crate::settings::{
    GrantedDevice, MAX_LAYERS, Settings, SettingsStore, WindowMode, is_granted, is_keyboard_uid,
    patch, pick_renderer_patch, with_layer_name,
};
use crate::updater::{self, UpdateStatus};
use crate::windows::WindowManager;

/// 画面から来たエラーの、残す長さの上限(文字数)。
const LOG_MESSAGE_MAX: usize = 300;
const LOG_DETAIL_MAX: usize = 2000;

/// どのビルドが動いているか。設定パネルの隅に出す。ビルドした時刻は画面が持っている。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    /// 画面を描いているもの(「WebView2 153.0.…」など)。
    runtime: String,
    log_path: String,
}

/// 画面を描いているものの名前と版。起動のログにも残す。
pub fn runtime_label() -> String {
    let name = if cfg!(windows) { "WebView2" } else { "WebKitGTK" };
    match tauri::webview_version() {
        Ok(version) => format!("{name} {version}"),
        Err(_) => name.to_owned(),
    }
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        runtime: runtime_label(),
        log_path: logfile::path().map(|p| p.display().to_string()).unwrap_or_default(),
    }
}

#[tauri::command]
pub fn settings_get(settings: State<'_, Arc<SettingsStore>>) -> Settings {
    settings.load()
}

/// 変えてよい項目だけを取り出し、値は保存するときに確かめる。ウィンドウに効くものはその場で反映する。
#[tauri::command]
pub fn settings_update(
    patch: Value,
    settings: State<'_, Arc<SettingsStore>>,
    windows: State<'_, Arc<WindowManager>>,
) -> Settings {
    let saved = settings.save(pick_renderer_patch(&patch));
    windows.apply_settings(&saved);
    saved
}

#[tauri::command]
pub fn settings_set_layer_name(
    uid: String,
    layer: i64,
    name: String,
    settings: State<'_, Arc<SettingsStore>>,
) -> Vec<String> {
    if !is_keyboard_uid(&uid) {
        return Vec::new();
    }
    let current = settings.load().layer_names;
    let Some(layer) = usize::try_from(layer).ok().filter(|&l| l < MAX_LAYERS) else {
        return current.get(&uid).cloned().unwrap_or_default();
    };
    let layer_names = with_layer_name(&current, &uid, layer, &name);
    let names = layer_names.get(&uid).cloned().unwrap_or_default();
    settings.save(patch("layerNames", json!(layer_names)));
    names
}

#[tauri::command]
pub fn settings_forget_device(
    vendor_id: i64,
    product_id: i64,
    settings: State<'_, Arc<SettingsStore>>,
) -> Vec<GrantedDevice> {
    settings.forget_device(vendor_id, product_id)
}

#[tauri::command]
pub fn window_get_mode(windows: State<'_, Arc<WindowManager>>) -> WindowMode {
    windows.mode()
}

/// ウィンドウを作り直すので async にする(メインスレッドで作ろうとすると止まる)。
#[tauri::command]
pub async fn window_toggle_mode(app: AppHandle) -> WindowMode {
    let windows = app.state::<Arc<WindowManager>>();
    windows.toggle_mode();
    windows.mode()
}

#[tauri::command]
pub fn window_set_overlay_blur_active(active: bool, windows: State<'_, Arc<WindowManager>>) {
    windows.set_overlay_blur_active(active);
}

#[tauri::command]
pub fn window_set_ignore_mouse(ignore: bool, windows: State<'_, Arc<WindowManager>>) {
    windows.set_ignore_cursor_events(ignore);
}

#[tauri::command]
pub fn window_move_by(dx: f64, dy: f64, windows: State<'_, Arc<WindowManager>>) {
    if dx.is_finite() && dy.is_finite() {
        windows.move_by(dx, dy);
    }
}

#[tauri::command]
pub fn window_resize_by(dw: f64, dh: f64, windows: State<'_, Arc<WindowManager>>) {
    if dw.is_finite() && dh.is_finite() {
        windows.resize_by(dw, dh);
    }
}

/// 「手放した」の返事。待っているモード切り替えがあれば、そこで先へ進む。
#[tauri::command]
pub fn hid_released(windows: State<'_, Arc<WindowManager>>) {
    windows.note_hid_released();
}

/// Vial のインターフェースを並べる。`granted_only` なら一度許可したもの(VID/PID)だけ
/// ― WebHID の getDevices() と同じく、自動で繋ぐのは許可したものに限る。
#[tauri::command]
pub async fn hid_devices(app: AppHandle, granted_only: bool) -> Result<Vec<HidDeviceInfo>, String> {
    let hid = Arc::clone(&app.state::<Arc<HidBridge>>());
    let devices = spawn_blocking(move || hid.devices()).await.map_err(|e| e.to_string())?;
    if !granted_only {
        return Ok(devices);
    }
    let settings = app.state::<Arc<SettingsStore>>().load();
    Ok(devices
        .into_iter()
        .filter(|d| is_granted(&settings, d.vendor_id.into(), d.product_id.into()))
        .collect())
}

/// 選ばれたキーボードを覚える(次の起動から自動で繋ぐ)。
#[tauri::command]
pub fn hid_remember(
    vendor_id: i64,
    product_id: i64,
    name: String,
    settings: State<'_, Arc<SettingsStore>>,
) {
    settings.remember_device(vendor_id, product_id, &name);
}

/// 開いて、入力レポートを `on_report` に流す。閉じるのに使う番号を返す。
#[tauri::command]
pub async fn hid_open(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    on_report: Channel<Vec<u8>>,
) -> Result<u32, String> {
    let hid = Arc::clone(&app.state::<Arc<HidBridge>>());
    let owner = window.label().to_owned();
    spawn_blocking(move || hid.open(&owner, &path, on_report)).await.map_err(|e| e.to_string())?
}

/// 1 つのレポートを書く(先頭はレポート ID)。Bluetooth では書き終わるまで数十 ms 待つことがある。
#[tauri::command]
pub async fn hid_write(app: AppHandle, handle: u32, data: Vec<u8>) -> Result<(), String> {
    let hid = Arc::clone(&app.state::<Arc<HidBridge>>());
    spawn_blocking(move || hid.write(handle, &data)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn hid_close(handle: u32, hid: State<'_, Arc<HidBridge>>) {
    hid.close(handle);
}

/// 画面側の出来事。長いスタックがそのまま来るので、ログが 1 件で埋まらないように切る。
#[tauri::command]
pub fn log_report(level: String, message: String, detail: Option<String>) {
    if message.is_empty() {
        return;
    }
    let message = format!("renderer: {}", truncate(&message, LOG_MESSAGE_MAX));
    let detail = detail.map(|d| truncate(&d, LOG_DETAIL_MAX));
    if level == "info" {
        logfile::info(&message, detail.as_deref());
    } else {
        logfile::error(&message, detail.as_deref());
    }
}

fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// 設定パネルからログを開く。パスを出すだけでは、エクスプローラーを辿る手間が残る。
#[tauri::command]
pub fn log_open() {
    let Some(path) = logfile::path() else { return };
    let opener = if cfg!(windows) { "explorer" } else { "xdg-open" };
    if let Err(error) = std::process::Command::new(opener).arg(&path).spawn() {
        logfile::warn("ログを開けなかった", Some(&error.to_string()));
    }
}

/// 新しい版があるかを見る(インストーラーで入れたときだけ。ほかは Unsupported)。
/// `force` でなければ、少し前に確かめた結果を使う(updater.rs の CHECK_CACHE)。
#[tauri::command]
pub async fn update_check(force: bool) -> Result<UpdateStatus, String> {
    spawn_blocking(move || updater::check(force)).await.map_err(|e| e.to_string())?
}

/// 新しい版を落として入れ替え、起動し直す。うまくいけばこのアプリは終わる。
#[tauri::command]
pub async fn update_apply(app: AppHandle) -> Result<(), String> {
    let settings = Arc::clone(&app.state::<Arc<SettingsStore>>());
    spawn_blocking(move || {
        // まとめてある設定の書き込みを、終わる前に済ませる
        updater::apply(|| settings.flush())
    })
    .await
    .map_err(|e| e.to_string())??;
    logfile::info("更新を入れるために終わる", None);
    app.exit(0);
    Ok(())
}
