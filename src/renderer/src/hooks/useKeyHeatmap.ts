/**
 * 打鍵のヒートマップを数える(lib/heatmap.ts)。設定の「打鍵を数える」がオンのときだけ数える。
 *
 * 押しているキーの一覧を前回と比べ、新しく加わったキーを1回と数える(押しっぱなしは1回)。
 * localStorageには押すたびには書かず、10秒ごとと、画面を閉じるときにまとめて書く。
 * モードを切り替えるとウィンドウを作り直すので、そのときは最後の10秒ほどの数を落とすことがある
 * (毎回書くより軽い方を取る)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LayerSnapshot } from '../engine/layerState'
import { countNewPresses, type HeatmapData, HeatmapStore } from '../lib/heatmap'

/** まとめて書く間隔(ms)。 */
const FLUSH_MS = 10_000

const defaultStore = new HeatmapStore()

function fresh(): HeatmapData {
  return { since: new Date().toISOString(), counts: {} }
}

/**
 * @param enabled 数えるか(設定)
 * @param uid     数えるキーボード。モックや未接続ならnull(数えない)
 * @param layers  いまの押下の状態
 */
export function useKeyHeatmap(
  enabled: boolean,
  uid: string | null,
  layers: LayerSnapshot | null,
  store: HeatmapStore = defaultStore
) {
  const [data, setData] = useState<HeatmapData | null>(null)
  const current = useRef<HeatmapData | null>(null)
  const dirty = useRef(false)
  const previous = useRef<ReadonlySet<string>>(new Set())

  // キーボードが変わったら、そのキーボードの数を読む
  useEffect(() => {
    const loaded = uid ? (store.load(uid) ?? fresh()) : null
    current.current = loaded
    dirty.current = false
    setData(loaded)
  }, [uid, store])

  // 新しく押されたキーを数える
  useEffect(() => {
    const held = new Set(layers?.held.keys() ?? [])
    const data = current.current
    if (enabled && data) {
      const counts = countNewPresses(data.counts, previous.current, held)
      if (counts !== data.counts) {
        current.current = { ...data, counts: { ...counts } }
        dirty.current = true
        setData(current.current)
      }
    }
    previous.current = held
  }, [layers, enabled])

  // まとめて書く
  useEffect(() => {
    if (!uid) return
    const flush = (): void => {
      if (!dirty.current || !current.current) return
      store.save(uid, current.current)
      dirty.current = false
    }
    const timer = setInterval(flush, FLUSH_MS)
    window.addEventListener('pagehide', flush)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [uid, store])

  const reset = useCallback(() => {
    if (!uid) return
    store.clear(uid)
    current.current = fresh()
    dirty.current = false
    setData(current.current)
  }, [uid, store])

  return { data, reset }
}
