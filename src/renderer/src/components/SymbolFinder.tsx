/**
 * 記号の出し方(ツールバーの「@ 記号」から開く)。
 *
 * JIS と US のずれや、記号をレイヤーに置いたキーマップでは「@ はどこ?」で手が止まる。
 * reference/keymap-preview.html にあった一覧をアプリに持ってきた。記号を押すと、その記号が出る
 * レイヤーを図に出し、押すキーを光らせる(App.tsx)。
 *
 * キーボードで記号を打って探す形にはしない ― このアプリはキーの押下を見ているので、打った時点で
 * 図がそのレイヤーに切り替わり、探すまでもなくなる(Space 長押し + W を打てるなら @ は分かっている)。
 */
import { Fragment, type JSX } from 'react'
import type { RouteStep, SymbolRoute } from '../engine/symbolRoutes'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'

export function RouteChips({ steps, compact = false }: { steps: RouteStep[]; compact?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {steps.map((step, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 手順の並びは変わらない
        <Fragment key={i}>
          {i > 0 && <span className="text-faint">+</span>}
          {step.kind === 'layer' ? (
            <span
              className="rounded-md px-1 font-semibold text-ink-inverse"
              style={{ backgroundColor: layerColor(step.layer) }}
            >
              {compact ? `L${step.layer}` : step.text}
            </span>
          ) : step.kind === 'shift' ? (
            <span className="rounded-md border border-ink/70 px-1">Shift</span>
          ) : (
            <span className="rounded-md bg-raised px-1">{step.text}</span>
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
    <div className="w-[26rem] max-w-[calc(100vw-2rem)] p-1">
      <p className="px-1 pb-2 text-2xs text-muted">
        押すと、そのキーを図で示す。キーを押すか Esc で戻る
      </p>
      <ul className="grid max-h-[min(28rem,70vh)] grid-cols-3 gap-1 overflow-y-auto">
        {[...routes].map(([symbol, list]) => {
          const best = list[0]
          return (
            <li key={symbol}>
              <button
                type="button"
                disabled={!best}
                onClick={() => best && onPick(symbol, best)}
                title={
                  best
                    ? list
                        .slice(0, 3)
                        .map((route) =>
                          stepsOf(route)
                            .map((s) => (s.kind === 'shift' ? 'Shift' : s.text))
                            .join(' + ')
                        )
                        .join(' / または ')
                    : 'このキーマップでは出せない'
                }
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                  'outline-none hover:bg-line-soft focus-visible:bg-line-soft disabled:opacity-40'
                )}
              >
                {/*
                 * 記号は欧文の等幅で出す。日本語のフォントでは \ が ¥ の形になり、一覧に ¥ が 2 つ並んで
                 * 見分けが付かなかった(JIS の Windows では同じ文字だが、キーは別)
                 */}
                <span className="w-5 shrink-0 text-center font-mono text-lg font-bold leading-none text-ink">
                  {symbol}
                </span>
                <span className="min-w-0 text-2xs text-ink">
                  {best ? (
                    <RouteChips steps={stepsOf(best)} compact />
                  ) : (
                    <span className="text-faint">なし</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
