import { describe, expect, it } from 'vitest'
import {
  clampOpacity,
  DEFAULT_SETTINGS,
  ensureOnScreen,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  OVERLAY_OPACITY_MIN,
  sanitizeBounds,
  sanitizeSettings,
  withLayerName
} from '../src/shared/settings'

describe('sanitizeSettings', () => {
  it('無い・壊れているときは既定値', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('garbage')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings([])).toEqual(DEFAULT_SETTINGS)
  })

  it('正しい値はそのまま通す', () => {
    const settings = {
      mode: 'overlay',
      labelMode: 'us',
      normalBounds: { x: 10, y: 20, width: 800, height: 400 },
      overlayBounds: { x: 30, y: 40, width: 900, height: 500 },
      overlayOpacity: 0.5,
      overlayAutoFade: false,
      encoderPlacement: 'top',
      grantedDevices: [{ vendorId: 0xe118, productId: 1, name: 'Cornix' }],
      layerNames: { '16882930253541522617': ['基本', '', '記号'] }
    }
    expect(sanitizeSettings(settings)).toEqual(settings)
  })

  it('知らない値は項目ごとに既定値へ戻す(ほかの項目は残す)', () => {
    const result = sanitizeSettings({
      mode: 'fullscreen',
      labelMode: 'dvorak',
      overlayOpacity: 'abc',
      normalBounds: { x: 1, y: 2, width: 800, height: 400 }
    })
    expect(result.mode).toBe('normal')
    expect(result.labelMode).toBe('jis')
    expect(result.overlayOpacity).toBe(DEFAULT_SETTINGS.overlayOpacity)
    expect(result.normalBounds).toEqual({ x: 1, y: 2, width: 800, height: 400 })
  })

  it('壊れたデバイス記録は捨てる', () => {
    const result = sanitizeSettings({
      grantedDevices: [
        { vendorId: 1, productId: 2 },
        { vendorId: '1', productId: 2 },
        { vendorId: 1.5, productId: 2 },
        null,
        { vendorId: 3, productId: 4, name: 42 }
      ]
    })
    expect(result.grantedDevices).toEqual([
      { vendorId: 1, productId: 2 },
      { vendorId: 3, productId: 4 }
    ])
  })

  it('余計な項目は落とす', () => {
    expect(sanitizeSettings({ evil: true })).not.toHaveProperty('evil')
  })
})

describe('オーバーレイの自動フェード', () => {
  it('既定は有効。false と書いてあるときだけ無効にする', () => {
    expect(sanitizeSettings({}).overlayAutoFade).toBe(true)
    expect(sanitizeSettings({ overlayAutoFade: 'no' }).overlayAutoFade).toBe(true)
    expect(sanitizeSettings({ overlayAutoFade: false }).overlayAutoFade).toBe(false)
  })
})

describe('ノブの置き場所', () => {
  it('既定は下。top と書いてあるときだけ上にする', () => {
    expect(sanitizeSettings({}).encoderPlacement).toBe('bottom')
    expect(sanitizeSettings({ encoderPlacement: 'left' }).encoderPlacement).toBe('bottom')
    expect(sanitizeSettings({ encoderPlacement: 'top' }).encoderPlacement).toBe('top')
  })
})

describe('レイヤー名', () => {
  const UID = '16882930253541522617'

  it('キーボードの UID ごとに読み、UID でないキーや壊れた並びは捨てる', () => {
    const settings = sanitizeSettings({
      layerNames: {
        [UID]: ['基本', '', '記号'],
        __proto__: ['x'],
        'not-a-uid': ['x'],
        '123': 'not an array'
      }
    })
    expect(settings.layerNames).toEqual({ [UID]: ['基本', '', '記号'] })
  })

  it('長すぎる名前は切り、文字列でなければ名前なしにし、末尾の名前なしは落とす', () => {
    const long = 'あ'.repeat(20)
    const settings = sanitizeSettings({ layerNames: { [UID]: [` ${long} `, 42, '', ''] } })
    expect(settings.layerNames[UID]).toEqual(['あ'.repeat(12)])
  })

  it('1 つだけ変えられ、空にすると消える(何も残らなければキーボードごと消える)', () => {
    const named = withLayerName({}, UID, 2, '記号')
    expect(named).toEqual({ [UID]: ['', '', '記号'] })
    expect(withLayerName(named, UID, 0, '基本')[UID]).toEqual(['基本', '', '記号'])
    expect(withLayerName(named, UID, 2, '  ')).toEqual({})
  })
})

describe('clampOpacity', () => {
  it('薄すぎると操作パネルごと見えなくなるので下限で止める', () => {
    expect(clampOpacity(0)).toBe(OVERLAY_OPACITY_MIN)
    expect(clampOpacity(2)).toBe(1)
    expect(clampOpacity(0.5)).toBe(0.5)
  })

  it('数値でなければ既定値', () => {
    expect(clampOpacity(Number.NaN)).toBe(DEFAULT_SETTINGS.overlayOpacity)
    expect(clampOpacity(undefined)).toBe(DEFAULT_SETTINGS.overlayOpacity)
  })
})

describe('sanitizeBounds', () => {
  it('小さすぎるサイズは最小サイズまで広げる', () => {
    expect(sanitizeBounds({ x: 0, y: 0, width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT
    })
  })

  it('数値として壊れていれば null', () => {
    expect(sanitizeBounds({ x: 0, y: 0, width: Number.NaN, height: 100 })).toBeNull()
    expect(sanitizeBounds({ x: 0, y: 0 })).toBeNull()
  })
})

describe('ensureOnScreen', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const secondary = { x: 1920, y: 0, width: 1920, height: 1040 }

  it('画面に見えていればそのまま', () => {
    const bounds = { x: 100, y: 100, width: 800, height: 400 }
    expect(ensureOnScreen(bounds, [primary])).toEqual(bounds)
  })

  it('2 枚目の画面に置いてあれば、それも見えているうちに入る', () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 400 }
    expect(ensureOnScreen(bounds, [primary, secondary])).toEqual(bounds)
  })

  it('外したモニターの上にあったら、主画面の中央に戻す', () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 400 }
    expect(ensureOnScreen(bounds, [primary])).toEqual({
      x: 560,
      y: 320,
      width: 800,
      height: 400
    })
  })

  it('上端(つかむところ)が画面外なら、見えていないのと同じ', () => {
    // 上に大きくはみ出していて、上端 40px がどの画面にも無い
    const bounds = { x: 100, y: -300, width: 800, height: 400 }
    const result = ensureOnScreen(bounds, [primary])
    expect(result.y).toBeGreaterThanOrEqual(0)
  })

  it('主画面より大きければ主画面に収める', () => {
    const bounds = { x: 9000, y: 9000, width: 4000, height: 3000 }
    expect(ensureOnScreen(bounds, [primary])).toEqual(primary)
  })

  it('画面の情報が取れないときは触らない', () => {
    const bounds = { x: 9000, y: 9000, width: 800, height: 400 }
    expect(ensureOnScreen(bounds, [])).toEqual(bounds)
  })
})
