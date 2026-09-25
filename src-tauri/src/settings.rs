//! 設定の検証と、settings.jsonの読み書き。
//!
//! 設定ファイルは人が手で直すこともあるし、古い版のアプリが書いたものが残っていることもある。
//! 読み込んだ値は信用せず、項目ごとに検証し、不正な項目だけ既定値に戻す。
//!
//! 型・既定値・範囲は画面側のsrc/shared/settings.tsにもある(画面はそれで表示とスライダーの
//! 範囲を決める)。**範囲や既定値を変えるときは両方を直す。**検証そのものはこちらだけが行う。
//!
//! **ディスクへの書き込みはまとめる。**設定はスライダーからも来るので、つまみを1回動かすだけで
//! 十数回届く。値はその場でメモリに反映し、ファイルにはFLUSH_DELAYごとにまとめて書く。

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::logfile;

pub const MIN_WINDOW_WIDTH: f64 = 420.0;
pub const MIN_WINDOW_HEIGHT: f64 = 240.0;
/// これより薄くすると、操作パネルごと見えなくなって戻せなくなる。
const OVERLAY_OPACITY_MIN: f64 = 0.2;
/// 薄くしたときの濃さの上限。これより濃いと薄くした意味が無い。
const OVERLAY_FADED_OPACITY_MAX: f64 = 0.8;
const TAPPING_TERM_MIN: f64 = 100.0;
const TAPPING_TERM_MAX: f64 = 500.0;
/// レイヤー名の長さの上限(文字数)。ツールバーやキーの色帯に収まるように。
const LAYER_NAME_MAX_LENGTH: usize = 12;
/// 名前を持てるレイヤーの数。Vialの上限(32)に合わせる。
pub const MAX_LAYERS: usize = 32;

/// 画面から変えてよい項目。ウィンドウの位置・モード・許可したデバイス・レイヤー名は専用の手順で書く。
const RENDERER_SETTINGS_KEYS: [&str; 7] = [
    "labelMode",
    "tappingTerm",
    "overlayOpacity",
    "overlayAutoFade",
    "overlayFadedOpacity",
    "overlayBlur",
    "showLayerTriggers",
];

/// ディスクへの書き込みをまとめる間隔。
const FLUSH_DELAY: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowMode {
    Normal,
    Overlay,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LabelMode {
    Jis,
    Us,
}

/// ウィンドウの位置と大きさ(論理ピクセル)。
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub const DEFAULT_BOUNDS: Bounds = Bounds { x: 80, y: 80, width: 1180, height: 620 };

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantedDevice {
    pub vendor_id: i64,
    pub product_id: i64,
    /// デバイス名。人が見て分かるように持っておく。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub mode: WindowMode,
    pub label_mode: LabelMode,
    pub normal_bounds: Bounds,
    pub overlay_bounds: Bounds,
    pub overlay_opacity: f64,
    pub overlay_auto_fade: bool,
    pub overlay_faded_opacity: f64,
    pub overlay_blur: bool,
    pub show_layer_triggers: bool,
    pub tapping_term: i64,
    pub granted_devices: Vec<GrantedDevice>,
    pub layer_names: BTreeMap<String, Vec<String>>,
}

impl Default for Settings {
    fn default() -> Self {
        sanitize(&Value::Null)
    }
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn clamp_opacity(value: Option<&Value>) -> f64 {
    number(value).map_or(0.82, |n| n.clamp(OVERLAY_OPACITY_MIN, 1.0))
}

fn clamp_faded_opacity(value: Option<&Value>) -> f64 {
    number(value).map_or(0.2, |n| n.clamp(0.0, OVERLAY_FADED_OPACITY_MAX))
}

fn clamp_tapping_term(value: Option<&Value>) -> i64 {
    // QMKのTAPPING_TERMの既定値(engine/layerState.tsのDEFAULT_TAPPING_TERMと同じ)
    number(value).map_or(200, |n| n.clamp(TAPPING_TERM_MIN, TAPPING_TERM_MAX).round() as i64)
}

/// 4つとも数値ならBoundsにする(幅と高さは最小サイズまで広げる)。数値でなければNone。
fn sanitize_bounds(value: Option<&Value>) -> Option<Bounds> {
    let object = value?.as_object()?;
    let x = number(object.get("x"))?;
    let y = number(object.get("y"))?;
    let width = number(object.get("width"))?;
    let height = number(object.get("height"))?;
    Some(Bounds {
        x: x.round() as i32,
        y: y.round() as i32,
        width: width.round().max(MIN_WINDOW_WIDTH) as i32,
        height: height.round().max(MIN_WINDOW_HEIGHT) as i32,
    })
}

fn sanitize_devices(value: Option<&Value>) -> Vec<GrantedDevice> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            Some(GrantedDevice {
                vendor_id: object.get("vendorId")?.as_i64()?,
                product_id: object.get("productId")?.as_i64()?,
                name: object.get("name").and_then(Value::as_str).map(str::to_owned),
            })
        })
        .collect()
}

/// キーボードのUID(64ビットの10進数)か。layerNamesのキーにはこれしか使わない。
pub fn is_keyboard_uid(value: &str) -> bool {
    (1..=20).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_digit())
}

/// 名前を1つ整える。前後の空白を落とし、長すぎれば切る(文字の途中では切らない)。
fn sanitize_layer_name(value: &Value) -> String {
    value
        .as_str()
        .map(|name| name.trim().chars().take(LAYER_NAME_MAX_LENGTH).collect())
        .unwrap_or_default()
}

/// キーボード1台ぶんの名前の並びを整える。末尾の名前なしは落とす。何も残らなければNone。
fn sanitize_name_list(value: &Value) -> Option<Vec<String>> {
    let mut names: Vec<String> =
        value.as_array()?.iter().take(MAX_LAYERS).map(sanitize_layer_name).collect();
    while names.last().is_some_and(String::is_empty) {
        names.pop();
    }
    (!names.is_empty()).then_some(names)
}

fn sanitize_layer_names(value: Option<&Value>) -> BTreeMap<String, Vec<String>> {
    let Some(object) = value.and_then(Value::as_object) else {
        return BTreeMap::new();
    };
    object
        .iter()
        .filter(|(uid, _)| is_keyboard_uid(uid))
        .filter_map(|(uid, list)| Some((uid.clone(), sanitize_name_list(list)?)))
        .collect()
}

/// 何が入っていても、使えるSettingsにして返す。
pub fn sanitize(raw: &Value) -> Settings {
    let empty = Map::new();
    let value = raw.as_object().unwrap_or(&empty);
    Settings {
        mode: if value.get("mode") == Some(&json!("overlay")) {
            WindowMode::Overlay
        } else {
            WindowMode::Normal
        },
        label_mode: if value.get("labelMode") == Some(&json!("us")) {
            LabelMode::Us
        } else {
            LabelMode::Jis
        },
        normal_bounds: sanitize_bounds(value.get("normalBounds")).unwrap_or(DEFAULT_BOUNDS),
        overlay_bounds: sanitize_bounds(value.get("overlayBounds")).unwrap_or(DEFAULT_BOUNDS),
        overlay_opacity: clamp_opacity(value.get("overlayOpacity")),
        overlay_auto_fade: value.get("overlayAutoFade") != Some(&Value::Bool(false)),
        overlay_faded_opacity: clamp_faded_opacity(value.get("overlayFadedOpacity")),
        overlay_blur: value.get("overlayBlur") == Some(&Value::Bool(true)),
        show_layer_triggers: value.get("showLayerTriggers") == Some(&Value::Bool(true)),
        tapping_term: clamp_tapping_term(value.get("tappingTerm")),
        granted_devices: sanitize_devices(value.get("grantedDevices")),
        layer_names: sanitize_layer_names(value.get("layerNames")),
    }
}

/// 画面から来た変更を、変えてよい項目だけに絞る。値そのものの検証は、保存するときの
/// sanitizeに任せる(手で直したファイルと同じ扱い)。
pub fn pick_renderer_patch(value: &Value) -> Map<String, Value> {
    let Some(object) = value.as_object() else {
        return Map::new();
    };
    RENDERER_SETTINGS_KEYS
        .iter()
        .filter_map(|key| Some((key.to_string(), object.get(*key)?.clone())))
        .collect()
}

/// 1つのレイヤーの名前を変えたlayerNamesを返す(元は変えない)。空にすると名前を消す。
pub fn with_layer_name(
    all: &BTreeMap<String, Vec<String>>,
    uid: &str,
    layer: usize,
    name: &str,
) -> BTreeMap<String, Vec<String>> {
    let mut list = all.get(uid).cloned().unwrap_or_default();
    if list.len() <= layer {
        list.resize(layer + 1, String::new());
    }
    list[layer] = name.to_owned();
    let mut next = all.clone();
    match sanitize_name_list(&json!(list)) {
        Some(cleaned) => next.insert(uid.to_owned(), cleaned),
        None => next.remove(uid),
    };
    next
}

/// ウィンドウがどの画面にも十分に見えていなければ、主画面の中央に移す。
///
/// モニターを外したあとに起動すると、保存した位置が画面の外になることがある。
/// オーバーレイはクリックが透過するので、そうなると設定ファイルを手で直すしか
/// なくなる。タイトルバー相当(上端40pxほど)が見えていれば良しとする。
/// `work_areas`の先頭が主画面。
pub fn ensure_on_screen(bounds: Bounds, work_areas: &[Bounds]) -> Bounds {
    const GRIP: i32 = 40;
    let visible = work_areas.iter().any(|area| {
        let left = bounds.x.max(area.x);
        let right = (bounds.x + bounds.width).min(area.x + area.width);
        let top = bounds.y.max(area.y);
        let bottom = (bounds.y + GRIP).min(area.y + area.height);
        right - left >= GRIP && bottom - top >= GRIP / 2
    });
    let Some(primary) = work_areas.first().filter(|_| !visible) else {
        return bounds;
    };
    let width = bounds.width.min(primary.width);
    let height = bounds.height.min(primary.height);
    Bounds {
        x: primary.x + (primary.width - width) / 2,
        y: primary.y + (primary.height - height) / 2,
        width,
        height,
    }
}

/// settings.jsonの読み書き。値はメモリに持ち、ファイルにはまとめて書く。
pub struct SettingsStore {
    path: PathBuf,
    state: Mutex<StoreState>,
}

struct StoreState {
    cached: Option<Settings>,
    /// まだディスクに書いていない変更があるか。
    unsaved: bool,
    /// 書き込みの予約が入っているか。
    flush_scheduled: bool,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            path,
            state: Mutex::new(StoreState { cached: None, unsaved: false, flush_scheduled: false }),
        })
    }

    pub fn load(&self) -> Settings {
        let mut state = self.state.lock().unwrap();
        state.cached.get_or_insert_with(|| self.read()).clone()
    }

    fn read(&self) -> Settings {
        // ファイルが無い・壊れているときは既定値で始める
        let raw = std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(Value::Null);
        sanitize(&raw)
    }

    /// いまの設定にpatchを重ねて、検証してから保存する。保存した設定を返す。
    pub fn save(self: &Arc<Self>, patch: Map<String, Value>) -> Settings {
        let mut state = self.state.lock().unwrap();
        let current = state.cached.get_or_insert_with(|| self.read());
        let mut merged = match serde_json::to_value(&*current) {
            Ok(Value::Object(object)) => object,
            _ => Map::new(),
        };
        merged.extend(patch);
        let next = sanitize(&Value::Object(merged));
        state.cached = Some(next.clone());
        state.unsaved = true;
        if !state.flush_scheduled {
            state.flush_scheduled = true;
            let store = Arc::clone(self);
            std::thread::spawn(move || {
                std::thread::sleep(FLUSH_DELAY);
                store.flush();
            });
        }
        next
    }

    /// 溜めていた変更をディスクに書く。終了時にも呼ぶ(最後の400msぶんを失わないため)。
    /// 書けなくてもアプリは止めない。設定が1回保存されないだけなので、ログに残して次に任せる。
    pub fn flush(&self) {
        let snapshot = {
            let mut state = self.state.lock().unwrap();
            state.flush_scheduled = false;
            if !state.unsaved {
                return;
            }
            state.unsaved = false;
            state.cached.clone()
        };
        let Some(settings) = snapshot else { return };
        if let Err(error) = self.write(&settings) {
            logfile::warn("設定を保存できなかった", Some(&error.to_string()));
        }
    }

    fn write(&self, settings: &Settings) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // 書き込み途中で落ちても壊れたファイルが残らないよう、別名に書いてから差し替える
        let temp = self.path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
        std::fs::write(&temp, format!("{text}\n"))?;
        std::fs::rename(&temp, &self.path)
    }

    pub fn remember_device(self: &Arc<Self>, vendor_id: i64, product_id: i64, name: &str) {
        let settings = self.load();
        if is_granted(&settings, vendor_id, product_id) {
            return;
        }
        let mut devices = settings.granted_devices;
        devices.push(GrantedDevice { vendor_id, product_id, name: Some(name.to_owned()) });
        self.save(patch("grantedDevices", json!(devices)));
    }

    pub fn forget_device(self: &Arc<Self>, vendor_id: i64, product_id: i64) -> Vec<GrantedDevice> {
        let devices: Vec<GrantedDevice> = self
            .load()
            .granted_devices
            .into_iter()
            .filter(|d| d.vendor_id != vendor_id || d.product_id != product_id)
            .collect();
        self.save(patch("grantedDevices", json!(devices))).granted_devices
    }
}

pub fn is_granted(settings: &Settings, vendor_id: i64, product_id: i64) -> bool {
    settings.granted_devices.iter().any(|d| d.vendor_id == vendor_id && d.product_id == product_id)
}

/// 1項目だけのpatchを作る。
pub fn patch(key: &str, value: Value) -> Map<String, Value> {
    Map::from_iter([(key.to_owned(), value)])
}

#[cfg(test)]
mod tests {
    use super::*;

    const UID: &str = "16882930253541522617";

    #[test]
    fn 壊れた入力は既定値になる() {
        let defaults = Settings::default();
        assert_eq!(sanitize(&json!("garbage")), defaults);
        assert_eq!(sanitize(&json!([])), defaults);
        assert_eq!(defaults.mode, WindowMode::Normal);
        assert_eq!(defaults.label_mode, LabelMode::Jis);
        assert_eq!(defaults.normal_bounds, DEFAULT_BOUNDS);
        assert_eq!(defaults.overlay_opacity, 0.82);
        assert!(defaults.overlay_auto_fade);
        assert_eq!(defaults.tapping_term, 200);
    }

    #[test]
    fn 正しい値はそのまま通す() {
        let raw = json!({
            "mode": "overlay",
            "labelMode": "us",
            "normalBounds": { "x": 10, "y": 20, "width": 800, "height": 400 },
            "overlayBounds": { "x": -1200, "y": 0, "width": 600, "height": 300 },
            "overlayOpacity": 0.5,
            "overlayAutoFade": false,
            "overlayFadedOpacity": 0.3,
            "overlayBlur": true,
            "showLayerTriggers": true,
            "tappingTerm": 250,
            "grantedDevices": [{ "vendorId": 0xE118, "productId": 1, "name": "Cornix" }],
            "layerNames": { UID: ["基本", "", "記号"] }
        });
        let settings = sanitize(&raw);
        // 書き出したものを読み直しても同じになる(ファイルの往復で値が変わらない)
        assert_eq!(serde_json::to_value(&settings).unwrap(), raw);
    }

    #[test]
    fn 範囲外の値は丸め_型が違えば既定値() {
        let settings = sanitize(&json!({
            "overlayOpacity": 0,
            "overlayFadedOpacity": 5,
            "tappingTerm": 233.4,
            "overlayAutoFade": "no",
            "overlayBlur": "yes",
            "normalBounds": { "x": 0, "y": 0, "width": 10, "height": 10 },
            "overlayBounds": { "x": 0, "y": 0 }
        }));
        assert_eq!(settings.overlay_opacity, OVERLAY_OPACITY_MIN);
        assert_eq!(settings.overlay_faded_opacity, OVERLAY_FADED_OPACITY_MAX);
        assert_eq!(settings.tapping_term, 233);
        assert!(settings.overlay_auto_fade);
        assert!(!settings.overlay_blur);
        assert_eq!(settings.normal_bounds, Bounds { x: 0, y: 0, width: 420, height: 240 });
        assert_eq!(settings.overlay_bounds, DEFAULT_BOUNDS);
        assert_eq!(sanitize(&json!({ "tappingTerm": 9999 })).tapping_term, 500);
        assert_eq!(sanitize(&json!({ "tappingTerm": "300" })).tapping_term, 200);
    }

    #[test]
    fn 知らない項目は落とす() {
        let value = serde_json::to_value(sanitize(&json!({ "evil": true }))).unwrap();
        assert!(value.get("evil").is_none());
    }

    #[test]
    fn 許可したデバイスは整数の_vid_pid_だけ残す() {
        let settings = sanitize(&json!({
            "grantedDevices": [
                { "vendorId": 1, "productId": 2 },
                { "vendorId": "1", "productId": 2 },
                "junk"
            ]
        }));
        assert_eq!(
            settings.granted_devices,
            vec![GrantedDevice { vendor_id: 1, product_id: 2, name: None }]
        );
    }

    #[test]
    fn レイヤー名を整える() {
        let long = "あ".repeat(20);
        let settings = sanitize(&json!({
            "layerNames": { UID: [format!(" {long} "), 42, "", ""], "not-a-uid": ["x"], "123": [] }
        }));
        assert_eq!(settings.layer_names.len(), 1);
        assert_eq!(settings.layer_names[UID], vec!["あ".repeat(12)]);
    }

    #[test]
    fn レイヤー名を付け外しする() {
        let named = with_layer_name(&BTreeMap::new(), UID, 2, "記号");
        assert_eq!(named[UID], vec!["", "", "記号"]);
        assert_eq!(with_layer_name(&named, UID, 0, "基本")[UID], vec!["基本", "", "記号"]);
        assert!(with_layer_name(&named, UID, 2, "  ").is_empty());
    }

    #[test]
    fn 画面からは決めた項目しか変えられない() {
        let patch = pick_renderer_patch(&json!({
            "overlayOpacity": 0.5,
            "mode": "overlay",
            "grantedDevices": [],
            "normalBounds": { "x": 0, "y": 0, "width": 800, "height": 600 }
        }));
        assert_eq!(Value::Object(patch), json!({ "overlayOpacity": 0.5 }));
        assert!(pick_renderer_patch(&json!("junk")).is_empty());
    }

    #[test]
    fn 画面の中にあればそのまま() {
        let primary = Bounds { x: 0, y: 0, width: 1920, height: 1040 };
        let secondary = Bounds { x: 1920, y: 0, width: 1280, height: 1000 };
        let bounds = Bounds { x: 2000, y: 100, width: 800, height: 400 };
        assert_eq!(ensure_on_screen(bounds, &[primary, secondary]), bounds);
        assert_eq!(ensure_on_screen(bounds, &[]), bounds);
    }

    #[test]
    fn 外したモニターの上なら主画面の中央に戻す() {
        let primary = Bounds { x: 0, y: 0, width: 1920, height: 1040 };
        let bounds = Bounds { x: 3000, y: 100, width: 800, height: 400 };
        assert_eq!(
            ensure_on_screen(bounds, &[primary]),
            Bounds { x: 560, y: 320, width: 800, height: 400 }
        );
        // 画面より大きければ画面に収める
        let huge = Bounds { x: -5000, y: 0, width: 4000, height: 3000 };
        assert_eq!(ensure_on_screen(huge, &[primary]), primary);
    }

    #[test]
    fn まとめて書き_読み直せる() {
        let dir = std::env::temp_dir().join(format!("lkv-settings-{}", std::process::id()));
        let path = dir.join("settings.json");
        let store = SettingsStore::new(path.clone());
        store.save(patch("overlayOpacity", json!(0.5)));
        store.remember_device(1, 2, "Cornix");
        store.remember_device(1, 2, "Cornix"); // 同じものは足さない
        store.flush();
        let reread = SettingsStore::new(path);
        let settings = reread.load();
        assert_eq!(settings.overlay_opacity, 0.5);
        assert_eq!(settings.granted_devices.len(), 1);
        assert!(reread.forget_device(1, 2).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
