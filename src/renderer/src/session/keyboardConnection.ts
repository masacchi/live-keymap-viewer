/**
 * キーボードとの接続を持ち続ける。セッション(session/keyboardSession.ts)は 1 接続ぶんで、
 * 切れたら捨てて作り直す。その差し替えと、どのデバイスに繋ぐかをここで決める。
 *
 *   - デバイスの選び方(選択ダイアログ / 前に許可したもの / モック)
 *   - セッションの差し替えと破棄
 *   - 切れたら繋ぎ直す
 *
 * React から切り離してあるのは、タイマーと HID のイベントが絡む繋ぎ直しをテストするため。
 * フック(hooks/useVialKeyboard.ts)は状態を React に渡すだけ。
 *
 * ## 繋ぎ直し
 *
 * USB の抜き差しや PC のスリープ復帰で、使っていたデバイスは消える。セッションは通信に
 * 失敗して error で止まるので、
 *
 *   - 一度でも動いた(アンロックかポーリングまで進んだ)実機のセッションが止まったら、
 *     RECONNECT_DELAY_MS ごとに許可済みのデバイスを探し直して繋ぐ
 *   - HID の connect イベント(挿された)が来たら、待たずに試す。起動時にキーボードが
 *     無かったときも、これで繋がる
 *
 * 読み込みの途中で止まったもの(未対応のプロトコルなど)は、繰り返しても同じなのでタイマーでは
 * 繋ぎ直さない(挿し直しと手動の接続は受け付ける)。
 * 「切断」を押したとき、モックに切り替えたときは繋ぎ直さない。
 */
import { type ProbeResult, pickResponsiveDevice } from '../hid/deviceProbe'
import { MockTransport } from '../hid/mockTransport'
import { isVialDevice, type Transport, VIAL_HID_FILTERS, WebHidTransport } from '../hid/transport'
import type { DefinitionCache } from '../hid/vial'
import {
  KeyboardSession,
  type ReloadOptions,
  type SessionOptions,
  type SessionState,
  type SessionStatus
} from './keyboardSession'

/** 切れてから、許可済みのデバイスを探し直すまでの間隔。 */
export const RECONNECT_DELAY_MS = 2000

/** セッションが無いときの 'idle' を足したもの。 */
export type ConnectionStatus = 'idle' | SessionStatus

export type ConnectionState = Omit<SessionState, 'status' | 'deviceLabel'> & {
  status: ConnectionStatus
  deviceLabel: string | null
  /** 動いていた接続が切れて、繋ぎ直そうとしているあいだ true。 */
  reconnecting: boolean
}

export const IDLE: ConnectionState = {
  status: 'idle',
  error: null,
  deviceLabel: null,
  snapshot: null,
  geometry: null,
  engine: null,
  layers: null,
  unlock: null,
  reloading: false,
  loading: null,
  reconnecting: false
}

/** navigator.hid のうち、ここで使うところ。 */
export type HidLike = Pick<
  HID,
  'getDevices' | 'requestDevice' | 'addEventListener' | 'removeEventListener'
>

export interface ConnectionOptions {
  /** navigator.hid。無ければ実機には繋がない(モックだけ)。 */
  hid?: HidLike | null
  /** 実機の定義のキャッシュ(モックには使わない)。 */
  definitionCache?: DefinitionCache
  reconnectDelayMs?: number
  // --- テストで差し替える ---
  openTransport?: (device: HIDDevice) => Transport
  pickDevice?: (
    candidates: readonly HIDDevice[]
  ) => Promise<{ device: HIDDevice | null; results: ProbeResult[] }>
  createMock?: () => Transport
  sessionOptions?: SessionOptions
}

export type ConnectionListener = (state: ConnectionState) => void

export class KeyboardConnection {
  private current: ConnectionState = IDLE
  private readonly listeners = new Set<ConnectionListener>()
  private session: KeyboardSession | null = null
  /** デバイス探しの世代。新しい操作があったら、古い探索の結果は使わない。 */
  private search = 0
  /** 切れたら繋ぎ直すか。「切断」やモックで false、実機への接続操作で true に戻る。 */
  private autoReconnect = true
  /** 動いていた接続が切れて、繋ぎ直そうとしている。 */
  private reconnecting = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private disposed = false

  constructor(private readonly options: ConnectionOptions = {}) {}

  get state(): ConnectionState {
    return this.current
  }

  /** 状態の変化を受け取る。登録した時点の状態もすぐに 1 回渡す。 */
  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener)
    listener(this.current)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** HID の connect イベントを聞き始め、前に許可したデバイスがあれば繋ぐ。 */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.options.hid?.addEventListener('connect', this.onHidConnect)
    void this.connectToGranted()
  }

  /** すべて止めて閉じる。以後、通知は一切出さない。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.search++
    this.cancelRetry()
    this.options.hid?.removeEventListener('connect', this.onHidConnect)
    this.listeners.clear()
    const session = this.session
    this.session = null
    await session?.dispose()
  }

  /** デバイス選択ダイアログを出して繋ぐ。 */
  async connect(): Promise<void> {
    const hid = this.options.hid
    if (!hid) {
      this.publish({ ...IDLE, status: 'error', error: 'WebHID が使えない' })
      return
    }
    const picked = await hid.requestDevice({ filters: VIAL_HID_FILTERS })
    const chosen = picked.find(isVialDevice) ?? picked[0]
    if (!chosen || this.disposed) return
    this.autoReconnect = true
    this.stopReconnecting()

    // 許可は VID/PID 単位なので、同じキーボードの別経路(USB と BT)も一緒に許可されている。
    // 選ばれたものを先頭にして、同じ VID/PID の Vial インターフェースをすべて候補にする
    const granted = await hid.getDevices()
    const siblings = granted.filter(
      (d) =>
        d !== chosen &&
        isVialDevice(d) &&
        d.vendorId === chosen.vendorId &&
        d.productId === chosen.productId
    )
    await this.connectToResponsive([chosen, ...siblings])
  }

  /** 実機なしで画面を確かめる用。 */
  async connectMock(): Promise<void> {
    this.autoReconnect = false
    this.stopReconnecting()
    this.search++ // 探索中なら、その結果は使わない
    await this.attach(this.options.createMock?.() ?? new MockTransport({ unlocked: false }), false)
  }

  async disconnect(): Promise<void> {
    this.autoReconnect = false
    this.stopReconnecting()
    this.search++
    const session = this.session
    this.session = null
    this.publish(IDLE)
    await session?.dispose()
  }

  /** キーマップを読み直す。ポーリング中でなければ何もしない。 */
  async reload(options?: ReloadOptions): Promise<void> {
    await this.session?.reload(options)
  }

  // --- 内部 ---

  private readonly onHidConnect = (event: HIDConnectionEvent): void => {
    if (this.disposed || !this.autoReconnect || !isVialDevice(event.device)) return
    // 動いている接続があれば乗り換えない(USB で使っているときに BT 側が繋がった、など)。
    // 繋ぎに行っている最中('connecting')も、その結果を待つ
    if (this.session && this.current.status !== 'error') return
    if (this.current.status === 'connecting') return
    this.cancelRetry()
    void this.connectToGranted()
  }

  /** 前に許可した Vial デバイスを探して繋ぐ。 */
  private async connectToGranted(): Promise<void> {
    const hid = this.options.hid
    if (!hid || this.disposed) return
    const devices = (await hid.getDevices()).filter(isVialDevice)
    if (this.disposed) return
    if (devices.length === 0) {
      if (this.reconnecting) this.scheduleRetry() // 挿し直されるのを待つ
      return
    }
    await this.connectToResponsive(devices)
  }

  /**
   * 候補のうち、実際に答えるインターフェースに繋ぐ。
   *
   * USB と Bluetooth の両方で繋がっていると、同じキーボードの Vial インターフェースが
   * 2 つ見え、出力先でない側は答えない(hid/deviceProbe.ts)。確かめる間は候補を開き閉じ
   * するので、いまのセッションは先に閉じておく(開いたまま閉じられると壊れる)。
   */
  private async connectToResponsive(candidates: HIDDevice[]): Promise<void> {
    const search = ++this.search
    const previous = this.session
    this.session = null
    await previous?.dispose()
    if (search !== this.search || this.disposed) return
    if (candidates.length > 1) {
      this.publish({
        ...IDLE,
        status: 'connecting',
        deviceLabel: '応答するインターフェースを確認中'
      })
    }

    const pick = this.options.pickDevice ?? pickResponsiveDevice
    const { device, results } = await pick(candidates)
    if (search !== this.search || this.disposed) return
    if (!device) {
      this.publish({
        ...IDLE,
        status: 'error',
        error:
          `キーボードが応答しない(${results.length} 個のインターフェースを試した)。` +
          'Vial など別のアプリで使っていないか、USB / Bluetooth の出力先を確かめる'
      })
      if (this.reconnecting) this.scheduleRetry()
      return
    }
    const open = this.options.openTransport ?? ((d: HIDDevice) => new WebHidTransport(d))
    await this.attach(open(device), true)
  }

  /**
   * 新しい transport でセッションを作り直す。
   *
   * 参照は await より前に差し替える。こうしておくと、接続を連打しても
   * 「最後に作ったセッション」だけが生き残り、それ以前のものは必ず破棄される。
   */
  private async attach(transport: Transport, real: boolean): Promise<void> {
    const previous = this.session
    const session = new KeyboardSession(transport, {
      ...this.options.sessionOptions,
      definitionCache: real ? this.options.definitionCache : undefined
    })
    this.session = session

    let worked = false
    session.subscribe((state) => {
      if (this.session !== session) return
      if (state.status === 'unlocking' || state.status === 'ready') {
        worked = true
        this.reconnecting = false
      }
      // 動いていたもの(または繋ぎ直しの途中のもの)が止まったら、しばらくして繋ぎ直す
      if (state.status === 'error' && real && this.autoReconnect && (worked || this.reconnecting)) {
        this.reconnecting = true
        this.scheduleRetry()
      }
      this.publish(state)
    })

    await previous?.dispose()
    if (this.session !== session || this.disposed) return
    await session.start()
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.disposed) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.autoReconnect && this.reconnecting) void this.connectToGranted()
    }, this.options.reconnectDelayMs ?? RECONNECT_DELAY_MS)
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private stopReconnecting(): void {
    this.reconnecting = false
    this.cancelRetry()
  }

  private publish(state: Omit<ConnectionState, 'reconnecting'>): void {
    if (this.disposed) return
    this.current = { ...state, reconnecting: this.reconnecting }
    for (const listener of this.listeners) listener(this.current)
  }
}
