/**
 * アプリの更新を React に渡す。更新は、インストーラーで入れたときだけ使える
 * (src-tauri/src/updater.rs。開発中や deploy:win で置いた exe では unsupported)。
 *
 * 起動して少し待ってから 1 回確かめる。起動の直後はキーボードとの接続でいちばん忙しいので、
 * それと重ねない。このときは force を付けない ― モードを切り替えるたびにウィンドウごと
 * 作り直すので、Rust が少し前の結果を使い回す。「更新を確認」を押したときは問い合わせ直す。
 *
 * ブラウザで開いたとき(window.api が無い)は何もしない。
 */
import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/ipc'
import { reportError, reportInfo } from '../lib/report'

/** 起動してから、最初に確かめるまでの待ち時間。 */
export const STARTUP_CHECK_DELAY_MS = 5000

export type AppUpdate =
  /** まだ確かめていない。 */
  | { phase: 'idle' }
  /** インストーラーで入れていないので、更新できない。 */
  | { phase: 'unsupported' }
  | { phase: 'checking' }
  | { phase: 'latest' }
  | { phase: 'available'; version: string }
  /** 落として入れ替えている。うまくいけばアプリが終わって起動し直す。 */
  | { phase: 'applying'; version: string }
  /** 確かめられなかった(ネットワークなど)。 */
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
    return () => clearTimeout(timer)
  }, [check])

  return { update, check: () => void check(true), apply: (v: string) => void apply(v) }
}
