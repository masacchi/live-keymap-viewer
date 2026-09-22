/**
 * ウィンドウの管理。通常ウィンドウとクリック透過オーバーレイを作り分ける。
 *
 * 透明ウィンドウは作った後から切り替えられないので、モードを変えるたびに
 * ウィンドウを作り直し、位置とサイズを引き継ぐ。
 */

import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import {
  type Bounds,
  ensureOnScreen,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type Settings,
  type WindowMode
} from '../shared/settings'
import { loadSettings, saveSettings } from './settings'

/** 移動・リサイズの保存をまとめる間隔。つまみの操作は毎フレーム飛んでくる。 */
const BOUNDS_SAVE_DELAY_MS = 400

/**
 * オーバーレイの後ろの画面をすりガラスにする(Windows 11 22H2 以降のアクリル)。
 *
 * CSS の backdrop-filter では、透明なウィンドウの後ろ(ほかのアプリ)はぼかせない ―
 * Chromium が重ねられるのは自分の中身だけなので、OS に描いてもらう。ぼかしの強さは OS が
 * 決めるので、アプリでは入り切りしかできない。ほかの OS では何もしない。古い Windows では
 * 効かないだけのはずだが、念のため失敗しても落とさない。
 */
function setBackdrop(win: BrowserWindow, on: boolean): void {
  if (process.platform !== 'win32') return
  try {
    win.setBackgroundMaterial(on ? 'acrylic' : 'none')
  } catch (error) {
    console.warn('背景のぼかしを切り替えられなかった', error)
  }
}

export class WindowManager {
  private window: BrowserWindow | null = null
  private currentMode: WindowMode = 'normal'
  private boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
  /** renderer が図を濃く出しているか(薄くしているあいだは後ろをぼかさない)。 */
  private blurActive = true

  get mode(): WindowMode {
    return this.currentMode
  }

  /** いま表示しているウィンドウ。無ければ null。 */
  get current(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }

  /** 起動時に、前回のモードで開く。 */
  open(): void {
    const settings = loadSettings()
    this.currentMode = settings.mode
    this.window = this.create(
      this.currentMode,
      this.currentMode === 'overlay' ? settings.overlayBounds : settings.normalBounds
    )
  }

  /** ウィンドウが 1 枚も無いとき(macOS の activate)に開き直す。 */
  reopenIfClosed(): void {
    if (BrowserWindow.getAllWindows().length > 0) return
    this.open()
  }

  /** 位置とサイズを引き継いだままモードを切り替える。 */
  setMode(next: WindowMode): void {
    const old = this.current
    if (next === this.currentMode && old) return

    const settings = loadSettings()
    const bounds = old?.getBounds() ?? settings.normalBounds
    this.currentMode = next
    saveSettings({
      mode: next,
      ...(next === 'overlay' ? { overlayBounds: bounds } : { normalBounds: bounds })
    })

    const win = this.create(next, bounds)
    this.window = win
    // 新しい方が出てから古い方を消す(ちらつかせない)
    win.once('ready-to-show', () => {
      if (old && !old.isDestroyed()) old.destroy()
    })
  }

  toggleMode(): void {
    this.setMode(this.currentMode === 'normal' ? 'overlay' : 'normal')
  }

  /**
   * 保存した設定のうち、ウィンドウに効くもの(濃さ・後ろのぼかし)を反映する。
   * 設定を変えたあとに呼ぶ。通常ウィンドウでは何もしない(次にオーバーレイを作るときに使う)。
   */
  applySettings(settings: Settings): void {
    if (this.currentMode !== 'overlay') return
    this.current?.setOpacity(settings.overlayOpacity)
    this.applyBlur(settings)
  }

  /** renderer から: いま図を濃く出しているか。薄くしているあいだはぼかしを外す。 */
  setOverlayBlurActive(active: boolean): void {
    if (active === this.blurActive) return
    this.blurActive = active
    this.applyBlur(loadSettings())
  }

  private applyBlur(settings: Settings): void {
    if (this.currentMode !== 'overlay') return
    const win = this.current
    if (win) setBackdrop(win, settings.overlayBlur && this.blurActive)
  }

  /** オーバーレイのクリック透過を切り替える(操作パネルの上だけ切る)。 */
  setIgnoreMouseEvents(ignore: boolean): void {
    if (this.currentMode !== 'overlay') return
    this.current?.setIgnoreMouseEvents(ignore, { forward: true })
  }

  moveBy(dx: number, dy: number): void {
    const win = this.current
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(Math.round(x + dx), Math.round(y + dy))
    this.scheduleBoundsSave()
  }

  resizeBy(dw: number, dh: number): void {
    const win = this.current
    if (!win) return
    const [width, height] = win.getSize()
    win.setSize(
      Math.max(MIN_WINDOW_WIDTH, Math.round(width + dw)),
      Math.max(MIN_WINDOW_HEIGHT, Math.round(height + dh))
    )
    this.scheduleBoundsSave()
  }

  /** renderer にメッセージを送る。ウィンドウが無ければ何もしない。 */
  send(channel: string, ...args: unknown[]): void {
    this.current?.webContents.send(channel, ...args)
  }

  private create(mode: WindowMode, requested: Bounds): BrowserWindow {
    const overlay = mode === 'overlay'
    const settings = loadSettings()
    // 外したモニターの上に復元されて見えなくなるのを防ぐ
    const bounds = ensureOnScreen(
      requested,
      screen.getAllDisplays().map((display) => display.workArea)
    )

    const win = new BrowserWindow({
      ...bounds,
      show: false,
      title: 'Live Keymap Viewer',
      transparent: overlay,
      frame: !overlay,
      // オーバーレイは枠が無いので OS のリサイズ境界は出ない。
      // ただし resizable:false だと setSize まで効かなくなるので true にしておき、
      // 大きさは画面内のつまみから変える。
      resizable: true,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      skipTaskbar: overlay,
      alwaysOnTop: overlay,
      backgroundColor: overlay ? '#00000000' : '#11151a',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 最小化や、他のウィンドウに完全に隠れたとき(Windows は隠れたら非表示扱い)に
        // タイマーが 1 秒に 1 回まで間引かれると、20ms の matrix ポーリングが止まったも同然になる。
        // その間の TG / DF の押下を取りこぼし、戻ったときに表示するレイヤーがずれる
        backgroundThrottling: false
      }
    })

    if (overlay) {
      // クリックを下のウィンドウに通す。操作パネルの上でだけ renderer が一時的に切る
      win.setIgnoreMouseEvents(true, { forward: true })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setOpacity(settings.overlayOpacity)
      // 作り直したウィンドウの renderer は、読み込むまで図を濃く出している(薄くするのは接続後)
      this.blurActive = true
      setBackdrop(win, settings.overlayBlur)
    }

    win.on('ready-to-show', () => win.show())

    // 外部リンクはブラウザで開き、アプリ内には新しいウィンドウを作らせない
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    // モード切替中に古いウィンドウから飛んでくるイベントで取り違えないよう、
    // このウィンドウ自身のモードで保存する
    const saveBounds = (): void => {
      if (win.isDestroyed() || win.isMinimized()) return
      const current = win.getBounds()
      saveSettings(overlay ? { overlayBounds: current } : { normalBounds: current })
    }
    win.on('resized', saveBounds)
    win.on('moved', saveBounds)

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    }

    return win
  }

  /**
   * setPosition / setSize は 'moved' / 'resized' を必ずしも出さないので、
   * つまみで動かしたときは自前でまとめて保存する。
   */
  private scheduleBoundsSave(): void {
    if (this.boundsSaveTimer !== null) clearTimeout(this.boundsSaveTimer)
    this.boundsSaveTimer = setTimeout(() => {
      this.boundsSaveTimer = null
      const win = this.current
      if (!win || win.isMinimized()) return
      const current = win.getBounds()
      saveSettings(
        this.currentMode === 'overlay' ? { overlayBounds: current } : { normalBounds: current }
      )
    }, BOUNDS_SAVE_DELAY_MS)
  }
}
