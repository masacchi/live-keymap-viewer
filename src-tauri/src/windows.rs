//! ウィンドウの管理。通常ウィンドウとクリック透過オーバーレイを作り分ける。
//!
//! 透明ウィンドウは作った後から切り替えられないので、モードを変えるたびに
//! ウィンドウを作り直し、位置とサイズを引き継ぐ。
//!
//! **ロックを持ったままウィンドウの操作を呼ばない。** Tauri のウィンドウ操作は、メインスレッド
//! 以外から呼ぶとメインスレッドに頼んで返事を待つ。ロックを持ったまま待つと、メインスレッドで
//! 同じロックを待つ処理(コマンドやウィンドウのイベント)と互いに待ち合って止まる。
//! 状態はロックの中で読み書きし、ウィンドウの操作はロックを放してから行う。

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde_json::json;
use tauri::webview::PageLoadEvent;
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Theme, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::hid::HidBridge;
use crate::logfile;
use crate::settings::{
    Bounds, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, Settings, SettingsStore, WindowMode,
    ensure_on_screen, patch,
};

/// モードを切り替えるとき、古いウィンドウがキーボードを手放すのを待つ上限。
/// 返事が無くても先へ進む(画面が応答できない状態でも切り替えは効かせる)。
const HID_RELEASE_TIMEOUT: Duration = Duration::from_millis(600);

/// クリック透過中に、カーソルの位置を画面へ送る間隔(下の start_cursor_forwarding)。
const CURSOR_FORWARD_INTERVAL: Duration = Duration::from_millis(33);

/// 通常ウィンドウの背景(styles.css の地の色)。読み込むまでの一瞬に白が出ないように。
const NORMAL_BACKGROUND: Color = Color(0x11, 0x15, 0x1a, 0xff);

/// WebView2 に渡す起動オプション。
///
/// 隠れていてもタイマーを間引かせない。Chromium の既定では、最小化や完全に隠れたときに
/// タイマーが 1 秒に 1 回まで間引かれ、20ms の matrix ポーリングが止まったも同然になる。
/// その間の TG / DF を取りこぼし、戻ったときに表示するレイヤーがずれる(Electron 版の
/// backgroundThrottling: false と同じ目的)。Tauri の background_throttling は Windows では
/// 効かないので、Chromium のスイッチで止める。
///
/// 先頭の --disable-features は wry が既定で渡しているもの。ここで上書きすると消えるので書き直す
/// (IntensiveWakeUpThrottling は隠れて 5 分たつと 1 分に 1 回まで間引く仕組み)。
/// 全ウィンドウで同じにすること ― WebView2 は同じデータフォルダを違うオプションで開けない。
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IntensiveWakeUpThrottling \
    --disable-background-timer-throttling --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows";

pub struct WindowManager {
    app: AppHandle,
    settings: Arc<SettingsStore>,
    hid: Arc<HidBridge>,
    state: Mutex<State>,
}

struct State {
    /// いま表示しているウィンドウ。モードの切り替え中は、新しいものができるまで古い方。
    window: Option<WebviewWindow>,
    current_mode: WindowMode,
    /// いま画面に出ているウィンドウを作ったときのモード。切り替えの途中は current_mode と食い違う。
    live_mode: WindowMode,
    /// 古いウィンドウの「手放した」を待っているあいだ、その知らせを送る口。
    handover: Option<Sender<()>>,
    /// 切り替えの番号。連打で前の切り替えを取り消すのに使う。
    handover_generation: u64,
    /// 画面が図を濃く出しているか(薄くしているあいだは後ろをぼかさない)。
    blur_active: bool,
    /// いまウィンドウに掛けているぼかし。掛けていない(通常ウィンドウ)なら None。
    blur_on: Option<bool>,
    /// オーバーレイがクリックを透過させているか。
    ignoring_cursor: bool,
    /// 作ったウィンドウの数。ラベル(main-1, main-2, …)に使う。
    created: u32,
}

impl WindowManager {
    pub fn new(app: AppHandle, settings: Arc<SettingsStore>, hid: Arc<HidBridge>) -> Arc<Self> {
        Arc::new(Self {
            app,
            settings,
            hid,
            state: Mutex::new(State {
                window: None,
                current_mode: WindowMode::Normal,
                live_mode: WindowMode::Normal,
                handover: None,
                handover_generation: 0,
                blur_active: true,
                blur_on: None,
                ignoring_cursor: false,
                created: 0,
            }),
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn mode(&self) -> WindowMode {
        self.lock().current_mode
    }

    fn current(&self) -> Option<WebviewWindow> {
        self.lock().window.clone()
    }

    /// 起動時に、前回のモードで開く。
    pub fn open(self: &Arc<Self>) {
        let settings = self.settings.load();
        self.lock().current_mode = settings.mode;
        let bounds = match settings.mode {
            WindowMode::Overlay => settings.overlay_bounds,
            WindowMode::Normal => settings.normal_bounds,
        };
        let window = self.create(settings.mode, bounds, None);
        self.lock().window = window;
    }

    pub fn toggle_mode(self: &Arc<Self>) {
        let next = match self.mode() {
            WindowMode::Normal => WindowMode::Overlay,
            WindowMode::Overlay => WindowMode::Normal,
        };
        self.set_mode(next);
    }

    /// 位置とサイズを引き継いだままモードを切り替える。
    ///
    /// 透明ウィンドウは作り直すしかないので、新しいウィンドウの画面は、できた瞬間から
    /// 同じキーボードを開きに行く。古い方はまだ 20ms ごとに matrix を読んでいて、raw HID の
    /// 応答は同じデバイスを開いている**全員**に配られる。Vial コマンド(`0xFE`)は応答を
    /// 照合できない(hid/vial.ts)ので、両方が話していると新しい方の読み込みが壊れる。
    /// 先に古い方へ手放させてから作る。
    pub fn set_mode(self: &Arc<Self>, next: WindowMode) {
        let old = self.current();
        if next == self.mode() && old.is_some() {
            return;
        }
        let bounds =
            old.as_ref().and_then(bounds_of).unwrap_or_else(|| self.settings.load().normal_bounds);
        let mut saved = patch("mode", json!(next));
        saved.insert(bounds_key(next).into(), json!(bounds));
        self.settings.save(saved);

        let (generation, released) = {
            let mut state = self.lock();
            state.current_mode = next;
            // 途中だった切り替えは取り消す(連打)。取り消した結果、出ているウィンドウが
            // そのまま目的のモードなら、作り直さない
            state.handover = None;
            state.handover_generation += 1;
            if old.is_some() && next == state.live_mode {
                return;
            }
            let (sender, receiver) = mpsc::channel();
            state.handover = Some(sender);
            (state.handover_generation, receiver)
        };

        if let Some(old) = &old {
            let _ = self.app.emit_to(old.label(), "hid-release", ());
        }
        let manager = Arc::clone(self);
        thread::spawn(move || {
            if old.is_some() {
                // 返事か時間切れで先へ進む。取り消されたら口が閉じるので、すぐ戻ってくる
                let _ = released.recv_timeout(HID_RELEASE_TIMEOUT);
            }
            {
                let mut state = manager.lock();
                if state.handover_generation != generation {
                    return; // 取り消された
                }
                state.handover = None;
            }
            let window = manager.create(next, bounds, old);
            if window.is_some() {
                manager.lock().window = window;
            }
        });
    }

    /// 画面が「手放した」と言ってきた。待っている切り替えがあれば先へ進む。
    pub fn note_hid_released(&self) {
        if let Some(sender) = self.lock().handover.take() {
            let _ = sender.send(());
        }
    }

    /// 保存した設定のうち、ウィンドウに効くもの(後ろのぼかし)を反映する。
    /// 通常ウィンドウでは何もしない(次にオーバーレイを作るときに使う)。
    ///
    /// 濃さ(overlayOpacity)はウィンドウには掛けず、画面が中身に掛ける(App.tsx)。
    /// ウィンドウごと薄くすると、ぼかしも薄くなって、ぼけていない後ろの画面が透けるため。
    pub fn apply_settings(&self, settings: &Settings) {
        self.apply_blur(settings);
    }

    /// 画面から: いま図を濃く出しているか。薄くしているあいだはぼかしを外す。
    pub fn set_overlay_blur_active(&self, active: bool) {
        {
            let mut state = self.lock();
            if active == state.blur_active {
                return;
            }
            state.blur_active = active;
        }
        self.apply_blur(&self.settings.load());
    }

    fn apply_blur(&self, settings: &Settings) {
        let (window, on) = {
            let mut state = self.lock();
            if state.current_mode != WindowMode::Overlay {
                return;
            }
            let Some(window) = state.window.clone() else { return };
            let on = settings.overlay_blur && state.blur_active;
            // 同じ材質を掛け直さない。濃さのスライダーを動かすと設定の更新が毎回ここに来るが、
            // OS 側の切り替えは安くない
            if state.blur_on == Some(on) {
                return;
            }
            state.blur_on = Some(on);
            (window, on)
        };
        set_backdrop(&window, on);
    }

    /// オーバーレイのクリック透過を切り替える(操作パネルの上だけ切る)。
    pub fn set_ignore_cursor_events(&self, ignore: bool) {
        let window = {
            let mut state = self.lock();
            if state.current_mode != WindowMode::Overlay {
                return;
            }
            state.ignoring_cursor = ignore;
            state.window.clone()
        };
        if let Some(window) = window {
            let _ = window.set_ignore_cursor_events(ignore);
        }
    }

    /// クリック透過中も、カーソルの位置を画面へ送り続ける。
    ///
    /// 画面は、ポインタが操作パネル(`data-interactive`)の上に来たときだけ透過を切る
    /// (components/OverlayControls.tsx)。Electron は透過中でも mousemove を画面に届けて
    /// くれた(`setIgnoreMouseEvents(true, { forward: true })`)が、Tauri にはその機能が無い。
    /// 透過中は画面に何も届かないので、ここでカーソルの位置を読んで `overlay-cursor` で送り、
    /// 画面側で mousemove として流す(src/renderer/src/platform/tauri.ts)。
    /// 透過を切っているあいだは本物の mousemove が届くので送らない。
    pub fn start_cursor_forwarding(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        thread::Builder::new()
            .name("overlay-cursor".into())
            .spawn(move || {
                let mut last = None;
                loop {
                    thread::sleep(CURSOR_FORWARD_INTERVAL);
                    let window = {
                        let state = manager.lock();
                        let forwarding = state.current_mode == WindowMode::Overlay
                            && state.live_mode == WindowMode::Overlay
                            && state.ignoring_cursor;
                        if forwarding { state.window.clone() } else { None }
                    };
                    let point = window.as_ref().and_then(cursor_in);
                    if point.is_none() || point == last {
                        last = point;
                        continue;
                    }
                    last = point;
                    if let (Some(window), Some(point)) = (window, point) {
                        let _ = manager.app.emit_to(window.label(), "overlay-cursor", point);
                    }
                }
            })
            .expect("overlay-cursor のスレッドを作れなかった");
    }

    /// ウィンドウを相対移動する(論理ピクセル)。オーバーレイのつまみから使う。
    pub fn move_by(&self, dx: f64, dy: f64) {
        let Some(window) = self.current() else { return };
        let (Ok(scale), Ok(position)) = (window.scale_factor(), window.outer_position()) else {
            return;
        };
        let position = position.to_logical::<f64>(scale);
        let _ = window.set_position(LogicalPosition::new(
            (position.x + dx).round(),
            (position.y + dy).round(),
        ));
    }

    /// ウィンドウの大きさを相対変更する(論理ピクセル)。
    pub fn resize_by(&self, dw: f64, dh: f64) {
        let Some(window) = self.current() else { return };
        let (Ok(scale), Ok(size)) = (window.scale_factor(), window.inner_size()) else {
            return;
        };
        let size = size.to_logical::<f64>(scale);
        let _ = window.set_size(LogicalSize::new(
            (size.width + dw).round().max(MIN_WINDOW_WIDTH),
            (size.height + dh).round().max(MIN_WINDOW_HEIGHT),
        ));
    }

    /// ウィンドウを作る。`replacing` は、新しい方が出たら消す古いウィンドウ(ちらつかせない)。
    fn create(
        self: &Arc<Self>,
        mode: WindowMode,
        requested: Bounds,
        replacing: Option<WebviewWindow>,
    ) -> Option<WebviewWindow> {
        let overlay = mode == WindowMode::Overlay;
        let settings = self.settings.load();
        let label = {
            let mut state = self.lock();
            state.created += 1;
            state.live_mode = mode;
            // 作り直したウィンドウにはまだ何も掛けていない。オーバーレイの画面は、読み込むまで
            // 図を濃く出している(薄くするのは接続後)
            state.blur_on = overlay.then_some(settings.overlay_blur);
            state.blur_active = true;
            state.ignoring_cursor = overlay;
            format!("main-{}", state.created)
        };
        // 外したモニターの上に復元されて見えなくなるのを防ぐ
        let bounds = ensure_on_screen(requested, &work_areas(&self.app));

        let replacing = Mutex::new(replacing);
        let mut builder =
            WebviewWindowBuilder::new(&self.app, &label, WebviewUrl::App("index.html".into()))
                .title("Live Keymap Viewer")
                .visible(false)
                .position(f64::from(bounds.x), f64::from(bounds.y))
                .inner_size(f64::from(bounds.width), f64::from(bounds.height))
                .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
                .resizable(true)
                .decorations(!overlay)
                .transparent(overlay)
                // 枠の無いウィンドウに付く影と 1px の縁を消す(オーバーレイは透明なので縁だけが浮く)
                .shadow(!overlay)
                .skip_taskbar(overlay)
                .always_on_top(overlay)
                // 画面は暗い配色だけで作ってある。OS がライトテーマだと、後ろのぼかし(アクリル)まで
                // ライトの色味で描かれるので、ウィンドウの配色を暗い方に固定する
                .theme(Some(Theme::Dark))
                .additional_browser_args(BROWSER_ARGS)
                .on_page_load(move |window, payload| {
                    if payload.event() != PageLoadEvent::Finished {
                        return;
                    }
                    let _ = window.show();
                    // 新しい方が出てから古い方を消す(ちらつかせない)
                    if let Some(old) = replacing.lock().unwrap().take() {
                        let _ = old.destroy();
                    }
                });
        if !overlay {
            builder = builder.background_color(NORMAL_BACKGROUND);
        }
        let window = match builder.build() {
            Ok(window) => window,
            Err(error) => {
                logfile::error("ウィンドウを作れなかった", Some(&error.to_string()));
                return None;
            }
        };

        if overlay {
            // クリックを下のウィンドウに通す。操作パネルの上でだけ画面が一時的に切る
            let _ = window.set_ignore_cursor_events(true);
            set_backdrop(&window, settings.overlay_blur);
        }

        // モード切替中に古いウィンドウから飛んでくるイベントで取り違えないよう、
        // このウィンドウ自身のモードで保存する
        let settings = Arc::clone(&self.settings);
        let hid = Arc::clone(&self.hid);
        let this = window.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                if let Some(bounds) = bounds_of(&this) {
                    settings.save(patch(bounds_key(mode), json!(bounds)));
                }
            }
            WindowEvent::Destroyed => hid.close_owned_by(this.label()),
            _ => {}
        });
        Some(window)
    }
}

fn bounds_key(mode: WindowMode) -> &'static str {
    match mode {
        WindowMode::Overlay => "overlayBounds",
        WindowMode::Normal => "normalBounds",
    }
}

/// ウィンドウの位置(外枠の左上)と大きさ(中身)を論理ピクセルで。最小化していれば None。
fn bounds_of(window: &WebviewWindow) -> Option<Bounds> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Bounds {
        x: position.x.round() as i32,
        y: position.y.round() as i32,
        width: size.width.round() as i32,
        height: size.height.round() as i32,
    })
}

/// 各画面の作業領域(タスクバーを除いた範囲)を論理ピクセルで。主画面を先頭にする。
fn work_areas(app: &AppHandle) -> Vec<Bounds> {
    let mut monitors = app.available_monitors().unwrap_or_default();
    if let Ok(Some(primary)) = app.primary_monitor() {
        monitors.sort_by_key(|monitor| monitor.position() != primary.position());
    }
    monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let position = area.position.to_logical::<f64>(scale);
            let size = area.size.to_logical::<f64>(scale);
            Bounds {
                x: position.x.round() as i32,
                y: position.y.round() as i32,
                width: size.width.round() as i32,
                height: size.height.round() as i32,
            }
        })
        .collect()
}

/// カーソルがウィンドウの中身の上にあれば、その位置(中身の左上からの論理ピクセル)。
fn cursor_in(window: &WebviewWindow) -> Option<(i32, i32)> {
    let cursor = window.cursor_position().ok()?;
    let origin = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    let x = cursor.x - f64::from(origin.x);
    let y = cursor.y - f64::from(origin.y);
    if x < 0.0 || y < 0.0 || x >= f64::from(size.width) || y >= f64::from(size.height) {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    Some(((x / scale).round() as i32, (y / scale).round() as i32))
}

/// オーバーレイの後ろの画面をすりガラスにする(Windows 11 のアクリル)。
///
/// CSS の backdrop-filter では、透明なウィンドウの後ろ(ほかのアプリ)はぼかせない ―
/// WebView が重ねられるのは自分の中身だけなので、OS に描いてもらう。ぼかしの強さは OS が
/// 決めるので、アプリでは入り切りしかできない。ほかの OS では何もしない。
/// 呼ぶのはオーバーレイ(transparent で作ったウィンドウ)だけ。
fn set_backdrop(window: &WebviewWindow, on: bool) {
    #[cfg(windows)]
    {
        use tauri::window::{Effect, EffectsBuilder};
        let effects = on.then(|| EffectsBuilder::new().effect(Effect::Acrylic).build());
        if let Err(error) = window.set_effects(effects) {
            logfile::warn("背景のぼかしを切り替えられなかった", Some(&error.to_string()));
        }
    }
    #[cfg(not(windows))]
    let _ = (window, on);
}
