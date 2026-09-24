/**
 * 色トークンのうち、JSから組み立てるもの。値そのものはstyles.cssの@themeにある。
 *
 * レイヤー色はレイヤー番号で決まるので、クラス名(`bg-layer-${n}`)にはできない
 * (Tailwindはソースに書かれたクラス名しか拾わない)。代わりにCSS変数をstyleに渡す。
 */

/** 用意しているレイヤー色の数。これより上のレイヤーは色を繰り返す。 */
export const LAYER_COLOR_COUNT = 10

/** レイヤーnの色(`var(--color-layer-n)`)。 */
export function layerColor(layer: number): string {
  return `var(--color-layer-${layer % LAYER_COLOR_COUNT})`
}
