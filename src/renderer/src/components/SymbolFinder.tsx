/**
 * 記号の出し方(ツールバーの「@ 記号の出し方」から開く)。
 *
 * JISとUSのずれや、記号をレイヤーに置いたキーマップでは「@はどこ?」で手が止まる。
 * そこで記号ごとの打ち方を一覧にする。
 *
 * 記号ごとに1枚のカードにする:
 *
 *   ┌────────────────────────────────────┐
 *   │ [ @ ]  →  [Space長押し] + [W]        │
 *   │           または [Shift] + [2]       │
 *   └────────────────────────────────────┘
 *
 * 左に記号をキーの形で大きく、右に押すキーの組み合わせをキーの形のラベルで並べる
 * (どの記号とどの組み合わせが対なのか、ひと目で分かるように)。
 * 押すと、その記号が出るレイヤーを図に出し、押すキーを光らせる(App.tsx)。
 *
 * キーボードで記号を打って探す形にはしない。このアプリはキーの押下を見ているので、打った時点で
 * 図がそのレイヤーに切り替わり、探すまでもなくなる(Space長押し+Wを打てるなら、@の場所は分かっている)。
 */
import { Fragment, type JSX } from 'react'
import type { RouteStep, SymbolRoute } from '../engine/symbolRoutes'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'
import { messages } from '../messages'

/** 手順を文にする(ツールチップと読み上げ用)。 */
function stepsText(steps: readonly RouteStep[]): string {
  return steps.map((step) => (step.kind === 'shift' ? 'Shift' : step.text)).join(' + ')
}

/**
 * 押すキーの組み合わせを、キーの形のラベルで並べる。下の縁を太くしてキーキャップに見せる
 * (ただの文字だと「押すもの」に見えない)。
 */
export function RouteChips({
  steps,
  size = 'md'
}: {
  steps: readonly RouteStep[]
  /** sm: 図の縁のラベルやカードの「または」、md: カードの主な組み合わせ。 */
  size?: 'sm' | 'md'
}): JSX.Element {
  // text-xsなどは行の高さも決めるので、leading-noneはその後ろに置く(前だとtailwind-mergeが消す)
  const chip = cn(
    'inline-flex items-center rounded-md border border-b-2 font-semibold',
    size === 'md' ? 'h-6 px-2 text-xs' : 'h-5 px-1.5 text-2xs',
    'leading-none'
  )
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {steps.map((step, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 手順の並びは変わらない
        <Fragment key={i}>
          {i > 0 && <span className="text-2xs text-faint">+</span>}
          {step.kind === 'layer' ? (
            <span
              className={cn(chip, 'border-black/25 text-ink-inverse')}
              style={{ backgroundColor: layerColor(step.layer) }}
            >
              {step.text}
            </span>
          ) : step.kind === 'shift' ? (
            <span className={cn(chip, 'border-ink/70 text-ink')}>Shift</span>
          ) : (
            <span className={cn(chip, 'border-line bg-raised text-ink')}>{step.text}</span>
          )}
        </Fragment>
      ))}
    </span>
  )
}

export interface SymbolFinderProps {
  /** 記号ごとの経路(手数の少ない順)。 */
  routes: ReadonlyMap<string, readonly SymbolRoute[]>
  /** 経路の手順(レイヤーの行き方やキーの名前を入れたもの)。 */
  stepsOf: (route: SymbolRoute) => RouteStep[]
  onPick: (symbol: string, route: SymbolRoute) => void
}

export function SymbolFinder({ routes, stepsOf, onPick }: SymbolFinderProps): JSX.Element {
  return (
    <div className="w-[min(40rem,calc(100vw-2rem))] p-1">
      <p className="px-1 pb-2 text-2xs text-muted">{messages.symbols.lead}</p>
      <ul className="grid max-h-[min(30rem,calc(100vh-7rem))] grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {[...routes].map(([symbol, list]) => (
          <li key={symbol}>
            <SymbolCard symbol={symbol} routes={list} stepsOf={stepsOf} onPick={onPick} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function SymbolCard({
  symbol,
  routes,
  stepsOf,
  onPick
}: {
  symbol: string
  routes: readonly SymbolRoute[]
  stepsOf: (route: SymbolRoute) => RouteStep[]
  onPick: (symbol: string, route: SymbolRoute) => void
}): JSX.Element {
  const [best, alternative] = routes
  const bestSteps = best ? stepsOf(best) : []
  return (
    <button
      type="button"
      disabled={!best}
      onClick={() => best && onPick(symbol, best)}
      aria-label={`${symbol}: ${best ? stepsText(bestSteps) : messages.symbols.unavailable}`}
      title={
        best
          ? routes
              .slice(0, 3)
              .map((route) => stepsText(stepsOf(route)))
              .join(messages.symbols.or)
          : messages.symbols.unavailable
      }
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border border-line-soft bg-surface-2 p-2 text-left',
        'outline-none transition-colors hover:border-line hover:bg-line-soft',
        'focus-visible:ring-2 focus-visible:ring-ink/60 disabled:opacity-40'
      )}
    >
      {/*
       * 記号はキーの形で大きく、欧文の等幅で出す。日本語のフォントでは\が¥の形になり、
       * ¥のカードと見分けが付かない(JISのWindowsでは同じ文字だが、キーは別)
       */}
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-b-[3px] border-line bg-surface font-mono text-xl font-bold text-ink">
        {symbol}
      </span>
      <span aria-hidden className="shrink-0 text-faint">
        →
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        {best ? (
          <>
            <RouteChips steps={bestSteps} />
            {alternative && (
              <span className="flex flex-wrap items-center gap-1 text-2xs text-muted">
                {messages.symbols.alternative}
                <RouteChips steps={stepsOf(alternative)} size="sm" />
              </span>
            )}
          </>
        ) : (
          <span className="text-2xs text-faint">{messages.symbols.unavailable}</span>
        )}
      </span>
    </button>
  )
}
