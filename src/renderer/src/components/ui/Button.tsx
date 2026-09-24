/**
 * 画面のボタンはすべてこれを使う。
 *
 * 部品ごとにクラスを書くと、大きさも角の丸みも色も少しずつずれていくため。
 *
 * アクセントに**レイヤー色を使わない**。主ボタンや選択中の表示にレイヤーの色を使うと、
 * 「L2に入った」表示と見分けが付かなくなる。色味はレイヤーだけのものにして、
 * ボタンは明るさの差で見せる。
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, JSX } from 'react'
import { cn } from '../../lib/cn'

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium',
    'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink/60',
    'disabled:pointer-events-none disabled:opacity-50'
  ],
  {
    variants: {
      variant: {
        /** その画面で一番押してほしいもの。1画面に1つまで。 */
        primary: 'bg-ink font-semibold text-ink-inverse hover:bg-white',
        secondary: 'bg-surface text-ink hover:bg-line-soft',
        /** 目立たせたくないもの(やめる・閉じる)。 */
        ghost: 'text-muted hover:bg-line-soft hover:text-ink'
      },
      size: {
        sm: 'px-2 py-1 text-2xs',
        md: 'px-2 py-1.5 text-xs md:px-3',
        lg: 'px-4 py-2 text-xs'
      },
      /** 切り替えの選択中(JIS / USなど)。 */
      selected: {
        true: 'bg-raised text-ink hover:bg-raised',
        false: ''
      }
    },
    compoundVariants: [{ variant: 'secondary', selected: false, class: 'text-muted' }],
    defaultVariants: { variant: 'secondary', size: 'md' }
  }
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export function Button({
  variant,
  size,
  selected,
  className,
  type = 'button',
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, selected }), className)}
      {...props}
    />
  )
}
