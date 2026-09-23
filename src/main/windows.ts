/**
 * ウィンドウの管理。通常ウィンドウとクリック透過オーバーレイを作り分ける。
 *
 * 透明ウィンドウは作った後から切り替えられないので、モードを変えるたびに
 * ウィンドウを作り直し、位置とサイズを引き継ぐ。
 */

import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { IPC } from '../shared/ipc'
import {
  type Bounds,
  ensureOnScreen,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type Settings,
  type WindowMode
} from '../shared/settings'
import { log } from './log'
import { loadSettings, saveSettings } from './settings'

/** 移動・リサイズの保存をまとめる間隔。つまみの操作は毎フレーム飛んでくる。 */
const BOUNDS_SAVE_DELAY_MS = 400

/**
 * モードを切り替えるとき、古いウィンドウがキーボードを手放すのを待つ上限(ms)。
 * 返事が無くても先へ進む(renderer が応答できない状態でも切り替えは効かせる)。
 */
const HID_RELEASE_TIMEOUT_MS = 600

/**
 * オーバーレイの後ろの画面をすりガラスにする(Windows 11 22H2 以降のアクリル)。
 *
 * CSS の backdrop-filter では、透明なウィンドウの後ろ(ほかのアプリ)はぼかせない ―
 * Chromium が重ねられるのは自分の中身だけなので、OS に描いてもらう。ぼかしの強さは OS が
 * 決めるので、アプリでは入り切りしかできない。ほかの OS では何もしない。古い Windows では
 * 効かないだけのはずだが、念のため失敗しても落とさない。
 *
 * 呼ぶのはオーバーレイ(transparent で作ったウィンドウ)だけ。Electron は材質に合わせて背景色を
 * 塗り直し、'none' では**白**にする(v44 の electron_api_browser_window.cc)。そのままだと
 * 「L0 で薄く」で外すたびに、透かしていたはずの背景が白い板になる。なので透明に塗り直す。
 */
function setBackdrop(win: BrowserWindow, on: boolean): void {
  if (process.platform !== 'win32') return
  try {
    win.setBackgroundMaterial(on ? 'acrylic' : 'none')
    if (!on) win.setBackgroundColor('#00000000')
  } catch (error) {
    log('warn', '背景のぼかしを切り替えられなかった', error)
  }
}

export class WindowManager {
  private window: BrowserWindow | null = null
  private currentMode: WindowMode = 'normal'
  /** いま画面に出ているウィンドウを作ったときのモード。切り替えの途中は currentMode と食い違う。 */
  private liveMode: WindowMode = 'normal'
  private boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
  /** 古いウィンドウの「手放した」を待っているあいだの後始末と続き。 */
  private handover: { timer: ReturnType<typeof setTimeout>; finish: () => void } | null = null
  /** renderer が図を濃く出しているか(薄くしているあいだは後ろをぼかさない)。 */
  private blurActive = true
  /** いまウィンドウに掛けているぼかし。掛けていない(通常ウィンドウ)なら null。 */
  private blurOn: boolean | null = null

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

  /**
   * 位置とサイズを引き継いだままモードを切り替える。
   *
   * 透明ウィンドウは作り直すしかないので、新しいウィンドウの renderer は、できた瞬間から
   * 同じキーボードを開きに行く。古い方はまだ 20ms ごとに matrix を読んでいて、raw HID の
   * 応答は同じデバイスを開いている**全員**に配られる。Vial コマンド(`0xFE`)は応答を
   * 照合できない(hid/vial.ts)ので、両方が話していると新しい方の読み込みが壊れ、
   * 「切り替えたら繋ぎ直しになる」ことがあった。先に古い方へ手放させてから作る。
   */
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

    // 途中だった切り替えは取り消す(連打)。取り消した結果、出ているウィンドウが
    // そのまま目的のモードなら、作り直さない
    this.cancelHandover()
    if (old && next === this.liveMode) return

    this.releaseHid(old, () => {
      const win = this.create(next, bounds)
      this.window = win
      // 新しい方が出てから古い方を消す(ちらつかせない)
      win.once('ready-to-show', () => {
        if (old && !old.isDestroyed()) old.destroy()
      })
    })
  }

  /** renderer が「手放した」と言ってきた。待っている切り替えがあれば先へ進む。 */
  noteHidReleased(): void {
    this.handover?.finish()
  }

  /** 古いウィンドウに手放させ、返事か時間切れで続きへ進む。ウィンドウが無ければすぐ進む。 */
  private releaseHid(old: BrowserWindow | null, next: () => void): void {
    if (!old || old.isDestroyed()) {
      next()
      return
    }
    const finish = (): void => {
      this.cancelHandover()
      next()
    }
    this.handover = { timer: setTimeout(finish, HID_RELEASE_TIMEOUT_MS), finish }
    old.webContents.send(IPC.hidRelease)
  }

  private cancelHandover(): void {
    if (!this.handover) return
    clearTimeout(this.handover.timer)
    this.handover = null
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
    if (!win) return
    const on = settings.overlayBlur && this.blurActive
    // 同じ材質を掛け直さない。濃さのスライダーを動かすと設定の更新が毎回ここに来るが、
    // OS 側の切り替えは安くない(main が詰まると WebHID の往復も返らない)
    if (on === this.blurOn) return
    this.blurOn = on
    setBackdrop(win, on)
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
    this.liveMode = mode
    this.blurOn = null // 作り直したウィンドウにはまだ何も掛けていない
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
      this.blurOn = settings.overlayBlur
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
