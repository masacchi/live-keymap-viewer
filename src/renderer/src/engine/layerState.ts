/**
 * 押下状態から「いまどのレイヤーが有効か」を決める(HANDOFF §6)。
 *
 * QMK の厳密な再現ではなく、表示のための近似。
 * - キーコードは**押した瞬間**のレイヤー状態で確定させる
 * - MO(n) は押している間だけ有効
 * - LT(n, kc) と、on_hold が MO(n) の Tap Dance は
 *   「tapping term を超えた」か「押している間に別のキーが押された」で有効になる
 * - TG(n) / TO(n) / DF(n) は押した時点で反映する
 */
import { decodeKeycode, type Keycode, modifierBitsOf } from '../keycodes/decode'
import { holdLayerOf, holdModsOf, type TapDanceEntry, tappingTermOf } from '../keycodes/tapDance'
import { keyId } from '../layout/geometry'

export const DEFAULT_TAPPING_TERM = 200

export interface LayerEngineConfig {
  layers: number
  rows: number
  cols: number
  /** [layer][row][col] の生キーコード。 */
  keymap: number[][][]
  /** 読んでいない枠は undefined(hid/vial.ts の tapDanceToRead)。 */
  tapDance: ReadonlyArray<TapDanceEntry | undefined>
  /** LT の既定 tapping term。QMK の TAPPING_TERM 相当。 */
  tappingTerm?: number
}

export interface HeldKey {
  row: number
  col: number
  /** 押した瞬間のレイヤー状態で解決したキーコード。 */
  keycode: Keycode
  /** 押した時刻(ms)。 */
  pressedAt: number
  /** このキーが長押しで出せるレイヤー。出せないなら null。 */
  holdLayer: number | null
  /** このキーを長押ししたときに効くモディファイア(MT / Tap Dance)。無ければ 0。 */
  holdMods: number
  /** 長押し扱いが確定したときの時刻。まだなら null。 */
  heldSince: number | null
  /** 押している間に他のキーが押されたか。 */
  interrupted: boolean
  /** このキーの tapping term。 */
  tappingTerm: number
  /** いま実際にレイヤーを出しているか(MO は押した瞬間から、LT / TD は長押し確定後)。 */
  holdActive: boolean
}

export interface LayerSnapshot {
  /** 有効なレイヤーの集合(昇順)。 */
  activeLayers: number[]
  /** 表示に使うレイヤー(有効なうち一番上)。 */
  displayLayer: number
  /** 既定レイヤー(DF / TO / PDF で動く)。 */
  defaultLayer: number
  /** TG で固定されているレイヤー。 */
  toggledLayers: number[]
  /**
   * いま効いているモディファイア(MOD_* ビット、左右は区別しない)。
   * 単独のモディファイアキーは押しているあいだ、MT / Tap Dance は長押しが確定してから。
   * Shift で入る文字を目立たせるのに使う。
   */
  mods: number
  /** いま押されている物理キー。キーは `row,col`。 */
  held: Map<string, HeldKey>
}

/** 1 キー分の、解決済みキーコード。 */
export interface ResolvedKey {
  /** 表示レイヤーでのキーコード(透過ならそのまま 'trns')。 */
  own: Keycode
  /** 透過をたどった先。own が透過でなければ own と同じ。 */
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
    this.config = { tappingTerm: DEFAULT_TAPPING_TERM, ...config }
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
   * 既定レイヤー(DF / TO)と TG の固定はキーボード側が覚えたままなので、読み直しのたびに
   * 捨てると表示だけがずれる。押しているキーも、押した時点のキーコードのまま引き継ぐ
   * (キーコードは押した瞬間に確定する扱い)。捨てると次のポーリングで押し直されたことになり、
   * 押しっぱなしの TG がもう一度効いてしまう。
   *
   * レイヤー数が違えば何も引き継がない。ファームが変わったということなので。
   */
  inheritFrom(previous: LayerEngine): void {
    if (previous.config.layers !== this.config.layers) return
    this.defaultLayer = previous.defaultLayer
    this.toggled.clear()
    for (const layer of previous.toggled) this.toggled.add(layer)
    this.held = new Map([...previous.held].map(([id, key]) => [id, { ...key }]))
  }

  /**
   * matrix のスナップショットを流し込む。
   *
   * @param matrix `[row][col]` の押下状態
   * @param now    ms 単位の時刻(テストから差し込めるように引数にしてある)
   */
  update(matrix: boolean[][], now: number): LayerSnapshot {
    // 1. 離されたキーを落とす
    for (const [id, key] of this.held) {
      if (!matrix[key.row]?.[key.col]) this.held.delete(id)
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
    for (const key of this.held.values()) {
      if (!canHold(key) || key.heldSince !== null) continue
      if (key.interrupted || now - key.pressedAt >= key.tappingTerm) {
        key.heldSince = now
      }
    }

    return this.snapshot()
  }

  private pressKey(row: number, col: number, now: number): void {
    // 先に、いま押されている長押しキーを「割り込まれた」ことにする。
    // これでこのキーは上のレイヤーで解決される(hold-on-other-key-press 相当)。
    for (const key of this.held.values()) {
      if (canHold(key)) {
        key.interrupted = true
        if (key.heldSince === null) key.heldSince = now
      }
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
      holdActive: false
    })

    this.applyPressEffect(keycode)
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
        // QMK の TO は他のレイヤーを落としてから n を有効にする
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

  /** MO は押した瞬間から有効。LT / TD は長押しが確定してから。 */
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
      if (raw !== 0x0001) return { raw, layer } // KC_TRNS 以外なら確定
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
   * 表示レイヤーでのキー 1 個分のラベル解決。
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

/** matrix の 2 次元配列を作るユーティリティ。 */
export function emptyMatrix(rows: number, cols: number): boolean[][] {
  return Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
}
