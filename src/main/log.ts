/**
 * 配布ビルドの診断用ログ(userData/log.txt)。
 *
 * 開発は WSL、動かすのは Windows なので、実機で何かが起きても開発側の端末には何も残らない。
 * 配布ビルドでは DevTools も開けない。そこで「まれにしか起きない出来事」だけをファイルに残す:
 *
 *   - 起動(版と Electron の版。どのビルドが動いていたかが分かる)
 *   - main の警告(ショートカットの登録失敗、ぼかしの切り替え失敗)
 *   - main で処理されなかった例外・拒否
 *   - renderer から報告された画面のエラー(components/ErrorBoundary.tsx)
 *
 * ポーリングのような毎秒起きることは書かない。まれなので書き込みは同期でよく、そのぶん
 * 落ちる直前の 1 行を取りこぼさない。無限に伸びないよう、MAX_LINES を超えたら古い方から捨てる。
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/** 残す行数。1 行 100 文字として 50KB ほど。 */
const MAX_LINES = 500

export type LogLevel = 'info' | 'warn' | 'error'

/** 直近のログ(メモリ側の控え)。書き直すときの元になる。 */
let kept: string[] | null = null

export function logPath(): string {
  return join(app.getPath('userData'), 'log.txt')
}

function load(): string[] {
  if (kept) return kept
  try {
    kept = readFileSync(logPath(), 'utf8').split('\n').filter(Boolean).slice(-MAX_LINES)
  } catch {
    kept = [] // 無い・読めない → 空から始める
  }
  return kept
}

/** 例外は名前・文言・スタックまで残す(スタックが無ければそのまま文字にする)。 */
function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

export function log(level: LogLevel, message: string, detail?: unknown): void {
  const entry =
    `${new Date().toISOString()} [${level}] ${message}` +
    (detail === undefined ? '' : ` ${describe(detail)}`)

  // 開発中は端末で読む。ファイルは配布ビルドのためのもの
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)

  const lines = load()
  lines.push(...entry.split('\n'))
  try {
    const path = logPath()
    mkdirSync(dirname(path), { recursive: true })
    if (lines.length > MAX_LINES) {
      lines.splice(0, lines.length - MAX_LINES)
      writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
    } else {
      appendFileSync(path, `${entry}\n`, 'utf8')
    }
  } catch {
    // ログが書けないこと自体でアプリを止めない(端末には出ている)
  }
}

/**
 * 起動の印を残し、main で拾われなかった例外を記録する。
 *
 * 例外を拾ってもアプリは終わらせない。キーボードの表示はほとんど renderer 側で動いていて、
 * main が 1 つ転んでも画面は使えることが多い。黙って消えるより、記録を残して動き続ける方がよい。
 */
export function installLogging(): void {
  log('info', `起動 v${app.getVersion()} (electron ${process.versions.electron})`)
  process.on('uncaughtException', (error) => log('error', 'main で処理されない例外', error))
  process.on('unhandledRejection', (reason) => log('error', 'main で処理されない拒否', reason))
}
