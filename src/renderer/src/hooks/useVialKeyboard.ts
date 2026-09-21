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
import { MockTransport } from '../hid/mockTransport'
import { isVialDevice, type Transport, VIAL_HID_FILTERS, WebHidTransport } from '../hid/transport'
import { KeyboardSession, type SessionState, type SessionStatus } from '../session/keyboardSession'

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

export function useVialKeyboard() {
  const [state, setState] = useState<VialKeyboardState>(IDLE)
  const sessionRef = useRef<KeyboardSession | null>(null)

  /**
   * 新しい transport でセッションを作り直す。
   *
   * 参照は await より前に差し替える。こうしておくと、接続を連打しても
   * 「最後に作ったセッション」だけが生き残り、それ以前のものは必ず破棄される。
   */
  const attach = useCallback(async (transport: Transport) => {
    const previous = sessionRef.current
    const session = new KeyboardSession(transport)
    sessionRef.current = session
    session.subscribe(setState)

    await previous?.dispose()
    if (sessionRef.current !== session) return // さらに新しい接続に取って代わられた
    await session.start()
  }, [])

  /** デバイス選択ダイアログを出して繋ぐ。 */
  const connect = useCallback(async () => {
    if (!navigator.hid) {
      setState({ ...IDLE, status: 'error', error: 'WebHID が使えない' })
      return
    }
    const devices = await navigator.hid.requestDevice({ filters: VIAL_HID_FILTERS })
    const device = devices.find(isVialDevice) ?? devices[0]
    if (device) await attach(new WebHidTransport(device))
  }, [attach])

  /** 実機なしで画面を確かめる用。 */
  const connectMock = useCallback(async () => {
    await attach(new MockTransport({ unlocked: false }))
  }, [attach])

  const disconnect = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = null
    setState(IDLE)
    await session?.dispose()
  }, [])

  /** キーマップを読み直す。ポーリング中でなければ何もしない。 */
  const reload = useCallback(async () => {
    await sessionRef.current?.reload()
  }, [])

  /** 起動時、前に許可したデバイスがあれば自動で繋ぐ。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!navigator.hid) return
      const devices = await navigator.hid.getDevices()
      const device = devices.find(isVialDevice)
      if (device && !cancelled) await attach(new WebHidTransport(device))
    })()
    return () => {
      cancelled = true
    }
  }, [attach])

  /**
   * ウィンドウにフォーカスが戻ったら読み直す。
   * Vial で編集 → このアプリに切り替える、という流れがそのまま反映される。
   * オーバーレイはクリック透過でフォーカスを取らないので、そちらでは発火しない。
   */
  useEffect(() => {
    const onFocus = (): void => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  // アンマウントで閉じる
  useEffect(
    () => () => {
      void sessionRef.current?.dispose()
    },
    []
  )

  return { ...state, connect, connectMock, disconnect, reload }
}
