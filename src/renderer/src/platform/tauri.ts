/**
 * Tauri(デスクトップ版)で動いているときに、`window.api` と HID を用意する。
 *
 * 画面のほかの部分は Electron 版のころと同じく `window.api`(shared/ipc.ts の RendererApi)と
 * WebHID の形だけを知っていて、Tauri を直接は呼ばない。ここがその 2 つを Rust のコマンド
 * (src-tauri/src/commands.rs)に繋ぐ。
 *
 * ブラウザで開いたとき(`npm run dev`)は何もしない。`window.api` は undefined のままで、
 * HID はブラウザの WebHID を使う(Chrome / Edge なら実機にも繋がる)。
 *
 * **このファイルはいちばん先に読み込む**(main.tsx の先頭)。部品は最初の描画から `window.api` を使う。
 */
import { Channel, invoke } from '@tauri-apps/api/core'
import { type EventCallback, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { AppInfo, HidCandidate, RendererApi } from '../../../shared/ipc'
import type { GrantedDevice, Settings, WindowMode } from '../../../shared/settings'
import { NativeHid, type NativeHidBackend, type NativeHidInfo } from '../hid/nativeHid'
import type { HidLike } from '../session/keyboardConnection'

declare const __BUILD_TIME__: string | undefined

/** ビルドした時刻(vite.config.ts の define で埋める)。dev では空。 */
const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * 候補が複数あったときの選択。Electron 版では main から候補が飛んできて、選んだ結果を main に
 * 返していた。いまは選ぶのも待つのも画面の中(nativeHid.ts の requestDevice)なので、ここで繋ぐ。
 */
class DeviceChooser {
  private readonly handlers = new Set<(devices: HidCandidate[]) => void>()
  private pending: ((deviceId: string | null) => void) | null = null

  subscribe(handler: (devices: HidCandidate[]) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  request(candidates: HidCandidate[]): Promise<string | null> {
    // 前の選択が宙に浮いていたら、取り消してから次へ(放っておくと前の要求が永遠に終わらない)
    this.resolve(null)
    return new Promise((resolve) => {
      this.pending = resolve
      for (const handler of this.handlers) handler(candidates)
    })
  }

  resolve(deviceId: string | null): void {
    const pending = this.pending
    this.pending = null
    pending?.(deviceId)
  }
}

/**
 * Rust からのイベントを受ける。戻り値を呼ぶと解除。
 *
 * `own` はこのウィンドウ宛ての知らせ(emit_to で送るもの)。全ウィンドウ宛ての `listen` で受けると、
 * ほかのウィンドウ宛てのもの(モード切り替え中の古いウィンドウへの「手放して」など)まで届く。
 */
function subscribe<T>(event: string, handler: EventCallback<T>, own = false): () => void {
  const unlisten = own ? getCurrentWebviewWindow().listen(event, handler) : listen(event, handler)
  return () => {
    void unlisten.then((stop) => stop())
  }
}

function createHidBackend(chooser: DeviceChooser): NativeHidBackend {
  return {
    devices: (grantedOnly) => invoke('hid_devices', { grantedOnly }),
    remember: (device) =>
      invoke('hid_remember', {
        vendorId: device.vendorId,
        productId: device.productId,
        name: device.productName
      }),
    choose: (candidates) => chooser.request(candidates),
    open: (path, onReport) => {
      const channel = new Channel<number[]>()
      channel.onmessage = (bytes) => onReport(Uint8Array.from(bytes))
      return invoke('hid_open', { path, onReport: channel })
    },
    write: (handle, data) => invoke('hid_write', { handle, data: Array.from(data) }),
    close: (handle) => invoke('hid_close', { handle }),
    subscribe: ({ connect, disconnect }) => {
      const stops = [
        subscribe<NativeHidInfo>('hid-connect', (event) => connect(event.payload)),
        subscribe<NativeHidInfo>('hid-disconnect', (event) => disconnect(event.payload))
      ]
      return () => {
        for (const stop of stops) stop()
      }
    }
  }
}

function createApi(chooser: DeviceChooser): RendererApi {
  // 戻り値を待たないもの(ドラッグ中に毎フレーム飛ぶものなど)。失敗しても画面は止めない
  const send = (command: string, args?: Record<string, unknown>): void => {
    void invoke(command, args).catch(() => undefined)
  }
  return {
    getAppInfo: async () => ({
      ...(await invoke<Omit<AppInfo, 'buildTime'>>('app_info')),
      buildTime: BUILD_TIME
    }),
    getSettings: () => invoke<Settings>('settings_get'),
    updateSettings: (patch) => invoke<Settings>('settings_update', { patch }),
    setLayerName: (uid, layer, name) =>
      invoke<string[]>('settings_set_layer_name', { uid, layer, name }),
    forgetDevice: (vendorId, productId) =>
      invoke<GrantedDevice[]>('settings_forget_device', { vendorId, productId }),

    getMode: () => invoke<WindowMode>('window_get_mode'),
    toggleMode: () => invoke<WindowMode>('window_toggle_mode'),
    setOverlayBlurActive: (active) => send('window_set_overlay_blur_active', { active }),

    setIgnoreMouseEvents: (ignore) => send('window_set_ignore_mouse', { ignore }),
    moveBy: (dx, dy) => send('window_move_by', { dx, dy }),
    resizeBy: (dw, dh) => send('window_resize_by', { dw, dh }),

    onChooseDevice: (handler) => chooser.subscribe(handler),
    chooseDevice: (deviceId) => chooser.resolve(deviceId),

    onReleaseHid: (handler) => subscribe('hid-release', () => handler(), true),
    hidReleased: () => send('hid_released'),

    report: (level, message, detail) => send('log_report', { level, message, detail }),
    openLog: () => send('log_open')
  }
}

/**
 * クリック透過中に Rust から届くカーソルの位置を、mousemove として流す。
 *
 * Electron はクリック透過中でも mousemove を画面に届けてくれた(`forward: true`)。
 * 操作パネル(components/OverlayControls.tsx)はそれを見て、ポインタが乗ったときだけ透過を切る。
 * Tauri にはその機能が無いので、Rust がカーソルの位置を送ってくる(src-tauri/src/windows.rs の
 * start_cursor_forwarding)。同じ形の mousemove にしておけば、操作パネルはそのまま動く。
 */
function forwardOverlayCursor(): void {
  subscribe<[number, number]>(
    'overlay-cursor',
    ({ payload: [x, y] }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
    },
    true
  )
}

function install(): HidLike {
  const chooser = new DeviceChooser()
  window.api = createApi(chooser)
  forwardOverlayCursor()
  // NativeHid は HID のうちアプリが使うところだけを持つ(型の全部は満たさない)
  return new NativeHid(createHidBackend(chooser)) as unknown as HidLike
}

/** Tauri で動いているときの HID。ブラウザでは null(navigator.hid を使う)。 */
export const nativeHid: HidLike | null = isTauri ? install() : null
