/**
 * 1 台のキーボードとの接続 1 回分。
 *
 *   open → 読み込み → (ロックなら)アンロック → matrix ポーリング
 *                                          ↑           │
 *                                          └─ reload ──┘
 *
 * React から切り離してあるのは、非同期の後始末を確実にするため。
 * 以前はフックの中で setInterval と ref を組み合わせていて、
 *
 *   - 切断・再接続の直後に、旧接続の応答が遅れて届くと新しい画面に書き込めた
 *   - アンロックの応答が重なると、ポーリングが二重に始まり得た
 *   - 接続を連打すると、片方の接続が閉じられずに残った
 *
 * という問題があった。ここでは次の 2 つで防ぐ。
 *
 *   1. 接続ごとに別のインスタンスを作り、破棄したら以後の通知を一切出さない
 *   2. ループは setInterval ではなく await で回し、世代番号(generation)で止める。
 *      世代を進めると、古いループは次の確認で抜ける。応答待ちの途中でも、
 *      戻ってきた時点で自分が古いと分かるので、状態を書き換えない。
 */

import { emptyMatrix, LayerEngine, type LayerSnapshot } from '../engine/layerState'
import { VIAL_UNLOCK_COUNTER_MAX } from '../hid/constants'
import type { Transport } from '../hid/transport'
import {
  type DefinitionCache,
  getMatrixState,
  getUnlockStatus,
  type KeyboardSnapshot,
  keymapUnchanged,
  type LoadProgress,
  loadKeyboard,
  nextUnlockAction,
  reloadKeymap,
  unlockPoll,
  unlockStart
} from '../hid/vial'
import { buildGeometry, type KeyboardGeometry } from '../layout/geometry'

/** matrix のポーリング間隔。vial-gui も 20ms(docs/PROTOCOL.md §8)。 */
export const MATRIX_POLL_MS = 20
/** アンロックのポーリング間隔。vial-gui と同じ。 */
export const UNLOCK_POLL_MS = 200

export type SessionStatus = 'connecting' | 'loading' | 'unlocking' | 'ready' | 'error'

export interface UnlockState {
  /** 押し続けるべき物理キー。 */
  keys: Array<{ row: number; col: number }>
  /** 0 に向かって減る。 */
  counter: number
  max: number
}

export interface SessionState {
  status: SessionStatus
  error: string | null
  deviceLabel: string
  snapshot: KeyboardSnapshot | null
  geometry: KeyboardGeometry | null
  engine: LayerEngine | null
  layers: LayerSnapshot | null
  unlock: UnlockState | null
  /** キーマップを読み直している最中か。 */
  reloading: boolean
  /** 最初の読み込みの進み具合。読み込み中だけ入る。 */
  loading: LoadProgress | null
}

export interface SessionOptions {
  matrixPollMs?: number
  unlockPollMs?: number
  /** 時計。テストで差し替える。 */
  now?: () => number
  /** 待ち。テストで差し替える。 */
  sleep?: (ms: number) => Promise<void>
  /** キーボード定義のキャッシュ。無ければ繋ぐたびに読む。 */
  definitionCache?: DefinitionCache
}

export interface ReloadOptions {
  /**
   * 定義もキャッシュを使わずに読み直す。手動の再読み込みで使う。
   * ファームを焼き直して、定義のバイト数が変わらないまま中身だけ変わったときの逃げ道。
   */
  full?: boolean
}

export type SessionListener = (state: SessionState) => void

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** 押下と表示レイヤーだけを見た指紋。これが同じなら画面は変わらない。 */
export function signatureOf(layers: LayerSnapshot): string {
  const held: string[] = []
  for (const [id, key] of layers.held) held.push(`${id}:${key.holdActive ? 1 : 0}`)
  held.sort()
  return `${layers.displayLayer}|${layers.activeLayers.join(',')}|${held.join(' ')}`
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class KeyboardSession {
  private current: SessionState
  private readonly listeners = new Set<SessionListener>()
  private disposed = false
  private started = false
  /** 動いているループの世代。進めると古いループは次の確認で抜ける。 */
  private generation = 0
  /** 前回通知した画面の指紋。20ms ごとの無駄な再描画を避ける。 */
  private lastSignature = ''

  private readonly matrixPollMs: number
  private readonly unlockPollMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly definitionCache: DefinitionCache | undefined

  constructor(
    private readonly transport: Transport,
    options: SessionOptions = {}
  ) {
    this.matrixPollMs = options.matrixPollMs ?? MATRIX_POLL_MS
    this.unlockPollMs = options.unlockPollMs ?? UNLOCK_POLL_MS
    this.now = options.now ?? (() => performance.now())
    this.sleep = options.sleep ?? defaultSleep
    this.definitionCache = options.definitionCache
    this.current = {
      status: 'connecting',
      error: null,
      deviceLabel: transport.label,
      snapshot: null,
      geometry: null,
      engine: null,
      layers: null,
      unlock: null,
      reloading: false,
      loading: null
    }
  }

  get state(): SessionState {
    return this.current
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** 状態の変化を受け取る。登録した時点の状態もすぐに 1 回渡す。 */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    listener(this.current)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 開いて読み込み、アンロックかポーリングへ進む。読み込みが終わった時点で resolve する。 */
  async start(): Promise<void> {
    if (this.started) throw new Error('KeyboardSession.start() は 1 回しか呼べない')
    this.started = true
    const gen = ++this.generation
    try {
      await this.transport.open()
      if (!this.alive(gen)) return
      this.update({ status: 'loading' })

      const snapshot = await loadKeyboard(this.transport, {
        definitionCache: this.definitionCache,
        onProgress: (loading) => {
          if (this.alive(gen)) this.update({ loading })
        }
      })
      if (!this.alive(gen)) return
      this.update({ loading: null })
      const engine = this.install(snapshot, false)

      if (!snapshot.matrixTestSupported) {
        this.update({
          status: 'error',
          error: 'このキーボードでは matrix state を読めない(プロトコルまたは行列サイズの制限)'
        })
        return
      }

      const lock = await getUnlockStatus(this.transport)
      if (!this.alive(gen)) return
      if (lock.unlocked) {
        void this.runPolling(gen, snapshot, engine)
      } else {
        this.update({
          unlock: {
            keys: lock.keys,
            counter: VIAL_UNLOCK_COUNTER_MAX,
            max: VIAL_UNLOCK_COUNTER_MAX
          }
        })
        void this.runUnlock(gen, snapshot, engine)
      }
    } catch (error) {
      if (this.alive(gen)) this.fail(error)
    }
  }

  /**
   * キーマップを読み直す。Vial で編集したあとに呼ぶ。
   *
   * 定義(物理配置)は読み直さない ― 焼き直さない限り変わらないので。
   * 中身が変わっていなければ、エンジンも画面もそのまま使う。変わっていれば新しいキーマップで
   * エンジンを作り直し、TG の固定や押しているキーは前のエンジンから引き継ぐ(キーボード側は
   * 覚えたままなので、捨てると表示がずれる)。
   * ポーリング中でなければ何もしない(アンロック中は VIA コマンドが通らない)。
   *
   * full のときは定義もキャッシュを使わずに読み直し、変わっていれば物理配置も組み直す。
   */
  async reload({ full = false }: ReloadOptions = {}): Promise<void> {
    const previous = this.current.snapshot
    if (this.disposed || !previous) return
    if (this.current.status !== 'ready' || this.current.reloading) return

    const gen = ++this.generation // ポーリングを止める
    this.update({ reloading: true })
    try {
      const next = full
        ? await loadKeyboard(this.transport, {
            definitionCache: this.definitionCache,
            refreshDefinition: true
          })
        : await reloadKeymap(this.transport, previous)
      if (!this.alive(gen)) return
      const sameDefinition =
        next.definition === previous.definition ||
        JSON.stringify(next.definition) === JSON.stringify(previous.definition)
      const current = this.current.engine
      if (current && sameDefinition && keymapUnchanged(previous, next)) {
        this.update({ reloading: false })
        void this.runPolling(gen, previous, current)
        return
      }
      const engine = this.install(next, sameDefinition, current)
      this.update({ reloading: false })
      void this.runPolling(gen, next, engine)
    } catch (error) {
      if (this.alive(gen)) this.fail(error)
    }
  }

  /** ループを止めて閉じる。以後、通知は一切出さない。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.listeners.clear()
    await this.transport.close().catch(() => undefined)
  }

  // --- 内部 ---

  private alive(gen: number): boolean {
    return !this.disposed && gen === this.generation
  }

  private update(patch: Partial<SessionState>): void {
    if (this.disposed) return
    this.current = { ...this.current, ...patch }
    for (const listener of this.listeners) listener(this.current)
  }

  private fail(error: unknown): void {
    this.generation++ // 動いているループを止める
    this.update({ status: 'error', reloading: false, loading: null, error: describeError(error) })
  }

  /**
   * 読んだキーマップでエンジンを作り直し、状態に載せる。
   * previous を渡すと、レイヤーの状態をそこから引き継ぐ(読み直しのとき)。
   */
  private install(
    snapshot: KeyboardSnapshot,
    reuseGeometry: boolean,
    previous: LayerEngine | null = null
  ): LayerEngine {
    const engine = new LayerEngine({
      layers: snapshot.layers,
      rows: snapshot.rows,
      cols: snapshot.cols,
      keymap: snapshot.keymap,
      tapDance: snapshot.tapDance
    })
    if (previous) engine.inheritFrom(previous)
    const geometry =
      reuseGeometry && this.current.geometry
        ? this.current.geometry
        : buildGeometry(snapshot.definition.layouts.keymap, {
            rows: snapshot.rows,
            cols: snapshot.cols
          })
    this.update({
      snapshot,
      geometry,
      engine,
      // 引き継いだときは押しているキーを離したことにしない(次のポーリングで押し直しになる)
      layers: previous
        ? engine.snapshot()
        : engine.update(emptyMatrix(snapshot.rows, snapshot.cols), this.now()),
      error: null
    })
    return engine
  }

  /**
   * アンロック手順。ロックを見つけたら自動で始める(押下を読むには他に道が無い)。
   * 進行中は VIA コマンドが通らない(docs/PROTOCOL.md §2)ので、ポーリングはしない。
   */
  private async runUnlock(
    gen: number,
    snapshot: KeyboardSnapshot,
    engine: LayerEngine
  ): Promise<void> {
    this.update({ status: 'unlocking' })
    try {
      await unlockStart(this.transport)
      while (this.alive(gen)) {
        await this.sleep(this.unlockPollMs)
        if (!this.alive(gen)) return
        const progress = await unlockPoll(this.transport)
        if (!this.alive(gen)) return

        const unlock = this.current.unlock
        this.update({
          unlock: {
            keys: unlock?.keys ?? [],
            max: unlock?.max ?? VIAL_UNLOCK_COUNTER_MAX,
            counter: progress.counter
          }
        })

        const action = nextUnlockAction(progress)
        if (action === 'done') {
          void this.runPolling(gen, snapshot, engine)
          return
        }
        if (action === 'restart') await unlockStart(this.transport)
      }
    } catch (error) {
      if (this.alive(gen)) this.fail(error)
    }
  }

  /**
   * matrix を読み続ける。1 往復 → 残りの時間だけ待つ、の繰り返し。
   * 応答が遅いときは自然に間隔が延びる(要求を積み上げない)。
   */
  private async runPolling(
    gen: number,
    snapshot: KeyboardSnapshot,
    engine: LayerEngine
  ): Promise<void> {
    this.lastSignature = ''
    this.update({ status: 'ready', unlock: null })
    try {
      while (this.alive(gen)) {
        const started = this.now()
        const matrix = await getMatrixState(this.transport, snapshot.rows, snapshot.cols)
        if (!this.alive(gen)) return

        const layers = engine.update(matrix, this.now())
        const signature = signatureOf(layers)
        if (signature !== this.lastSignature) {
          this.lastSignature = signature
          this.update({ layers })
        }

        const rest = this.matrixPollMs - (this.now() - started)
        await this.sleep(Math.max(0, rest))
      }
    } catch (error) {
      if (this.alive(gen)) this.fail(error)
    }
  }
}
