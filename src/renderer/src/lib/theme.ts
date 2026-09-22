/**
 * 色トークンのうち、JS から組み立てるもの。値そのものは styles.css の @theme にある。
 *
 * レイヤー色はレイヤー番号で決まるので、クラス名(`bg-layer-${n}`)にはできない ―
 * Tailwind はソースに書かれたクラス名しか拾わない。代わりに CSS 変数を style に渡す。
 */

/** 用意しているレイヤー色の数。これより上のレイヤーは色を繰り返す。 */
export const LAYER_COLOR_COUNT = 10

/** レイヤー n の色(`var(--color-layer-n)`)。 */
export function layerColor(layer: number): string {
  return `var(--color-layer-${layer % LAYER_COLOR_COUNT})`
}
