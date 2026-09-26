//! 画面(WebView)から呼ばれるコマンド。
//!
//! 画面から来た値は、ここで範囲を確認してから使う(型はTauriが確認し、合わなければ
//! 呼び出しが失敗する)。画面が使うものだけを置く。呼び出す側はsrc/renderer/src/platform/tauri.ts。
//!
//! 引数の名前は画面からはcamelCaseで渡す(`vendor_id`なら`vendorId`)。
//!
//! 待つ処理(HIDの読み書き・一覧・ウィンドウの作り直し)はasyncにしてメインスレッドの外で動かす。
//! asyncでないコマンドはメインスレッドで動くので、そこで待つと画面ごと止まる。

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
    patch, pick_renderer_patch, remembered_name, with_layer_name,
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

/// 変えてよい項目だけを取り出し、値は保存するときに確認する。ウィンドウに効くものはその場で反映する。
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

/// ウィンドウを作り直すのでasyncにする(メインスレッドで作ろうとすると止まる)。
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

/// 画面がキーボードを解放したという知らせ。待っているモード切り替えがあれば、ここで先へ進める。
#[tauri::command]
pub fn hid_released(windows: State<'_, Arc<WindowManager>>) {
    windows.note_hid_released();
}

/// Vialのインターフェースの一覧を返す。`granted_only`なら、一度許可したもの(VID/PID)に絞る。
/// 自動で接続するのは許可したものに限るため(WebHIDの`getDevices()`と同じ)。
///
/// 名前が取れないもの(Bluetoothでは空のことがある)は、許可したときに覚えた名前で補う。
/// 選ぶ画面に「名前なし」と出ると、どれが自分のキーボードか分からないため(docs/BLUETOOTH.md P2)。
#[tauri::command]
pub async fn hid_devices(app: AppHandle, granted_only: bool) -> Result<Vec<HidDeviceInfo>, String> {
    let hid = Arc::clone(&app.state::<Arc<HidBridge>>());
    let devices = spawn_blocking(move || hid.devices()).await.map_err(|e| e.to_string())?;
    let settings = app.state::<Arc<SettingsStore>>().load();
    Ok(devices
        .into_iter()
        .filter(|d| !granted_only || is_granted(&settings, d.vendor_id.into(), d.product_id.into()))
        .map(|mut d| {
            if d.product_name.is_empty()
                && let Some(name) =
                    remembered_name(&settings, d.vendor_id.into(), d.product_id.into())
            {
                d.product_name = name.to_owned();
            }
            d
        })
        .collect())
}

/// 選ばれたキーボードを覚える(次の起動から自動で接続する)。
#[tauri::command]
pub fn hid_remember(
    vendor_id: i64,
    product_id: i64,
    name: String,
    settings: State<'_, Arc<SettingsStore>>,
) {
    settings.remember_device(vendor_id, product_id, &name);
}

/// デバイスを開き、届いた入力レポートを`on_report`に流す。閉じるときに使う番号を返す。
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

/// 1つのレポートを書く(先頭はレポートID)。Bluetoothでは書き終わるまで数十ms待つことがある。
#[tauri::command]
pub async fn hid_write(app: AppHandle, handle: u32, data: Vec<u8>) -> Result<(), String> {
    let hid = Arc::clone(&app.state::<Arc<HidBridge>>());
    spawn_blocking(move || hid.write(handle, &data)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn hid_close(handle: u32, hid: State<'_, Arc<HidBridge>>) {
    hid.close(handle);
}

/// 画面で起きたことをログに残す。スタックトレースが長いまま来るので、
/// 1件でログが埋まらないように切り詰める。
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

/// 設定パネルからログを開く。パスを見せるだけだと、エクスプローラーでたどる手間が残るため。
#[tauri::command]
pub fn log_open() {
    let Some(path) = logfile::path() else { return };
    let opener = if cfg!(windows) { "explorer" } else { "xdg-open" };
    if let Err(error) = std::process::Command::new(opener).arg(&path).spawn() {
        logfile::warn("ログを開けなかった", Some(&error.to_string()));
    }
}

/// 新しい版があるかを見る(インストーラーで入れたときだけ。ほかはUnsupported)。
/// `force`でなければ、少し前に確認した結果を使う(updater.rsのCHECK_CACHE)。
#[tauri::command]
pub async fn update_check(force: bool) -> Result<UpdateStatus, String> {
    spawn_blocking(move || updater::check(force)).await.map_err(|e| e.to_string())?
}

/// 新しい版をダウンロードして入れ替え、起動し直す。成功するとこのプロセスは終了する。
#[tauri::command]
pub async fn update_apply(app: AppHandle) -> Result<(), String> {
    let settings = Arc::clone(&app.state::<Arc<SettingsStore>>());
    spawn_blocking(move || {
        // まだ書き込んでいない設定を、終了する前に書き出す
        updater::apply(|| settings.flush())
    })
    .await
    .map_err(|e| e.to_string())??;
    logfile::info("更新を適用するため終了する", None);
    app.exit(0);
    Ok(())
}
