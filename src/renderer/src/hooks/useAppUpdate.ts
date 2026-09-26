/**
 * アプリの更新をReactに渡す。更新は、インストーラーで入れたときだけ使える
 * (src-tauri/src/updater.rs。開発中やdeploy:winで置いたexeではunsupported)。
 *
 * 起動して少し待ってから1回確認する。起動の直後はキーボードとの接続でいちばん忙しいので、
 * それと重ねない。このときはforceを付けない。モードを切り替えるたびにウィンドウごと
 * 作り直すので、Rustが少し前の結果を使い回す。「更新を確認」を押したときは問い合わせ直す。
 *
 * 起動したまま何日も使うことがある(オーバーレイは出しっぱなしにしがち)ので、そのあとも
 * UPDATE_CHECK_INTERVAL_MSごとに裏で確認する。裏の確認では表示を「確認中」にせず、失敗しても
 * 前の表示のままにする(設定パネルを開いているときに、表示がちらつかないように)。
 *
 * ブラウザで開いたとき(window.apiが無い)は何もしない。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '../../../shared/ipc'
import { reportError, reportInfo } from '../lib/report'

/** 起動してから、最初に確認するまでの待ち時間。 */
export const STARTUP_CHECK_DELAY_MS = 5000

/** 起動したあと、裏で確認し直す間隔。 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type AppUpdate =
  /** まだ確認していない。 */
  | { phase: 'idle' }
  /** インストーラーで入れていないので、更新できない。 */
  | { phase: 'unsupported' }
  | { phase: 'checking' }
  | { phase: 'latest' }
  | { phase: 'available'; version: string }
  /** ダウンロードして入れ替えている。成功するとアプリが終了して起動し直す。 */
  | { phase: 'applying'; version: string }
  /** 確認できなかった(ネットワークなど)。 */
  | { phase: 'failed' }
  /** 入れられなかった。もう一度試せる。 */
  | { phase: 'applyFailed'; version: string }

export function toAppUpdate(status: UpdateStatus): AppUpdate {
  switch (status.kind) {
    case 'unsupported':
      return { phase: 'unsupported' }
    case 'latest':
      return { phase: 'latest' }
    case 'available':
      return { phase: 'available', version: status.version }
  }
}

export function useAppUpdate() {
  const [update, setUpdate] = useState<AppUpdate>({ phase: 'idle' })
  /** 裏の確認から、いまの表示を見るため(effectを張り直さずに済むように)。 */
  const current = useRef(update)
  current.current = update

  const check = useCallback(async (force: boolean) => {
    const api = window.api
    if (!api) return
    setUpdate({ phase: 'checking' })
    try {
      setUpdate(toAppUpdate(await api.checkForUpdate(force)))
    } catch (error) {
      // ネットワークが無いだけのことが多い。エラーとしては残さない
      reportInfo(`更新を確認できなかった: ${String(error)}`)
      setUpdate({ phase: 'failed' })
    }
  }, [])

  /** 裏の確認。新しい版が見つかったときだけ表示を変える。 */
  const checkInBackground = useCallback(async () => {
    const api = window.api
    const phase = current.current.phase
    // 見つけたあと・入れている最中・入れられなかったあとは、表示を変えない
    if (!api || phase === 'available' || phase === 'applying' || phase === 'applyFailed') return
    try {
      const next = toAppUpdate(await api.checkForUpdate(false))
      if (next.phase === 'available') setUpdate(next)
    } catch (error) {
      reportInfo(`更新を確認できなかった: ${String(error)}`)
    }
  }, [])

  const apply = useCallback(async (version: string) => {
    const api = window.api
    if (!api) return
    setUpdate({ phase: 'applying', version })
    try {
      await api.applyUpdate()
    } catch (error) {
      reportError(`更新を入れられなかった(v${version})`, String(error))
      setUpdate({ phase: 'applyFailed', version })
    }
  }, [])

  useEffect(() => {
    if (!window.api) return
    const timer = setTimeout(() => void check(false), STARTUP_CHECK_DELAY_MS)
    const interval = setInterval(() => void checkInBackground(), UPDATE_CHECK_INTERVAL_MS)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
    }
  }, [check, checkInBackground])

  return { update, check: () => void check(true), apply: (v: string) => void apply(v) }
}
