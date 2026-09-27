/**
 * 押下状態から「いまどのレイヤーが有効か」を決める(規則はdocs/ARCHITECTURE.md「レイヤーの判定」)。
 *
 * QMKの厳密な再現ではなく、表示のための近似。
 * - キーコードは**押した瞬間**のレイヤー状態で確定させる
 * - MO(n)は押している間だけ有効
 * - LT(n, kc)と、on_holdがMO(n)のTap Danceは「tapping termを超えた」か、判定のしかた(HoldMode)
 *   しだいで「押している間に別のキーが押された / 押して離された」で有効になる
 * - TG(n) / TO(n) / DF(n)は押した時点で反映する
 */
import { decodeKeycode, type Keycode, modifierBitsOf } from '../keycodes/decode'
import {
  type HoldMode,
  holdLayerOf,
  holdModsOf,
  type TapDanceEntry,
  tappingTermOf
} from '../keycodes/tapDance'

export type { HoldMode }

import { keyId } from '../layout/geometry'

export const DEFAULT_TAPPING_TERM = 200

/** キーボードの設定を読めないときの判定のしかた。この近似をずっと使ってきたので、読めないときはこれ。 */
export const DEFAULT_HOLD_MODE: HoldMode = 'hold-on-other-key-press'

export interface LayerEngineConfig {
  layers: number
  rows: number
  cols: number
  /** [layer][row][col]の生キーコード。 */
  keymap: number[][][]
  /** 読んでいない枠はundefined(hid/vial.tsのtapDanceToRead)。 */
  tapDance: ReadonlyArray<TapDanceEntry | undefined>
  /** LTの既定tapping term。QMKのTAPPING_TERM相当。 */
  tappingTerm?: number
  /** 長押しの判定のしかた。無ければDEFAULT_HOLD_MODE。 */
  holdMode?: HoldMode
}

export interface HeldKey {
  row: number
  col: number
  /** 押した瞬間のレイヤー状態で解決したキーコード。 */
  keycode: Keycode
  /** 押した時刻(ms)。 */
  pressedAt: number
  /** このキーが長押しで出せるレイヤー。出せないならnull。 */
  holdLayer: number | null
  /** このキーを長押ししたときに効くモディファイア(MT / Tap Dance)。無ければ0。 */
  holdMods: number
  /** 長押し扱いが確定したときの時刻。まだならnull。 */
  heldSince: number | null
  /** 押している間に他のキーが押されたか。 */
  interrupted: boolean
  /** このキーのtapping term。 */
  tappingTerm: number
  /** いま実際にレイヤーを出しているか(MOは押した瞬間から、LT / TDは長押し確定後)。 */
  holdActive: boolean
  /**
   * 前に押した長押しキーがタップか長押しかまだ決まっておらず、どのレイヤーのキーかが仮のまま。
   * keycodeは、決まっていない長押しを除いたレイヤーで仮に解決したもの(タップだったときの値)。
   * 決まったら解決し直す(`hold-on-other-key-press`では使わない)。
   */
  pending: boolean
}

export interface LayerSnapshot {
  /** 有効なレイヤーの集合(昇順)。 */
  activeLayers: number[]
  /** 表示に使うレイヤー(有効なうち一番上)。 */
  displayLayer: number
  /** 既定レイヤー(DF / TO / PDFで動く)。 */
  defaultLayer: number
  /** TGで固定されているレイヤー。 */
  toggledLayers: number[]
  /**
   * いま効いているモディファイア(MOD_*ビット、左右は区別しない)。
   * 単独のモディファイアキーは押しているあいだ、MT / Tap Danceは長押しが確定してから。
   * Shiftで入る文字を目立たせるのに使う。
   */
  mods: number
  /** いま押されている物理キー。キーは`row,col`。 */
  held: Map<string, HeldKey>
}

/** 1キー分の、解決済みキーコード。 */
export interface ResolvedKey {
  /** 表示レイヤーでのキーコード(透過ならそのまま'trns')。 */
  own: Keycode
  /** 透過をたどった先。ownが透過でなければownと同じ。 */
  effective: Keycode
  /** 透過をたどった結果のレイヤー。 */
  sourceLayer: number
  /** 透過だったか。薄く出すのに使う。 */
  transparent: boolean
}

export class LayerEngine {
  private readonly config: Required<LayerEngineConfig>
  private defaultLayer = 0
  private readonly toggled = new Set<number>()
  private held = new Map<string, HeldKey>()

  constructor(config: LayerEngineConfig) {
    // tappingTermを「渡さない」と「undefinedを渡す」を同じに扱う。セッションは設定を受け取る前に
    // `tappingTerm: undefined`で作られることがある。既定値にconfigをそのまま重ねるとundefinedで
    // 上書きされ、`now - pressedAt >= undefined`が常に偽になって、LT / Tap Danceの長押しが
    // いつまでも確定しない
    this.config = {
      ...config,
      tappingTerm: config.tappingTerm ?? DEFAULT_TAPPING_TERM,
      holdMode: config.holdMode ?? DEFAULT_HOLD_MODE
    }
  }

  /**
   * 長押しと見なすまでの時間(LTの既定)を変える。設定から変えたとき。
   * これから押すキーに効く(押しているキーは押した時点の時間のまま)。
   */
  setTappingTerm(ms: number): void {
    this.config.tappingTerm = ms
  }

  /** いまの長押しの判定時間(LTの既定)。 */
  get tappingTerm(): number {
    return this.config.tappingTerm
  }

  /** すべて離した状態に戻す。再接続や切り替えのとき。 */
  reset(): void {
    this.defaultLayer = 0
    this.toggled.clear()
    this.held = new Map()
  }

  /**
   * キーマップを読み直す前のエンジンから、レイヤーの状態を引き継ぐ。
   *
   * 既定レイヤー(DF / TO)とTGの固定はキーボード側が覚えたままなので、読み直しのたびに
   * 捨てると表示だけがずれる。押しているキーも、押した時点のキーコードのまま引き継ぐ
   * (キーコードは押した瞬間に確定する扱い)。捨てると次のポーリングで押し直されたことになり、
   * 押しっぱなしのTGがもう一度効いてしまう。
   *
   * レイヤー数が違えば何も引き継がない(ファームが変わったということなので)。
   */
  inheritFrom(previous: LayerEngine): void {
    if (previous.config.layers !== this.config.layers) return
    this.defaultLayer = previous.defaultLayer
    this.toggled.clear()
    for (const layer of previous.toggled) this.toggled.add(layer)
    this.held = new Map([...previous.held].map(([id, key]) => [id, { ...key }]))
  }

  /**
   * matrixのスナップショットを流し込む。
   *
   * @param matrix `[row][col]`の押下状態
   * @param now    ms単位の時刻(テストから差し込めるように引数にしてある)
   */
  update(matrix: boolean[][], now: number): LayerSnapshot {
    // 1. 離されたキーを落とす
    for (const [id, key] of this.held) {
      if (matrix[key.row]?.[key.col]) continue
      // Permissive Hold: 長押しキーを押しているあいだに、後から押したキーが離されたら長押しに決める
      if (this.config.holdMode === 'permissive-hold') {
        for (const other of this.held.values()) {
          if (other === key || !this.undecided(other) || other.pressedAt > key.pressedAt) continue
          if (matrix[other.row]?.[other.col]) other.heldSince = now
        }
      }
      this.held.delete(id)
    }

    // 2. 新しく押されたキーを、行優先の順で足す
    for (let row = 0; row < this.config.rows; row++) {
      for (let col = 0; col < this.config.cols; col++) {
        if (!matrix[row]?.[col]) continue
        const id = keyId(row, col)
        if (this.held.has(id)) continue
        this.pressKey(row, col, now)
      }
    }

    // 3. 経過時間による長押し確定
    this.decideHolds(now)
    this.settlePending()

    return this.snapshot()
  }

  /**
   * 押下は読まずに、時間だけ進めて長押しを確定し直す。
   *
   * 長押しの確定は押下を読んだときにしか判定しないと、Bluetoothでは次の応答(最大0.5秒ほど)まで
   * レイヤーの表示が変わらない。そこでnextDecisionAtの時刻にセッションがこれを呼ぶ。離したことは
   * まだ分かっていないが、BLEはキーを離すと通信が起きてすぐ知らせが来るはずなので、来ていなければ
   * 押したままとみなす(docs/BLUETOOTH.md §5。前提はログで確かめる)。
   */
  advance(now: number): LayerSnapshot {
    this.decideHolds(now)
    this.settlePending()
    return this.snapshot()
  }

  /** まだ長押しが確定していないキーのうち、いちばん早く確定する時刻。無ければnull。 */
  nextDecisionAt(): number | null {
    let next: number | null = null
    for (const key of this.held.values()) {
      if (!this.undecided(key)) continue
      const at = key.pressedAt + key.tappingTerm
      if (next === null || at < next) next = at
    }
    return next
  }

  private decideHolds(now: number): void {
    const onOtherPress = this.config.holdMode === 'hold-on-other-key-press'
    for (const key of this.held.values()) {
      if (!canHold(key) || key.heldSince !== null) continue
      if ((onOtherPress && key.interrupted) || now - key.pressedAt >= key.tappingTerm) {
        key.heldSince = now
      }
    }
  }

  /** 長押しかタップかまだ決まっていないキーか(保留のキーは、前のキーが決まるのを待っている)。 */
  private undecided(key: HeldKey): boolean {
    return canHold(key) && key.heldSince === null && !key.pending
  }

  /**
   * 保留のキーのうち、前に押した長押しキーがすべて決まったものを解決し直す。
   * 長押しに決まったならそのレイヤーで、タップ(離された)ならそれを除いたレイヤーで解決する。
   * キーボードが待たせていたキーを出すのと同じ時に、押した瞬間に効くもの(TGなど)も効かせる。
   */
  private settlePending(): void {
    for (const key of this.held.values()) {
      if (!key.pending) continue
      const waiting = [...this.held.values()].some(
        (other) => other !== key && this.undecided(other) && other.pressedAt <= key.pressedAt
      )
      if (waiting) continue
      const keycode = decodeKeycode(
        this.resolveRaw(key.row, key.col, this.computeActiveLayers()).raw
      )
      key.keycode = keycode
      key.holdLayer = holdLayerOf(keycode, this.config.tapDance)
      key.holdMods = holdModsOf(keycode, this.config.tapDance)
      key.tappingTerm = tappingTermOf(keycode, this.config.tapDance, this.config.tappingTerm)
      key.pending = false
      this.applyPressEffect(keycode)
    }
  }

  private pressKey(row: number, col: number, now: number): void {
    // 先に、いま押されている長押しキーを「割り込まれた」ことにする。
    // hold-on-other-key-pressなら、これで長押しに決まり、このキーは上のレイヤーで解決される。
    // ほかの判定のしかたでは、まだ決まっていない長押しキーがあれば、このキーを保留にする
    const onOtherPress = this.config.holdMode === 'hold-on-other-key-press'
    let pending = false
    for (const key of this.held.values()) {
      if (!canHold(key)) continue
      key.interrupted = true
      if (key.heldSince !== null) continue
      if (onOtherPress) key.heldSince = now
      else if (!key.pending) pending = true
    }

    const active = this.computeActiveLayers()
    const resolved = this.resolveRaw(row, col, active)
    const keycode = decodeKeycode(resolved.raw)

    const holdLayer = holdLayerOf(keycode, this.config.tapDance)
    this.held.set(keyId(row, col), {
      row,
      col,
      keycode,
      pressedAt: now,
      holdLayer,
      holdMods: holdModsOf(keycode, this.config.tapDance),
      heldSince: null,
      interrupted: false,
      tappingTerm: tappingTermOf(keycode, this.config.tapDance, this.config.tappingTerm),
      holdActive: false,
      pending
    })

    // 保留のキーは、どのレイヤーのキーかが決まってから効かせる(settlePending)
    if (!pending) this.applyPressEffect(keycode)
  }

  /** 押した瞬間に効くもの(TG / TO / DF / PDF)。 */
  private applyPressEffect(keycode: Keycode): void {
    if (keycode.kind !== 'layer') return
    switch (keycode.op) {
      case 'TG':
        if (this.toggled.has(keycode.layer)) this.toggled.delete(keycode.layer)
        else this.toggled.add(keycode.layer)
        break
      case 'TO':
        // QMKのTOは他のレイヤーを落としてからnを有効にする
        this.toggled.clear()
        this.defaultLayer = keycode.layer
        break
      case 'DF':
      case 'PDF':
        this.defaultLayer = keycode.layer
        break
      default:
        break
    }
  }

  /** MOは押した瞬間から有効。LT / TDは長押しが確定してから。 */
  private isHoldActive(key: HeldKey): boolean {
    if (key.holdLayer === null) return false
    if (key.keycode.kind === 'layer' && key.keycode.op === 'MO') return true
    return key.heldSince !== null
  }

  private computeActiveLayers(): Set<number> {
    const active = new Set<number>([this.defaultLayer])
    for (const layer of this.toggled) active.add(layer)
    for (const key of this.held.values()) {
      if (this.isHoldActive(key) && key.holdLayer !== null) active.add(key.holdLayer)
    }
    return active
  }

  /** 有効レイヤーの上から透過をたどって、実際に効くキーコードを探す。 */
  private resolveRaw(
    row: number,
    col: number,
    active: Set<number>
  ): { raw: number; layer: number } {
    const layers = [...active].sort((a, b) => b - a)
    for (const layer of layers) {
      const raw = this.config.keymap[layer]?.[row]?.[col]
      if (raw === undefined) continue
      if (raw !== 0x0001) return { raw, layer } // KC_TRNS以外なら確定
    }
    return { raw: this.config.keymap[0]?.[row]?.[col] ?? 0, layer: 0 }
  }

  snapshot(): LayerSnapshot {
    const active = this.computeActiveLayers()
    const activeLayers = [...active].sort((a, b) => a - b)
    const held = new Map<string, HeldKey>()
    let mods = 0
    for (const [id, key] of this.held) {
      held.set(id, { ...key, holdActive: this.isHoldActive(key) })
      mods |= modifierBitsOf(key.keycode)
      if (key.heldSince !== null) mods |= key.holdMods
    }
    return {
      activeLayers,
      displayLayer: activeLayers[activeLayers.length - 1] ?? 0,
      defaultLayer: this.defaultLayer,
      toggledLayers: [...this.toggled].sort((a, b) => a - b),
      mods,
      held
    }
  }

  /**
   * 表示レイヤーでのキー1個分のラベル解決。
   * 透過なら下の有効レイヤーへたどり、たどったことも返す。
   */
  resolveKey(row: number, col: number, snapshot: LayerSnapshot): ResolvedKey {
    const layer = snapshot.displayLayer
    const rawOwn = this.config.keymap[layer]?.[row]?.[col] ?? 0
    const own = decodeKeycode(rawOwn)
    if (own.kind !== 'trns') {
      return { own, effective: own, sourceLayer: layer, transparent: false }
    }
    const active = new Set(snapshot.activeLayers)
    const resolved = this.resolveRaw(row, col, active)
    return {
      own,
      effective: decodeKeycode(resolved.raw),
      sourceLayer: resolved.layer,
      transparent: true
    }
  }
}

/** 長押しで何かが効くキーか(レイヤーでもモディファイアでも)。長押しの確定を追う対象。 */
function canHold(key: HeldKey): boolean {
  return key.holdLayer !== null || key.holdMods !== 0
}

/** matrixの2次元配列を作るユーティリティ。 */
export function emptyMatrix(rows: number, cols: number): boolean[][] {
  return Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
}
