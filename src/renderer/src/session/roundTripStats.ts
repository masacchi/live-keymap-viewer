/**
 * 押下を読む往復の時間を、「押下が変わった回」と「変わらなかった回」に分けて数える。
 *
 * Bluetooth(BLE)は、送るものが無いあいだは通信を間引く(スレーブレイテンシ。docs/BLUETOOTH.md §2.4)。
 * ただしキーを押す・離すと、キーボードがOSに入力を送るために通信が起きるので、そのとき待っている
 * 要求にもすぐ答えるはず。そうなら「変わった回」の往復は、「変わらなかった回」(間引かれた往復)より
 * 短くなる。長押しをタイマーで確定する(次の応答を待たない)のは、この前提に立っているので、
 * 実機のログで確かめられるようにする。
 */

/** 何も変わらないときの往復がこれ以上なら、遅い接続(Bluetooth)とみなしてログに残す。 */
export const SLOW_LINK_MS = 100

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function describe(label: string, values: readonly number[]): string {
  if (values.length === 0) return `${label} 0回`
  const max = Math.max(...values)
  return `${label} ${values.length}回(中央値${Math.round(median(values))}ms・最大${Math.round(max)}ms)`
}

export class RoundTripStats {
  private changed: number[] = []
  private unchanged: number[] = []

  add(ms: number, changed: boolean): void {
    ;(changed ? this.changed : this.unchanged).push(ms)
  }

  /**
   * 集めた分をログの1行にして、空に戻す。遅い接続でなければ(USBなど)null。
   * USBでも毎回残すと、ログ(最大500行)がこれで埋まってしまう。
   */
  flush(): string | null {
    const { changed, unchanged } = this
    this.changed = []
    this.unchanged = []
    if (unchanged.length === 0 || median(unchanged) < SLOW_LINK_MS) return null
    return `往復: ${describe('押下が変わった回', changed)} / ${describe('変わらなかった回', unchanged)}`
  }
}

/** matrixを比べられる形にする(8行7列なら数十文字)。 */
export function matrixKey(matrix: readonly (readonly boolean[])[]): string {
  return matrix.map((row) => row.map((pressed) => (pressed ? '1' : '0')).join('')).join('|')
}
