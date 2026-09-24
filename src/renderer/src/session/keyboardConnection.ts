/**
 * キーボードとの接続を持ち続ける。セッション(session/keyboardSession.ts)は1接続ぶんで、
 * 切れたら捨てて作り直す。その差し替えと、どのデバイスに接続するかをここで決める。
 *
 *   - デバイスの選び方(選択ダイアログ / 前に許可したもの / モック)
 *   - セッションの差し替えと破棄
 *   - 切れたら再接続する
 *
 * Reactから切り離してあるのは、タイマーとHIDのイベントが絡む再接続をテストするため。
 * フック(hooks/useVialKeyboard.ts)は状態をReactに渡すだけ。
 *
 * ## 再接続
 *
 * USBの抜き差しやPCのスリープ復帰で、使っていたデバイスは消える。セッションは通信に
 * 失敗してerrorで止まるので、
 *
 *   - 一度でも動いた(アンロックかポーリングまで進んだ)実機のセッションが止まったら、
 *     RECONNECT_DELAY_MSごとに許可済みのデバイスを探し直して接続する
 *   - HIDのconnectイベント(挿された)が来たら、待たずに試す。起動時にキーボードが
 *     無かったときも、これで接続する
 *   - HIDのdisconnectイベント(抜かれた・消えた)が来たら、その場で切断して再接続に入る。
 *     通信の失敗を待つと、応答が返らないだけの詰まり(ウィンドウのドラッグ中など)と
 *     見分けが付かず、STALL_LIMIT_MSぶん「応答待ち」のままになる
 *
 * 読み込みの途中で止まったもの(未対応のプロトコルなど)は、繰り返しても同じなのでタイマーでは
 * 再接続しない(挿し直しと手動の接続は受け付ける)。
 * 「切断」を押したとき、モックに切り替えたときは再接続しない。
 */
import type { ReportLevel } from '../../../shared/ipc'
import { type ProbeResult, pickResponsiveDevice } from '../hid/deviceProbe'
import { MockTransport } from '../hid/mockTransport'
import { isVialDevice, type Transport, VIAL_HID_FILTERS, WebHidTransport } from '../hid/transport'
import type { DefinitionCache, KeymapCache } from '../hid/vial'
import { messages } from '../messages'
import {
  KeyboardSession,
  type ReloadOptions,
  type SessionOptions,
  type SessionState,
  type SessionStatus
} from './keyboardSession'

/** 切れてから、許可済みのデバイスを探し直すまでの間隔。 */
export const RECONNECT_DELAY_MS = 2000

/** セッションが無いときの'idle'を足したもの。 */
export type ConnectionStatus = 'idle' | SessionStatus

export type ConnectionState = Omit<SessionState, 'status' | 'deviceLabel'> & {
  status: ConnectionStatus
  deviceLabel: string | null
  /** 動いていた接続が切れて、再接続しようとしているあいだtrue。 */
  reconnecting: boolean
  /** モックに接続している。キーをクリックで押せる(toggleMockKey)。 */
  mock: boolean
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
  stalled: false,
  loading: null,
  reconnecting: false,
  mock: false
}

/** navigator.hidのうち、ここで使うところ。 */
export type HidLike = Pick<
  HID,
  'getDevices' | 'requestDevice' | 'addEventListener' | 'removeEventListener'
>

export interface ConnectionOptions {
  /** navigator.hid。無ければ実機には接続しない(モックだけ)。 */
  hid?: HidLike | null
  /** 実機の定義のキャッシュ(モックには使わない)。 */
  definitionCache?: DefinitionCache
  /** 実機のキーマップのキャッシュ(モックには使わない)。接続した直後の表示に使う。 */
  keymapCache?: KeymapCache
  reconnectDelayMs?: number
  // --- テストで差し替える ---
  openTransport?: (device: HIDDevice) => Transport
  pickDevice?: (
    candidates: readonly HIDDevice[]
  ) => Promise<{ device: HIDDevice | null; results: ProbeResult[] }>
  createMock?: () => Transport
  sessionOptions?: SessionOptions
  /**
   * 出来事をログに残す関数(hooks/useVialKeyboard.tsがlib/reportを渡す)。
   * ここからwindowを触らないのは、この層をDOM無しでテストできるようにしておくため。
   */
  log?: (level: ReportLevel, message: string) => void
}

/** ログに出すデバイスの呼び名。名前が取れない経路(Bluetooth)もあるのでIDも添える。 */
function describeDevice(device: HIDDevice): string {
  const id = `${device.vendorId.toString(16).padStart(4, '0')}:${device.productId
    .toString(16)
    .padStart(4, '0')}`
  return `${device.productName || '名前なし'}(${id})`
}

export type ConnectionListener = (state: ConnectionState) => void

export class KeyboardConnection {
  private current: ConnectionState = IDLE
  private readonly listeners = new Set<ConnectionListener>()
  private session: KeyboardSession | null = null
  /** 長押しと見なすまでの時間(設定から)。まだ受け取っていなければエンジンの既定。 */
  private tappingTerm: number | undefined = undefined
  /** デバイス探しの世代。新しい操作があったら、古い探索の結果は使わない。 */
  private search = 0
  /** 切れたら再接続するか。「切断」やモックでfalse、実機への接続操作でtrueに戻る。 */
  private autoReconnect = true
  /** 動いていた接続が切れて、再接続しようとしている。 */
  private reconnecting = false
  /** モックに接続しているときの、そのモック。 */
  private mock: MockTransport | null = null
  /** いま使っている実機。disconnectイベントが自分のものかを見分けるために持つ。 */
  private device: HIDDevice | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private disposed = false

  constructor(private readonly options: ConnectionOptions = {}) {}

  get state(): ConnectionState {
    return this.current
  }

  /** 状態の変化を受け取る。登録した時点の状態もすぐに1回渡す。 */
  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener)
    listener(this.current)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** HIDのconnectイベントを聞き始め、前に許可したデバイスがあれば接続する。 */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.options.hid?.addEventListener('connect', this.onHidConnect)
    this.options.hid?.addEventListener('disconnect', this.onHidDisconnect)
    void this.connectToGranted()
  }

  /** すべて止めて閉じる。以後、通知は一切出さない。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.search++
    this.cancelRetry()
    this.options.hid?.removeEventListener('connect', this.onHidConnect)
    this.options.hid?.removeEventListener('disconnect', this.onHidDisconnect)
    this.listeners.clear()
    const session = this.session
    this.session = null
    await session?.dispose()
  }

  /** デバイス選択ダイアログを出して接続する。 */
  async connect(): Promise<void> {
    const hid = this.options.hid
    if (!hid) {
      this.publish({ ...IDLE, status: 'error', error: messages.connection.noWebHid })
      return
    }
    const picked = await hid.requestDevice({ filters: VIAL_HID_FILTERS })
    const chosen = picked.find(isVialDevice) ?? picked[0]
    if (!chosen || this.disposed) return
    this.autoReconnect = true
    this.stopReconnecting()

    // 許可はVID/PID単位なので、同じキーボードの別経路(USBとBT)も一緒に許可されている。
    // 選ばれたものを先頭にして、同じVID/PIDのVialインターフェースをすべて候補にする
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

  /** 実機なしで画面を確認するためのもの。 */
  async connectMock(): Promise<void> {
    this.autoReconnect = false
    this.stopReconnecting()
    this.search++ // 探索中なら、その結果は使わない
    const transport = this.options.createMock?.() ?? new MockTransport({ unlocked: false })
    this.mock = transport instanceof MockTransport ? transport : null
    await this.attach(transport, false)
  }

  /**
   * モックのキーを押す/離す(押すたびに切り替わる)。モックでなければ何もしない。
   * マウスでは1つしか押さえられないので、押したままにできるようにしてある
   * (アンロックは2つ同時に押し続ける必要がある)。
   */
  toggleMockKey(row: number, col: number): void {
    const mock = this.mock
    if (!mock) return
    if (mock.isPressed(row, col)) mock.release(row, col)
    else mock.press(row, col)
  }

  /**
   * キーボードを解放する(セッションを破棄してHIDを閉じる)。**画面の表示はそのまま残す。**
   *
   * モードを切り替えるとウィンドウごと作り直すので、このウィンドウは間もなく閉じられる。
   * そのあいだに新しいウィンドウの画面が同じキーボードを開きに来るが、raw HIDの応答は
   * 開いている全員に配られ、Vialコマンド(`0xFE`)は照合できないので、両方が話していると
   * 新しい方の読み込みが壊れる。閉じられる前に、こちらから黙って解放する。
   *
   * 「切断」(disconnect)と違ってIDLEを配らないのは、閉じられるまでのあいだ画面が
   * 「未接続」に切り替わって見えるのを避けるため。
   */
  async release(): Promise<void> {
    this.autoReconnect = false
    this.stopReconnecting()
    this.search++
    const session = this.session
    this.session = null
    this.mock = null
    this.device = null
    await session?.dispose()
  }

  async disconnect(): Promise<void> {
    this.autoReconnect = false
    this.stopReconnecting()
    this.search++
    const session = this.session
    this.session = null
    this.mock = null
    this.device = null
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
    // 動いている接続があれば乗り換えない(USBで使っているときにBT側が接続された、など)。
    // 接続している最中('connecting')も、その結果を待つ
    if (this.session && this.current.status !== 'error') return
    if (this.current.status === 'connecting') return
    this.cancelRetry()
    void this.connectToGranted()
  }

  /**
   * 使っていたキーボードが消えた。通信の失敗を待たずに切断し、再接続に入る。
   *
   * 待っても意味が無いうえ、待つと詰まっているだけ(ウィンドウのドラッグ中など)の場合と
   * 区別が付かない。セッションはタイムアウトを15秒まで待つので、そのあいだ「応答待ち」に見えてしまう。
   */
  private readonly onHidDisconnect = (event: HIDConnectionEvent): void => {
    if (this.disposed || this.device === null || event.device !== this.device) return
    this.options.log?.('info', `切断: ${describeDevice(event.device)} が外れた`)

    const session = this.session
    this.session = null
    this.device = null
    // 動いていたものが消えたときだけ再接続する(読み込みの途中で止まったものは繰り返しても同じ)
    if (
      this.autoReconnect &&
      (this.current.status === 'ready' || this.current.status === 'unlocking')
    ) {
      this.reconnecting = true
      this.scheduleRetry()
    }
    this.publish({ ...this.current, status: 'error', error: messages.connection.deviceGone })
    void session?.dispose()
  }

  /** 前に許可したVialデバイスを探して接続する。 */
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
   * 候補のうち、実際に答えるインターフェースに接続する。
   *
   * USBとBluetoothの両方で接続していると、同じキーボードのVialインターフェースが
   * 2つ見え、出力先でない側は答えない(hid/deviceProbe.ts)。確認するあいだは候補を開いたり
   * 閉じたりするので、いまのセッションは先に閉じておく(使っているデバイスを閉じられると壊れる)。
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
        deviceLabel: messages.connection.probing
      })
    }

    const pick = this.options.pickDevice ?? pickResponsiveDevice
    const { device, results } = await pick(candidates)
    if (search !== this.search || this.disposed) return
    if (!device) {
      this.publish({
        ...IDLE,
        status: 'error',
        error: messages.connection.noResponse(results.length)
      })
      if (this.reconnecting) this.scheduleRetry()
      return
    }
    // どのデバイスに接続したかは、不具合を切り分ける手がかりになる(BTでは名前が取れず、往復時間も桁が違う)
    const picked = results.find((result) => result.device === device)
    const answered = results.filter((result) => result.latencyMs !== null).length
    this.options.log?.(
      'info',
      `接続: ${describeDevice(device)}` +
        (picked?.latencyMs != null ? ` 往復 ${Math.round(picked.latencyMs)}ms` : '') +
        (results.length > 1 ? ` (候補 ${results.length} 個中 ${answered} 個が応答)` : '')
    )

    const open = this.options.openTransport ?? ((d: HIDDevice) => new WebHidTransport(d))
    this.device = device
    await this.attach(open(device), true)
  }

  /** 長押しと見なすまでの時間(設定)。いまのセッションにも、これから作るセッションにも効かせる。 */
  setTappingTerm(ms: number): void {
    this.tappingTerm = ms
    this.session?.setTappingTerm(ms)
  }

  /**
   * 新しいtransportでセッションを作り直す。
   *
   * 参照はawaitより前に差し替える。こうしておくと、接続を連打しても
   * 「最後に作ったセッション」だけが生き残り、それ以前のものは必ず破棄される。
   */
  private async attach(transport: Transport, real: boolean): Promise<void> {
    if (real) this.mock = null
    else this.device = null
    const previous = this.session
    const session = new KeyboardSession(transport, {
      ...this.options.sessionOptions,
      definitionCache: real ? this.options.definitionCache : undefined,
      keymapCache: real ? this.options.keymapCache : undefined,
      tappingTerm: this.tappingTerm
    })
    this.session = session

    let worked = false
    session.subscribe((state) => {
      if (this.session !== session) return
      if (state.status === 'unlocking' || state.status === 'ready') {
        worked = true
        this.reconnecting = false
      }
      // 動いていたもの(または再接続の途中のもの)が止まったら、しばらくして再接続する
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

  private publish(state: Omit<ConnectionState, 'reconnecting' | 'mock'>): void {
    if (this.disposed) return
    this.current = { ...state, reconnecting: this.reconnecting, mock: this.mock !== null }
    for (const listener of this.listeners) listener(this.current)
  }
}
