//! キーボードとのraw HID(hidapi)。
//!
//! 画面(WebView2)にはWebHIDの許可や選択ダイアログを差し込む口が無いので、HIDはRustで扱い、
//! 画面からはWebHIDと同じ形に見せる(src/renderer/src/hid/nativeHid.ts)。プロトコル(hid/vial.ts)・
//! 直列化と照合(hid/transport.ts)・接続の管理(session/)はTS側にある(docs/ARCHITECTURE.md §2)。
//!
//! ここでするのは、Vialのインターフェースの一覧・開く・書く・届いたレポートを画面へ流す・
//! 抜き差しを知らせる、だけ。応答の照合やタイムアウトはTS側で扱う。

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

/// 抜き差しを確認する間隔。hidapiには抜き差しの通知が無いので、一覧を取り直して比べる。
/// 使っていたデバイスが抜けたことは読み取りの失敗ですぐ分かるので、これは主に「挿された」ことを知るため。
const SCAN_INTERVAL: Duration = Duration::from_secs(2);
/// 読み取りスレッドが、閉じられたかを確認する間隔(ms)。閉じてからスレッドが止まるまで最長でこれだけかかる。
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
    /// 画面に渡す一覧(commands.rsのhid_devices)では、空なら覚えている名前で補う。
    pub product_name: String,
    pub usage_page: u16,
    pub usage: u16,
    /// Bluetooth(BLE)で接続しているか。同じキーボードがUSBとBTの両方で見えるとき、
    /// 選ぶ画面で見分けられるようにする。
    pub bluetooth: bool,
}

impl HidDeviceInfo {
    fn from(device: &DeviceInfo) -> Self {
        let path = device.path().to_string_lossy().into_owned();
        Self {
            bluetooth: is_bluetooth_path(&path),
            path,
            vendor_id: device.vendor_id(),
            product_id: device.product_id(),
            product_name: device.product_string().unwrap_or_default().to_owned(),
            usage_page: device.usage_page(),
            usage: device.usage(),
        }
    }
}

/// デバイスのパスがBluetooth(BLE)のものか。WindowsのBLEのHIDは、パスにHID over GATTのサービス
/// (UUID 0x1812)を含む(`\\?\HID#{00001812-0000-1000-8000-00805f9b34fb}_Dev_VID&02e118_…`)。
fn is_bluetooth_path(path: &str) -> bool {
    path.to_ascii_lowercase().contains("{00001812")
}

/// 開いているデバイス1つぶん。
///
/// hidapiのデバイスは、1つのハンドルを複数のスレッドから同時に使えない(読むスレッドが
/// readで待っているあいだは書けない)。そこで**読む用と書く用に2回開く**。
/// 入力レポートはOSがハンドルごとに配る(書く用のハンドルに溜まるぶんは、OSのリングバッファが
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
    /// 前回取った一覧。抜き差しはこれとの差で知らせる。まだ一度も取っていなければNone。
    known: Mutex<Option<Vec<HidDeviceInfo>>>,
    /// 抜き差しを確認するスレッドを、間隔を待たずに起こす。
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

    /// 抜き差しを確認するスレッドを動かす。挿されたら`hid-connect`、
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
                            // 続けて届いた起こす合図は、1回ぶんで足りる
                            while receiver.try_recv().is_ok() {}
                        }
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .expect("hid-monitorのスレッドを作れなかった");
    }

    /// いま接続されているVialのインターフェースの一覧を返す。前回との差は抜き差しとして知らせる。
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
            logfile::warn("HIDの一覧を取り直せなかった", Some(&error.to_string()));
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
        // 初回は比べる相手が無い(起動時に挿さっていたものは「挿された」として知らせない)
        let Some(previous) = known.replace(list.to_vec()) else { return };
        for gone in previous.iter().filter(|d| !list.iter().any(|now| now.path == d.path)) {
            let _ = self.app.emit("hid-disconnect", gone);
        }
        for added in list.iter().filter(|d| !previous.iter().any(|old| old.path == d.path)) {
            let _ = self.app.emit("hid-connect", added);
        }
    }

    /// デバイスを開き、届いた入力レポートを`on_report`に流す。閉じるときに使う番号を返す。
    pub fn open(
        &self,
        owner: &str,
        path: &str,
        on_report: Channel<Vec<u8>>,
    ) -> Result<u32, String> {
        let c_path = CString::new(path).map_err(|_| "デバイスのパスが正しくない".to_owned())?;
        let (reader, writer) = {
            let mut api = self.api.lock().unwrap();
            let api = ensure_api(&mut api).ok_or("HIDを使えない")?;
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

    /// ウィンドウが閉じたときに、そのウィンドウが開いていたデバイスを閉じる。
    /// 画面が閉じずに終わっても(エラーやリロード)、ハンドルが残り続けないようにするため。
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
            Err(error) => logfile::warn("HIDを初期化できなかった", Some(&error.to_string())),
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
                // 抜かれたか、デバイスが消えた。次の確認を待たずに一覧を取り直して画面に知らせる
                // (画面はすぐに切断して再接続を始める)
                if let Some(rescan) = &rescan {
                    let _ = rescan.send(());
                }
                break;
            }
        }
    }
}

/// 先頭にレポートIDの0が付いていたら外す。WebHIDと同じく、中身の32バイトだけを画面に渡す。
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
    fn bluetoothのパスを見分ける() {
        assert!(is_bluetooth_path(
            r"\\?\HID#{00001812-0000-1000-8000-00805F9B34FB}_Dev_VID&02e118_PID&0001&Col03#9&1"
        ));
        assert!(!is_bluetooth_path(r"\\?\HID#VID_E118&PID_0001&MI_01#8&2"));
    }

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
