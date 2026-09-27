import { describe, expect, it } from 'vitest'
import { matrixKey, RoundTripStats } from '@/session/roundTripStats'

describe('押下を読む往復の集計', () => {
  it('変わった回と変わらなかった回に分けて、中央値と最大を1行にする', () => {
    const stats = new RoundTripStats()
    for (const ms of [460, 470, 480]) stats.add(ms, false)
    for (const ms of [20, 40]) stats.add(ms, true)
    expect(stats.flush()).toBe(
      '往復: 押下が変わった回 2回(中央値30ms・最大40ms) / 変わらなかった回 3回(中央値470ms・最大480ms)'
    )
    // 集計したら空に戻る
    expect(stats.flush()).toBeNull()
  })

  it('速い接続(USB)では残さない(ログが埋まらないように)', () => {
    const stats = new RoundTripStats()
    for (const ms of [2, 3, 4]) stats.add(ms, false)
    stats.add(3, true)
    expect(stats.flush()).toBeNull()
  })

  it('matrixを比べられる形にする', () => {
    expect(
      matrixKey([
        [true, false],
        [false, false]
      ])
    ).toBe('10|00')
  })
})
