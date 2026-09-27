/**
 * PDFに書き出す(印刷する)ための1枚。ふだんは描かず、書き出すときだけ描く(App.tsx)。
 *
 * 画面では見えない(styles.cssの.print-sheet)。印刷のときだけ、アプリの画面の代わりにこれが出る
 * (`@media print`)。WebView2の「PDFに印刷」はこの形で書き出す(src-tauri/src/pdf.rs)。
 *
 * - A4横に、レイヤーを2つずつ上下に並べる。中身の無いレイヤーは省く
 * - 図はアプリと同じ部品(KeyboardView)で、そのレイヤーを出す。押しているキーが混ざらないよう、
 *   何も押していないエンジンで描く。そのレイヤーに入るキー(Spaceなど)は縁取る
 * - 最後のページに、記号の出し方の表を置く
 * - 紙に刷っても読みやすいよう、地を白にした配色にする(色はstyles.cssの.print-sheetで変える)
 */
import { type JSX, useMemo } from 'react'
import { LayerEngine } from '../engine/layerState'
import type { KeyboardSnapshot } from '../hid/vial'
import type { KeymapGuide } from '../hooks/useKeymapGuide'
import { formatCombo, formatMacro } from '../keycodes/dynamicEntries'
import { keyNameFor, type LabelMode } from '../keycodes/labels'
import type { KeyboardGeometry } from '../layout/geometry'
import { layerColor } from '../lib/theme'
import { messages } from '../messages'
import { KeyboardView } from './KeyboardView'
import { RouteChips } from './SymbolFinder'

/** 1ページに並べるレイヤーの数。A4横に上下2つで、キーの文字が読める大きさになる。 */
const LAYERS_PER_PAGE = 2

export interface PrintSheetProps {
  snapshot: KeyboardSnapshot
  geometry: KeyboardGeometry
  guide: KeymapGuide
  labelMode: LabelMode
  /** レイヤー名(番号順、''は名前なし)。 */
  names: readonly string[]
  /** ページの上に出す、キーボードの名前。 */
  keyboardName: string
  appVersion: string
  printedAt: Date
}

export function PrintSheet({
  snapshot,
  geometry,
  guide,
  labelMode,
  names,
  keyboardName,
  appVersion,
  printedAt
}: PrintSheetProps): JSX.Element {
  // 何も押していない状態で描く(押しているキーやTGの固定が図に混ざらないように)
  const engine = useMemo(
    () =>
      new LayerEngine({
        layers: snapshot.layers,
        rows: snapshot.rows,
        cols: snapshot.cols,
        keymap: snapshot.keymap,
        tapDance: snapshot.tapDance
      }),
    [snapshot]
  )
  const idle = useMemo(() => engine.snapshot(), [engine])

  const layers = guide.summaries.filter((summary) => !summary.blank)
  const pages: (typeof layers)[] = []
  for (let i = 0; i < layers.length; i += LAYERS_PER_PAGE) {
    pages.push(layers.slice(i, i + LAYERS_PER_PAGE))
  }
  const symbols = [...guide.symbolRoutes].filter(([, routes]) => routes.length > 0)
  // コンボとマクロ(使っているものだけ)。最後のページに記号の表と一緒に置く
  const keyName = keyNameFor(labelMode, guide.labelContext)
  const combos = snapshot.combos.map((combo) => formatCombo(combo, keyName))
  const macros = snapshot.macros.flatMap((actions, index) =>
    actions.length > 0 ? [`M${index}: ${formatMacro(actions, keyName)}`] : []
  )
  const lastPage = symbols.length > 0 || combos.length > 0 || macros.length > 0
  const total = pages.length + (lastPage ? 1 : 0)

  const header = (page: number) => (
    <header className="flex items-baseline justify-between text-2xs text-muted">
      <span className="text-sm font-bold text-ink">
        {messages.print.title(keyboardName)}
        <span className="ml-2 text-2xs font-normal text-muted">
          {labelMode === 'jis' ? messages.print.jis : messages.print.us}
        </span>
      </span>
      <span>{messages.print.footer(printedAt, appVersion, page, total)}</span>
    </header>
  )

  return (
    <div className="print-sheet" aria-hidden>
      {pages.map((page, index) => (
        <section key={page[0].layer} className="print-page">
          {header(index + 1)}
          {page.map(({ layer, triggers }) => {
            const how = guide.howTo(layer)
            return (
              <div key={layer} className="print-layer">
                <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
                  <span
                    className="rounded-md px-1.5 py-0.5 text-xs leading-none text-ink-inverse"
                    style={{ backgroundColor: layerColor(layer) }}
                  >
                    L{layer}
                  </span>
                  {names[layer] && <span>{names[layer]}</span>}
                  {how && <span className="text-xs font-normal text-muted">{how}</span>}
                </h2>
                <div className="print-keyboard">
                  <KeyboardView
                    geometry={geometry}
                    snapshot={snapshot}
                    engine={engine}
                    layers={idle}
                    labelMode={labelMode}
                    previewLayer={layer}
                    layerNames={names}
                    highlightKeys={triggers}
                  />
                </div>
              </div>
            )
          })}
        </section>
      ))}

      {lastPage && (
        <section className="print-page">
          {header(total)}
          {symbols.length > 0 && (
            <h2 className="text-sm font-bold text-ink">{messages.print.symbols}</h2>
          )}
          <ul className="grid grid-cols-4 gap-x-4 gap-y-1.5">
            {symbols.map(([symbol, routes]) => (
              <li key={symbol} className="flex items-center gap-2 break-inside-avoid">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-b-2 border-line bg-surface font-mono text-sm font-bold text-ink">
                  {symbol}
                </span>
                <RouteChips steps={guide.stepsOf(routes[0])} size="sm" />
              </li>
            ))}
          </ul>
          {(combos.length > 0 || macros.length > 0) && (
            <div className="grid grid-cols-2 gap-x-6">
              {[
                [messages.print.combos, combos],
                [messages.print.macros, macros]
              ].map(([title, lines]) =>
                lines.length > 0 ? (
                  <div key={title as string}>
                    <h2 className="text-sm font-bold text-ink">{title}</h2>
                    <ul className="mt-1 space-y-0.5 text-xs text-ink">
                      {(lines as string[]).map((line) => (
                        <li key={line} className="break-inside-avoid">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
