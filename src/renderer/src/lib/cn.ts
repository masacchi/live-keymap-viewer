/**
 * Tailwindのクラスを組み立てる。
 *
 * 条件つきのクラスはclsxで書き(`active && '…'`、`{ '…': flag }`)、ぶつかるクラス
 * (`bg-surface`と`bg-layer-2`など)はtailwind-mergeで**後ろを勝たせる**。
 * 部品が受け取ったclassNameで既定のクラスを上書きできるのはこのおかげ。
 * 以前は配列をjoin(' ')していて、同じ種類のクラスが2つ残るとどちらが効くかが
 * CSSの出力順任せになっていた。
 *
 * 注意: styles.cssの@themeに**独自の文字サイズ**(`--text-caption`など)を足すなら、
 * extendTailwindMergeで教えること。教えないと`text-caption`を色とみなし、
 * `cn('text-caption', 'text-muted')`で片方が消える。色(--color-*)はそのままで正しく扱われる。
 *
 * 注意: 文字の大きさ(text-xsなど)は行の高さも決めるので、leading-*とぶつかる扱いになる。
 * leading-*は大きさの**後ろ**に書く(前に書くと、後ろのtext-xsに負けて消える)。
 */
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
