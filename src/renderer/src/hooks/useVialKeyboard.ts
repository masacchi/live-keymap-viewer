/**
 * KeyboardSession を React につなぐ薄いフック。
 *
 * 接続のライフサイクル(読み込み・アンロック・ポーリング・読み直し)は
 * session/keyboardSession.ts が持つ。ここでやるのは
 *
 *   - デバイスの選び方(WebHID の選択ダイアログ / 前回許可したもの / モック)
 *   - セッションの差し替えと破棄
 *   - ウィンドウのフォーカス復帰で読み直す
 *
 * だけ。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalStorageDefinitionCache } from '../hid/definitionCache'
import { pickResponsiveDevice } from '../hid/deviceProbe'
import { MockTransport } from '../hid/mockTransport'
import { isVialDevice, type Transport, VIAL_HID_FILTERS, WebHidTransport } from '../hid/transport'
import {
  KeyboardSession,
  type SessionOptions,
  type SessionState,
  type SessionStatus
} from '../session/keyboardSession'

export type { UnlockState } from '../session/keyboardSession'

/** セッションが無いときの 'idle' を足したもの。 */
export type ConnectionStatus = 'idle' | SessionStatus

export type VialKeyboardState = Omit<SessionState, 'status' | 'deviceLabel'> & {
  status: ConnectionStatus
  deviceLabel: string | null
}

const IDLE: VialKeyboardState = {
  status: 'idle',
  error: null,
  deviceLabel: null,
  snapshot: null,
  geometry: null,
  engine: null,
  layers: null,
  unlock: null,
  reloading: false
}

/** 実機の定義はキャッシュする(モックには使わない)。 */
const definitionCache = new LocalStorageDefinitionCache()

export function useVialKeyboard() {
  const [state, setState] = useState<VialKeyboardState>(IDLE)
  const sessionRef = useRef<KeyboardSession | null>(null)
  /** デバイス探しの世代。接続を連打したとき、古い探索の結果を使わないため。 */
  const searchRef = useRef(0)

  /**
   * 新しい transport でセッションを作り直す。
   *
   * 参照は await より前に差し替える。こうしておくと、接続を連打しても
   * 「最後に作ったセッション」だけが生き残り、それ以前のものは必ず破棄される。
   */
  const attach = useCallback(async (transport: Transport, options: SessionOptions = {}) => {
    const previous = sessionRef.current
    const session = new KeyboardSession(transport, options)
    sessionRef.current = session
    session.subscribe(setState)

    await previous?.dispose()
    if (sessionRef.current !== session) return // さらに新しい接続に取って代わられた
    await session.start()
  }, [])

  /**
   * 候補のうち、実際に答えるインターフェースに繋ぐ。
   *
   * USB と Bluetooth の両方で繋がっていると、同じキーボードの Vial インターフェースが
   * 2 つ見え、出力先でない側は答えない(hid/deviceProbe.ts)。確かめる間は候補を開き閉じ
   * するので、いまのセッションは先に閉じておく(開いたまま閉じられると壊れる)。
   */
  const connectToResponsive = useCallback(
    async (candidates: HIDDevice[]) => {
      if (candidates.length === 0) return
      const search = ++searchRef.current

      const previous = sessionRef.current
      sessionRef.current = null
      await previous?.dispose()
      if (candidates.length > 1) {
        setState({ ...IDLE, status: 'connecting', deviceLabel: '応答するインターフェースを確認中' })
      }

      const { device, results } = await pickResponsiveDevice(candidates)
      if (search !== searchRef.current) return // もっと新しい接続の操作があった
      if (!device) {
        setState({
          ...IDLE,
          status: 'error',
          error:
            `キーボードが応答しない(${results.length} 個のインターフェースを試した)。` +
            'Vial など別のアプリで使っていないか、USB / Bluetooth の出力先を確かめる'
        })
        return
      }
      await attach(new WebHidTransport(device), { definitionCache })
    },
    [attach]
  )

  /** デバイス選択ダイアログを出して繋ぐ。 */
  const connect = useCallback(async () => {
    if (!navigator.hid) {
      setState({ ...IDLE, status: 'error', error: 'WebHID が使えない' })
      return
    }
    const picked = await navigator.hid.requestDevice({ filters: VIAL_HID_FILTERS })
    const chosen = picked.find(isVialDevice) ?? picked[0]
    if (!chosen) return

    // 許可は VID/PID 単位なので、同じキーボードの別経路(USB と BT)も一緒に許可されている。
    // 選ばれたものを先頭にして、同じ VID/PID の Vial インターフェースをすべて候補にする
    const granted = await navigator.hid.getDevices()
    const siblings = granted.filter(
      (d) =>
        d !== chosen &&
        isVialDevice(d) &&
        d.vendorId === chosen.vendorId &&
        d.productId === chosen.productId
    )
    await connectToResponsive([chosen, ...siblings])
  }, [connectToResponsive])

  /** 実機なしで画面を確かめる用。 */
  const connectMock = useCallback(async () => {
    searchRef.current++ // 探索中なら、その結果は使わない
    await attach(new MockTransport({ unlocked: false }))
  }, [attach])

  const disconnect = useCallback(async () => {
    searchRef.current++
    const session = sessionRef.current
    sessionRef.current = null
    setState(IDLE)
    await session?.dispose()
  }, [])

  /**
   * 手動の読み直し。定義もキャッシュを使わずに読み直す(ファームを焼き直したときの逃げ道)。
   * ポーリング中でなければ何もしない。
   */
  const reload = useCallback(async () => {
    await sessionRef.current?.reload({ full: true })
  }, [])

  /** 起動時、前に許可したデバイスがあれば、答えるものに自動で繋ぐ。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!navigator.hid) return
      const devices = (await navigator.hid.getDevices()).filter(isVialDevice)
      if (devices.length > 0 && !cancelled) await connectToResponsive(devices)
    })()
    return () => {
      cancelled = true
    }
  }, [connectToResponsive])

  /**
   * ウィンドウにフォーカスが戻ったら読み直す。
   * Vial で編集 → このアプリに切り替える、という流れがそのまま反映される。
   * オーバーレイはクリック透過でフォーカスを取らないので、そちらでは発火しない。
   */
  useEffect(() => {
    // こちらはキーマップだけ。フォーカスのたびに定義まで読むのは重い
    const onFocus = (): void => void sessionRef.current?.reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // アンマウントで閉じる
  useEffect(
    () => () => {
      void sessionRef.current?.dispose()
    },
    []
  )

  return { ...state, connect, connectMock, disconnect, reload }
}
