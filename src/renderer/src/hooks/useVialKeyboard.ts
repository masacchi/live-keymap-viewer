/**
 * キーボードとの接続(session/keyboardConnection.ts)を React につなぐ薄いフック。
 *
 * デバイスの選び方・セッションの差し替え・切れたときの繋ぎ直しは KeyboardConnection が持つ。
 * ここでやるのは、状態を React に渡すことと、ウィンドウのフォーカス復帰で読み直すことだけ。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalStorageDefinitionCache } from '../hid/definitionCache'
import { IDLE, KeyboardConnection } from '../session/keyboardConnection'

export type {
  ConnectionState as VialKeyboardState,
  ConnectionStatus
} from '../session/keyboardConnection'
export type { UnlockState } from '../session/keyboardSession'

/** 実機の定義はキャッシュする(モックには使わない)。 */
const definitionCache = new LocalStorageDefinitionCache()

/**
 * @param tappingTerm 長押しと見なすまでの時間(設定)。変わったら動いている接続にもすぐ効かせる
 */
export function useVialKeyboard(tappingTerm?: number) {
  const [state, setState] = useState(IDLE)
  const connectionRef = useRef<KeyboardConnection | null>(null)

  // 接続は effect の中で作って、片付けで捨てる。StrictMode では開発時に 2 回走るが、
  // 1 回目のものは dispose されるので、HID のイベントもタイマーも残らない
  useEffect(() => {
    const connection = new KeyboardConnection({ hid: navigator.hid ?? null, definitionCache })
    connectionRef.current = connection
    const unsubscribe = connection.subscribe(setState)
    connection.start()
    return () => {
      unsubscribe()
      if (connectionRef.current === connection) connectionRef.current = null
      void connection.dispose()
    }
  }, [])

  useEffect(() => {
    if (tappingTerm !== undefined) connectionRef.current?.setTappingTerm(tappingTerm)
  }, [tappingTerm])

  /**
   * main から「キーボードを手放して」と言われたら、セッションを閉じて返事をする。
   * モードの切り替えでこのウィンドウが作り直される直前に来る。新しいウィンドウの renderer と
   * 同時に同じ HID を開いていると、応答が混ざって新しい方の読み込みが壊れる
   * (session/keyboardConnection.ts の release)。
   */
  useEffect(
    () =>
      window.api?.onReleaseHid(() => {
        const release = connectionRef.current?.release() ?? Promise.resolve()
        void release.finally(() => window.api?.hidReleased())
      }),
    []
  )

  /**
   * ウィンドウにフォーカスが戻ったら読み直す。
   * Vial で編集 → このアプリに切り替える、という流れがそのまま反映される。
   * オーバーレイはクリック透過でフォーカスを取らないので、そちらでは発火しない。
   * こちらはキーマップだけ。フォーカスのたびに定義まで読むのは重い。
   */
  useEffect(() => {
    const onFocus = (): void => void connectionRef.current?.reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const connect = useCallback(async () => {
    await connectionRef.current?.connect()
  }, [])

  const connectMock = useCallback(async () => {
    await connectionRef.current?.connectMock()
  }, [])

  const disconnect = useCallback(async () => {
    await connectionRef.current?.disconnect()
  }, [])

  /**
   * 手動の読み直し。定義もキャッシュを使わずに読み直す(ファームを焼き直したときの逃げ道)。
   * ポーリング中でなければ何もしない。
   */
  const reload = useCallback(async () => {
    await connectionRef.current?.reload({ full: true })
  }, [])

  /** モックのキーを押す/離す。モックでなければ何もしない。 */
  const toggleMockKey = useCallback((row: number, col: number) => {
    connectionRef.current?.toggleMockKey(row, col)
  }, [])

  return { ...state, connect, connectMock, disconnect, reload, toggleMockKey }
}
