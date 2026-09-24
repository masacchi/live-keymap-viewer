//! キーボードとのraw HID(hidapi)。Electron版で画面のWebHIDがしていたことの代わり。
//!
//! Tauriの画面はWebView2で、WebHIDの許可や選択ダイアログを差し込む口が無い
//! (docs/ARCHITECTURE.md §2)。そこでHIDはRustで扱い、画面(TS)からはWebHIDと同じ形に
//! 見せる(src/renderer/src/hid/nativeHid.ts)。プロトコル(hid/vial.ts)・直列化と照合
//! (hid/transport.ts)・接続の管理(session/)はElectron版のものをそのまま使う。
//!
//! ここがするのは、Vialのインターフェースを並べる・開く・書く・届いたものを画面へ流す・
//! 挿し抜きを知らせる、だけ。応答の照合や時間切れはTS側の仕事。

use std::collections::HashMap;
use std::ffi::CString;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use hidapi::{DeviceInfo, HidApi, HidDevice};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

use crate::logfile;

/// Vialのraw HIDインターフェース(docs/PROTOCOL.md §1)。
const VIAL_USAGE_PAGE: u16 = 0xFF60;
const VIAL_USAGE: u16 = 0x61;
/// Vialのレポートの長さ。
const MSG_LEN: usize = 32;

/// 挿し抜きを見に行く間隔。hidapiには挿し抜きの通知が無いので、一覧を取り直して比べる。
/// 抜けたこと(使っていたもの)は読み取りの失敗ですぐ分かるので、これは主に「挿された」のため。
const SCAN_INTERVAL: Duration = Duration::from_secs(2);
/// 読み取りスレッドが、閉じられたかを確かめる間隔(ms)。閉じてから止まるまでの最長。
const READ_POLL_MS: i32 = 100;

/// 画面に渡すデバイスの情報。WebHIDのHIDDeviceのうち、アプリが使うところ。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDeviceInfo {
    /// OSのデバイスパス。開くときと、同じものかを見分けるのに使う。
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    /// 製品名。Bluetoothでは取れず空のことがある(docs/BLUETOOTH.md §2.6)。
    pub product_name: String,
    pub usage_page: u16,
    pub usage: u16,
}

impl HidDeviceInfo {
    fn from(device: &DeviceInfo) -> Self {
        Self {
            path: device.path().to_string_lossy().into_owned(),
            vendor_id: device.vendor_id(),
            product_id: device.product_id(),
            product_name: device.product_string().unwrap_or_default().to_owned(),
            usage_page: device.usage_page(),
            usage: device.usage(),
        }
    }
}

/// 開いているデバイス1つぶん。
///
/// hidapiのデバイスは1つのハンドルを複数のスレッドから同時に使えない(読むスレッドが
/// readで待っているあいだに書けない)。なので**読む用と書く用に2回開く**。
/// 入力レポートはOSがハンドルごとに配る(書く用に溜まるぶんは、OSの輪状のバッファが
/// 古い方から捨てる)。
struct OpenDevice {
    /// 開いたウィンドウ。ウィンドウが消えたら、そのウィンドウが開いたものを閉じる。
    owner: String,
    writer: Arc<Mutex<HidDevice>>,
    stop: Arc<AtomicBool>,
}

pub struct HidBridge {
    app: AppHandle,
    /// hidapiの本体。作れなかったらNoneのまま(次に使うときに作り直す)。
    api: Mutex<Option<HidApi>>,
    open: Mutex<HashMap<u32, OpenDevice>>,
    next_handle: AtomicU32,
    /// 前回並べたときの一覧。挿し抜きはこれとの差で知らせる。まだ並べていなければNone。
    known: Mutex<Option<Vec<HidDeviceInfo>>>,
    /// 挿し抜きを見に行くスレッドを、待たずに起こす。
    rescan: Mutex<Option<Sender<()>>>,
}

impl HidBridge {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            api: Mutex::new(None),
            open: Mutex::new(HashMap::new()),
            next_handle: AtomicU32::new(1),
            known: Mutex::new(None),
            rescan: Mutex::new(None),
        })
    }

    /// 挿し抜きを見に行くスレッドを動かす。挿されたら`hid-connect`、
    /// 抜かれたら`hid-disconnect`を全部のウィンドウに送る(中身はHidDeviceInfo)。
    pub fn start_monitor(self: &Arc<Self>) {
        let (sender, receiver) = mpsc::channel();
        *self.rescan.lock().unwrap() = Some(sender);
        let bridge = Arc::clone(self);
        thread::Builder::new()
            .name("hid-monitor".into())
            .spawn(move || {
                loop {
                    bridge.devices();
                    match receiver.recv_timeout(SCAN_INTERVAL) {
                        Ok(()) | Err(RecvTimeoutError::Timeout) => {
                            // まとめて来た「起こして」は1回で足りる
                            while receiver.try_recv().is_ok() {}
                        }
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .expect("hid-monitor のスレッドを作れなかった");
    }

    /// いま繋がっているVialのインターフェースを並べる。前回との差を挿し抜きとして知らせる。
    pub fn devices(&self) -> Vec<HidDeviceInfo> {
        let list = self.scan();
        self.notify_changes(&list);
        list
    }

    fn scan(&self) -> Vec<HidDeviceInfo> {
        let mut api = self.api.lock().unwrap();
        let Some(api) = ensure_api(&mut api) else {
            return Vec::new();
        };
        if let Err(error) = api.refresh_devices() {
            logfile::warn("HID の一覧を取り直せなかった", Some(&error.to_string()));
        }
        let mut list: Vec<HidDeviceInfo> = api
            .device_list()
            .filter(|d| d.usage_page() == VIAL_USAGE_PAGE && d.usage() == VIAL_USAGE)
            .map(HidDeviceInfo::from)
            .collect();
        list.sort_by(|a, b| a.path.cmp(&b.path));
        list.dedup_by(|a, b| a.path == b.path);
        list
    }

    fn notify_changes(&self, list: &[HidDeviceInfo]) {
        let mut known = self.known.lock().unwrap();
        // 初めて並べたときは比べる相手が無い(起動時に挿さっていたものは「挿された」ではない)
        let Some(previous) = known.replace(list.to_vec()) else { return };
        for gone in previous.iter().filter(|d| !list.iter().any(|now| now.path == d.path)) {
            let _ = self.app.emit("hid-disconnect", gone);
        }
        for added in list.iter().filter(|d| !previous.iter().any(|old| old.path == d.path)) {
            let _ = self.app.emit("hid-connect", added);
        }
    }

    /// 開いて、届いた入力レポートを`on_report`に流す。閉じるときに使う番号を返す。
    pub fn open(
        &self,
        owner: &str,
        path: &str,
        on_report: Channel<Vec<u8>>,
    ) -> Result<u32, String> {
        let c_path = CString::new(path).map_err(|_| "デバイスのパスが正しくない".to_owned())?;
        let (reader, writer) = {
            let mut api = self.api.lock().unwrap();
            let api = ensure_api(&mut api).ok_or("HID を使えない")?;
            let reader = api.open_path(&c_path).map_err(|e| e.to_string())?;
            let writer = api.open_path(&c_path).map_err(|e| e.to_string())?;
            (reader, writer)
        };
        let handle = self.next_handle.fetch_add(1, Ordering::Relaxed);
        let stop = Arc::new(AtomicBool::new(false));
        let rescan = self.rescan.lock().unwrap().clone();
        let reading = Arc::clone(&stop);
        thread::Builder::new()
            .name(format!("hid-read-{handle}"))
            .spawn(move || read_loop(&reader, &on_report, &reading, rescan))
            .map_err(|e| e.to_string())?;
        self.open.lock().unwrap().insert(
            handle,
            OpenDevice { owner: owner.to_owned(), writer: Arc::new(Mutex::new(writer)), stop },
        );
        Ok(handle)
    }

    /// 1つのレポートを書く。先頭の1バイトはレポートID(Vialは0)。
    pub fn write(&self, handle: u32, data: &[u8]) -> Result<(), String> {
        let writer = self
            .open
            .lock()
            .unwrap()
            .get(&handle)
            .map(|device| Arc::clone(&device.writer))
            .ok_or("デバイスが開かれていない")?;
        let device = writer.lock().unwrap();
        device.write(data).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn close(&self, handle: u32) {
        if let Some(device) = self.open.lock().unwrap().remove(&handle) {
            // 読み取りスレッドはREAD_POLL_MS以内に気付いて止まり、読む用のハンドルを閉じる
            device.stop.store(true, Ordering::Relaxed);
        }
    }

    /// ウィンドウが消えたときに、そのウィンドウが開いていたものを閉じる。
    /// 画面が閉じ忘れても(落ちた・リロードした)、ハンドルが残り続けないように。
    pub fn close_owned_by(&self, owner: &str) {
        let mut open = self.open.lock().unwrap();
        open.retain(|_, device| {
            let keep = device.owner != owner;
            if !keep {
                device.stop.store(true, Ordering::Relaxed);
            }
            keep
        });
    }
}

/// hidapiの本体を用意する。作れなければログに残してNone。
fn ensure_api(api: &mut Option<HidApi>) -> Option<&mut HidApi> {
    if api.is_none() {
        match HidApi::new() {
            Ok(created) => *api = Some(created),
            Err(error) => logfile::warn("HID を初期化できなかった", Some(&error.to_string())),
        }
    }
    api.as_mut()
}

fn read_loop(
    reader: &HidDevice,
    on_report: &Channel<Vec<u8>>,
    stop: &AtomicBool,
    rescan: Option<Sender<()>>,
) {
    // BluetoothのVialはレポートID込みで33バイトになる(docs/BLUETOOTH.md §2.6)。余裕を持たせる
    let mut buffer = [0u8; 64];
    while !stop.load(Ordering::Relaxed) {
        match reader.read_timeout(&mut buffer, READ_POLL_MS) {
            Ok(0) => {}
            Ok(length) => {
                if on_report.send(strip_report_id(&buffer[..length])).is_err() {
                    break; // 受け取る画面が無くなった
                }
            }
            Err(_) => {
                // 抜かれた・消えた。一覧を待たずに取り直して「抜かれた」を知らせる
                // (知らせを受けた画面は、待たずに切って繋ぎ直しに入る)
                if let Some(rescan) = &rescan {
                    let _ = rescan.send(());
                }
                break;
            }
        }
    }
}

/// レポートIDの0が先頭に付いて来たら外す。画面のWebHIDと同じく、中身の32バイトだけを渡す。
fn strip_report_id(data: &[u8]) -> Vec<u8> {
    match data {
        [0, rest @ ..] if rest.len() == MSG_LEN => rest.to_vec(),
        _ => data.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 先頭のレポート_id_は外す() {
        let mut with_id = vec![0u8];
        with_id.extend([0xFE; MSG_LEN]);
        assert_eq!(strip_report_id(&with_id), vec![0xFE; MSG_LEN]);
        // 32バイトちょうどならそのまま(先頭が0でも中身の一部)
        let mut plain = vec![0u8; MSG_LEN];
        plain[1] = 0x03;
        assert_eq!(strip_report_id(&plain), plain);
    }
}
