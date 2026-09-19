/**
 * 接続 → 読み出し → アンロック → matrix ポーリング、の一連を持つフック。
 *
 * HID は renderer の WebHID で扱う(HANDOFF §4)。transport をインターフェースに
 * してあるので、実機が無くてもモックで同じ画面が出せる。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MockTransport } from '../hid/mockTransport'
import {
  VIAL_HID_FILTERS,
  WebHidTransport,
  isVialDevice,
  type Transport
} from '../hid/transport'
import {
  type KeyboardSnapshot,
  getMatrixState,
  getUnlockStatus,
  loadKeyboard,
  unlockPoll,
  unlockStart
} from '../hid/vial'
import { VIAL_UNLOCK_COUNTER_MAX } from '../hid/constants'
import { LayerEngine, emptyMatrix, type LayerSnapshot } from '../engine/layerState'
import { buildGeometry, type KeyboardGeometry } from '../layout/geometry'

/** matrix のポーリング間隔。vial-gui も 20ms(docs/PROTOCOL.md §7)。 */
export const MATRIX_POLL_MS = 20
/** アンロックのポーリング間隔。 */
export const UNLOCK_POLL_MS = 200

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'loading'
  | 'locked'
  | 'unlocking'
  | 'ready'
  | 'error'

export interface UnlockState {
  keys: Array<{ row: number; col: number }>
  counter: number
  max: number
}

export interface VialKeyboardState {
  status: ConnectionStatus
  error: string | null
  deviceLabel: string | null
  snapshot: KeyboardSnapshot | null
  geometry: KeyboardGeometry | null
  engine: LayerEngine | null
  layers: LayerSnapshot | null
  unlock: UnlockState | null
  /** matrix ポーリングが実際に回っているか。 */
  polling: boolean
}

const INITIAL: VialKeyboardState = {
  status: 'idle',
  error: null,
  deviceLabel: null,
  snapshot: null,
  geometry: null,
  engine: null,
  layers: null,
  unlock: null,
  polling: false
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function useVialKeyboard() {
  const [state, setState] = useState<VialKeyboardState>(INITIAL)

  const transportRef = useRef<Transport | null>(null)
  const engineRef = useRef<LayerEngine | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const unlockTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  /** ポーリング中に前の応答を待たずに次を投げないようにする。 */
  const inFlight = useRef(false)

  const stopTimers = useCallback(() => {
    if (pollTimer.current !== null) clearInterval(pollTimer.current)
    if (unlockTimer.current !== null) clearInterval(unlockTimer.current)
    pollTimer.current = null
    unlockTimer.current = null
    inFlight.current = false
  }, [])

  const startPolling = useCallback((snapshot: KeyboardSnapshot) => {
    const transport = transportRef.current
    const engine = engineRef.current
    if (!transport || !engine) return

    stopTimers()
    setState((prev) => ({ ...prev, status: 'ready', polling: true, unlock: null }))

    pollTimer.current = setInterval(() => {
      if (inFlight.current) return // 前の往復が終わるまで待つ
      inFlight.current = true
      void getMatrixState(transport, snapshot.rows, snapshot.cols)
        .then((matrix) => {
          const layers = engine.update(matrix, performance.now())
          setState((prev) => (prev.status === 'ready' ? { ...prev, layers } : prev))
        })
        .catch((error: unknown) => {
          stopTimers()
          setState((prev) => ({
            ...prev,
            status: 'error',
            polling: false,
            error: describeError(error)
          }))
        })
        .finally(() => {
          inFlight.current = false
        })
    }, MATRIX_POLL_MS)
  }, [stopTimers])

  /** 読み込みが終わったあと、ロック状態に応じて次の状態へ進む。 */
  const afterLoad = useCallback(
    async (snapshot: KeyboardSnapshot) => {
      const transport = transportRef.current
      if (!transport) return

      const engine = new LayerEngine({
        layers: snapshot.layers,
        rows: snapshot.rows,
        cols: snapshot.cols,
        keymap: snapshot.keymap,
        tapDance: snapshot.tapDance
      })
      engineRef.current = engine

      const geometry = buildGeometry(snapshot.definition.layouts.keymap, {
        rows: snapshot.rows,
        cols: snapshot.cols
      })

      setState((prev) => ({
        ...prev,
        snapshot,
        geometry,
        engine,
        layers: engine.update(emptyMatrix(snapshot.rows, snapshot.cols), performance.now()),
        error: null
      }))

      if (!snapshot.matrixTestSupported) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'このキーボードでは matrix state を読めない(プロトコルまたは行列サイズの制限)'
        }))
        return
      }

      const status = await getUnlockStatus(transport)
      if (status.unlocked) {
        startPolling(snapshot)
      } else {
        setState((prev) => ({
          ...prev,
          status: 'locked',
          unlock: { keys: status.keys, counter: VIAL_UNLOCK_COUNTER_MAX, max: VIAL_UNLOCK_COUNTER_MAX }
        }))
      }
    },
    [startPolling]
  )

  const attach = useCallback(
    async (transport: Transport) => {
      stopTimers()
      await transportRef.current?.close().catch(() => undefined)
      transportRef.current = transport

      setState({ ...INITIAL, status: 'connecting', deviceLabel: transport.label })
      try {
        await transport.open()
        setState((prev) => ({ ...prev, status: 'loading' }))
        const snapshot = await loadKeyboard(transport)
        await afterLoad(snapshot)
      } catch (error) {
        setState((prev) => ({ ...prev, status: 'error', error: describeError(error) }))
      }
    },
    [afterLoad, stopTimers]
  )

  /** デバイス選択ダイアログを出して繋ぐ。 */
  const connect = useCallback(async () => {
    if (!navigator.hid) {
      setState((prev) => ({ ...prev, status: 'error', error: 'WebHID が使えない' }))
      return
    }
    const devices = await navigator.hid.requestDevice({ filters: VIAL_HID_FILTERS })
    const device = devices.find(isVialDevice) ?? devices[0]
    if (!device) return
    await attach(new WebHidTransport(device))
  }, [attach])

  /** 実機なしで画面を確かめる用。 */
  const connectMock = useCallback(async () => {
    await attach(new MockTransport({ unlocked: false }))
  }, [attach])

  const disconnect = useCallback(async () => {
    stopTimers()
    await transportRef.current?.close().catch(() => undefined)
    transportRef.current = null
    engineRef.current = null
    setState(INITIAL)
  }, [stopTimers])

  /** アンロック手順を始める。進行中は VIA コマンドが通らないので matrix は止めておく。 */
  const beginUnlock = useCallback(() => {
    const transport = transportRef.current
    const snapshot = state.snapshot
    if (!transport || !snapshot) return

    stopTimers()
    setState((prev) => ({ ...prev, status: 'unlocking', polling: false }))

    void unlockStart(transport).then(() => {
      unlockTimer.current = setInterval(() => {
        void unlockPoll(transport)
          .then((progress) => {
            setState((prev) => ({
              ...prev,
              unlock: prev.unlock
                ? { ...prev.unlock, counter: progress.counter }
                : { keys: [], counter: progress.counter, max: VIAL_UNLOCK_COUNTER_MAX }
            }))
            if (progress.unlocked) {
              stopTimers()
              startPolling(snapshot)
            }
          })
          .catch((error: unknown) => {
            stopTimers()
            setState((prev) => ({
              ...prev,
              status: 'error',
              error: describeError(error)
            }))
          })
      }, UNLOCK_POLL_MS)
    })
  }, [startPolling, state.snapshot, stopTimers])

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

  useEffect(() => stopTimers, [stopTimers])

  return { ...state, connect, connectMock, disconnect, beginUnlock }
}
