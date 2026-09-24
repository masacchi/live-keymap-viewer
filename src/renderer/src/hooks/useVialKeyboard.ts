/**
 * キーボードとの接続(session/keyboardConnection.ts)を React につなぐ薄いフック。
 *
 * デバイスの選び方・セッションの差し替え・切れたときの繋ぎ直しは KeyboardConnection が持つ。
 * ここでやるのは、状態を React に渡すことだけ。
 *
 * キーマップの読み直しは手動(「キーマップを読み直す」)だけにしてある。以前はウィンドウに
 * フォーカスが戻るたびに読み直していたが、BT では 1 回 30 秒以上かかり、そのあいだ
 * 「読み直し中…」が出続ける。繋いだときに読んでいる(キャッシュなら裏で確かめている)ので、
 * 戻るたびに読む必要は無い、と判断した。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalStorageDefinitionCache } from '../hid/definitionCache'
import { LocalStorageKeymapCache } from '../hid/keymapCache'
import { report, reportError, reportInfo } from '../lib/report'
import { nativeHid } from '../platform/tauri'
import { type ConnectionState, IDLE, KeyboardConnection } from '../session/keyboardConnection'

export type {
  ConnectionState as VialKeyboardState,
  ConnectionStatus
} from '../session/keyboardConnection'
export type { UnlockState } from '../session/keyboardSession'

/** 実機の定義とキーマップはキャッシュする(モックには使わない)。 */
const definitionCache = new LocalStorageDefinitionCache()
const keymapCache = new LocalStorageKeymapCache()

/**
 * 接続の区切りを main のログに残す見張り。**切れた理由は、実機では後から追えない**ので。
 *
 * 残すのは「エラーになった」「応答待ちに入った / 戻った(何秒詰まったか)」だけ。
 * 応答待ちは、ウィンドウのドラッグ中に main が止まると出る(keyboardSession.ts の STALL_LIMIT_MS)ので、
 * 切断まで至ったのか、詰まって戻っただけなのかが、これで区別できる。
 */
function watchForLog(next: (state: ConnectionState) => void): (state: ConnectionState) => void {
  let lastError: string | null = null
  let stalledSince: number | null = null
  return (state) => {
    if (state.error !== lastError) {
      if (state.error) reportError(`接続: ${state.error}`)
      lastError = state.error
    }
    if (state.stalled && stalledSince === null) {
      stalledSince = Date.now()
      reportInfo('接続: 応答待ちに入った')
    } else if (!state.stalled && stalledSince !== null) {
      const seconds = ((Date.now() - stalledSince) / 1000).toFixed(1)
      reportInfo(`接続: 応答待ちから戻った(${seconds} 秒)`)
      stalledSince = null
    }
    next(state)
  }
}

/**
 * @param tappingTerm 長押しと見なすまでの時間(設定)。変わったら動いている接続にもすぐ効かせる
 */
export function useVialKeyboard(tappingTerm?: number) {
  const [state, setState] = useState(IDLE)
  const connectionRef = useRef<KeyboardConnection | null>(null)

  // 接続は effect の中で作って、片付けで捨てる。StrictMode では開発時に 2 回走るが、
  // 1 回目のものは dispose されるので、HID のイベントもタイマーも残らない
  useEffect(() => {
    const connection = new KeyboardConnection({
      // Tauri では Rust の hidapi、ブラウザ(npm run dev)では WebHID
      hid: nativeHid ?? navigator.hid ?? null,
      definitionCache,
      keymapCache,
      log: report
    })
    connectionRef.current = connection
    const unsubscribe = connection.subscribe(watchForLog(setState))
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
