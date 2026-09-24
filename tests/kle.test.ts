import { describe, expect, it } from 'vitest'
import { buildGeometry, keyCorners, visibleKeys } from '@/layout/geometry'
import { parseKle } from '@/layout/kle'
import definition from '../reference/cornix-vial-definition.json'

describe('parseKle', () => {
  it('行が進むごとに y が 1 増え、x は行頭に戻る', () => {
    const { keys } = parseKle([['a', 'b'], ['c']])
    expect(keys.map((k) => [k.x, k.y])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1]
    ])
  })

  it('x / y / w のプロパティを次のキーに効かせる', () => {
    const { keys } = parseKle([[{ x: 2 }, 'a', { w: 2 }, 'b', 'c']])
    expect(keys.map((k) => [k.x, k.width])).toEqual([
      [2, 1],
      [3, 2],
      [5, 1]
    ])
  })

  it('rx / ry がクラスタ原点をリセットする', () => {
    const { keys } = parseKle([['a'], [{ r: 15, rx: 5, ry: 4 }, 'b'], ['c']])
    expect(keys[1]).toMatchObject({ x: 5, y: 4, rotationAngle: 15, rotationX: 5, rotationY: 4 })
    // 次の行はクラスタ原点のxに戻り、yだけ1進む
    expect(keys[2]).toMatchObject({ x: 5, y: 5, rotationAngle: 15 })
  })

  it('回転は行の先頭キーでしか指定できない', () => {
    expect(() => parseKle([['a', { r: 10 }, 'b']])).toThrow()
  })

  it('align に合わせてラベルを並べ替える', () => {
    // 既定align=4では入力位置9がlabels[4]になる(エンコーダーの目印)
    const { keys } = parseKle([['0,0\n\n\n\n\n\n\n\n\ne']])
    expect(keys[0].labels[0]).toBe('0,0')
    expect(keys[0].labels[4]).toBe('e')
  })
})

describe('buildGeometry (Cornix LP の実定義)', () => {
  const geometry = buildGeometry(definition.layouts.keymap, definition.matrix)

  it('matrix のキーとエンコーダーを分けて取り出す', () => {
    // 8行7列のmatrixのうち、実際に配線されている50キーだけがKLEに載っている
    expect(geometry.keys).toHaveLength(50) // 片手25キー × 2
    expect(geometry.encoders).toHaveLength(4) // 2個 × 2方向
    expect(new Set(geometry.encoders.map((e) => e.index))).toEqual(new Set([0, 1]))
  })

  it('すべてのキーが宣言された matrix に収まる', () => {
    for (const key of geometry.keys) {
      expect(key.row).toBeLessThan(definition.matrix.rows)
      expect(key.col).toBeLessThan(definition.matrix.cols)
    }
  })

  it('同じ row,col のキーが重複しない', () => {
    const ids = geometry.keys.map((k) => `${k.row},${k.col}`)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('親指キーが回転している', () => {
    const rotated = geometry.keys.filter((k) => k.rotationAngle !== 0)
    expect(rotated.map((k) => `${k.row},${k.col}`).sort()).toEqual(['3,4', '3,5', '7,4', '7,5'])
    // 左右で符号が逆
    const left = rotated.find((k) => k.row === 3 && k.col === 5)!
    const right = rotated.find((k) => k.row === 7 && k.col === 5)!
    expect(left.rotationAngle).toBeCloseTo(-right.rotationAngle)
  })

  it('外接矩形が回転後の角を含む', () => {
    const { bounds } = geometry
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(10)
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(3)
    for (const key of geometry.keys) {
      for (const [x, y] of keyCorners(key)) {
        expect(x).toBeGreaterThanOrEqual(bounds.minX - 1e-9)
        expect(x).toBeLessThanOrEqual(bounds.maxX + 1e-9)
        expect(y).toBeGreaterThanOrEqual(bounds.minY - 1e-9)
        expect(y).toBeLessThanOrEqual(bounds.maxY + 1e-9)
      }
    }
  })

  it('matrix をはみ出すキーはエラーにする', () => {
    expect(() => buildGeometry([['9,9']], { rows: 8, cols: 7 })).toThrow()
  })
})

describe('visibleKeys', () => {
  it('レイアウト選択に紐づかないキーは常に出す', () => {
    const keys = buildGeometry([['0,0', '0,1']]).keys
    expect(visibleKeys(keys, [])).toHaveLength(2)
  })

  it('選ばれていないレイアウトオプションのキーを落とす', () => {
    const keys = buildGeometry([['0,0\n\n\n0,0', '0,1\n\n\n0,1']]).keys
    expect(keys.map((k) => [k.layoutIndex, k.layoutOption])).toEqual([
      [0, 0],
      [0, 1]
    ])
    expect(visibleKeys(keys, [1]).map((k) => k.col)).toEqual([1])
  })
})
