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
import { type Transport, TransportError } from '../hid/transport'
import {
  type DefinitionCache,
  getMatrixState,
  getUnlockStatus,
  type KeyboardSnapshot,
  type KeymapCache,
  keymapUnchanged,
  type LoadProgress,
  loadCachedKeyboard,
  loadKeyboard,
  nextUnlockAction,
  reloadKeymap,
  toCachedKeymap,
  unlockPoll,
  unlockStart
} from '../hid/vial'
import { buildGeometry, type KeyboardGeometry } from '../layout/geometry'
import { messages } from '../messages'

/** matrix のポーリング間隔。vial-gui も 20ms(docs/PROTOCOL.md §8)。 */
export const MATRIX_POLL_MS = 20
/** アンロックのポーリング間隔。vial-gui と同じ。 */
export const UNLOCK_POLL_MS = 200
/**
 * 応答が返らないまま、これだけ続いたら切れたと見なす(ms)。
 *
 * 以前は「連続 5 回失敗」で数えていて、合計 3 秒ほどで切れていた。これだと
 * **ウィンドウの枠をドラッグしているあいだに切断される**。Windows では移動・リサイズの
 * ドラッグ中、ブラウザ(main)プロセスのメッセージループが止まり、WebHID の往復は
 * main を通るので応答が返らない。数秒のドラッグで切断 → 繋ぎ直し → キーマップの丸ごと
 * 読み直し、になっていた。OS やファームの省電力で一瞬詰まるのも同じ。
 *
 * 回数ではなく時間で数えるのは、往復が遅いほど 1 回の失敗に時間がかかるため
 * (USB は 600ms/回、BT ではもっと)。待っているあいだは最後の表示のまま読み続ける。
 *
 * 長く待てるのは、**時間切れ以外の失敗は待たずに切る**から(isTimeout)。ケーブルが抜けた・
 * デバイスが消えたときは書き込みそのものが失敗し、時間切れを待たずに即座に返る。
 */
export const STALL_LIMIT_MS = 15_000
/** 読み取りに失敗したあと、次を投げるまでの待ち。詰まっている相手に間を置く。 */
export const POLL_RETRY_MS = 100

/**
 * 時間切れ(相手が詰まっているだけかもしれない)か、それ以外の失敗か。
 *
 * WebHidTransport は時間切れだけを TransportError にし、書き込みそのものの失敗
 * (デバイスが消えた・開けていない)は元の例外をそのまま投げる(hid/transport.ts)。
 */
function isTimeout(error: unknown): boolean {
  return error instanceof TransportError
}

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
  /**
   * 応答が途切れているが、まだ切れたとは見なしていない(省電力で一瞬詰まることがある)。
   * 画面は最後の状態のままにして、状態の丸だけで知らせる。
   */
  stalled: boolean
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
  /** キーマップのキャッシュ。定義のキャッシュと両方あるときだけ、繋いだ直後の即表示に使う。 */
  keymapCache?: KeymapCache
  /** 長押しと見なすまでの時間(ms、LT の既定)。無ければエンジンの既定(200ms)。 */
  tappingTerm?: number
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

/**
 * 押下・表示レイヤー・モディファイアだけを見た指紋。これが同じなら画面は変わらない。
 * モディファイアも入れるのは、MT(Shift) が時間だけで長押し確定したときに、押下の並びは
 * 変わらないまま Shift の強調だけが変わるため。
 */
export function signatureOf(layers: LayerSnapshot): string {
  const held: string[] = []
  for (const [id, key] of layers.held) held.push(`${id}:${key.holdActive ? 1 : 0}`)
  held.sort()
  return `${layers.displayLayer}|${layers.activeLayers.join(',')}|${layers.mods}|${held.join(' ')}`
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
  private readonly keymapCache: KeymapCache | undefined
  /** キャッシュで始めたときに、裏で確かめるキーマップ。ポーリングに入ったら消える。 */
  private pendingVerify: KeyboardSnapshot | null = null
  private tappingTerm: number | undefined

  constructor(
    private readonly transport: Transport,
    options: SessionOptions = {}
  ) {
    this.matrixPollMs = options.matrixPollMs ?? MATRIX_POLL_MS
    this.unlockPollMs = options.unlockPollMs ?? UNLOCK_POLL_MS
    this.now = options.now ?? (() => performance.now())
    this.sleep = options.sleep ?? defaultSleep
    this.definitionCache = options.definitionCache
    this.keymapCache = options.keymapCache
    this.tappingTerm = options.tappingTerm
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
      stalled: false,
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

      // キャッシュが使えるなら、3 往復で図を出してしまう。全部読むのは 70〜95 往復で、
      // USB でも数秒、Bluetooth では 30 秒ほど画面に何も出ない。読み直しは裏でやる
      const cached = await loadCachedKeyboard(this.transport, {
        definitionCache: this.definitionCache,
        keymapCache: this.keymapCache
      })
      if (!this.alive(gen)) return

      const snapshot =
        cached ??
        (await loadKeyboard(this.transport, {
          definitionCache: this.definitionCache,
          onProgress: (loading) => {
            if (this.alive(gen)) this.update({ loading })
          }
        }))
      if (!this.alive(gen)) return
      this.update({ loading: null })
      this.pendingVerify = cached
      const engine = this.install(snapshot, false)

      if (!snapshot.matrixTestSupported) {
        this.update({
          status: 'error',
          error: messages.connection.noMatrix
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
      if (!this.alive(gen)) return
      // 読み直しの失敗でセッションまで落とさない。時間切れなら、前のキーマップのまま
      // ポーリングに戻す(表示は続けられるし、次のフォーカスや手動でまた読み直せる)。
      // 以前はここで error にしていたので、ウィンドウに戻った拍子に 1 回詰まっただけで
      // 接続が切れ、繋ぎ直しで丸ごと読み直していた
      const engine = this.current.engine
      if (isTimeout(error) && engine) {
        this.update({ reloading: false })
        void this.runPolling(gen, previous, engine)
        return
      }
      this.fail(error)
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

  /** 長押しと見なすまでの時間を変える。動いているエンジンにもすぐ効かせる(これから押すキーから)。 */
  setTappingTerm(ms: number): void {
    this.tappingTerm = ms
    this.current.engine?.setTappingTerm(ms)
  }

  private update(patch: Partial<SessionState>): void {
    if (this.disposed) return
    this.current = { ...this.current, ...patch }
    for (const listener of this.listeners) listener(this.current)
  }

  private fail(error: unknown): void {
    this.generation++ // 動いているループを止める
    this.update({
      status: 'error',
      reloading: false,
      stalled: false,
      loading: null,
      error: describeError(error)
    })
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
      tapDance: snapshot.tapDance,
      tappingTerm: this.tappingTerm
    })
    if (previous) engine.inheritFrom(previous)
    const geometry =
      reuseGeometry && this.current.geometry
        ? this.current.geometry
        : buildGeometry(snapshot.definition.layouts.keymap, {
            rows: snapshot.rows,
            cols: snapshot.cols
          })
    // 次に繋いだとき(モードの切り替え・繋ぎ直し)に、すぐ図を出せるようにしておく
    if (this.keymapCache && snapshot.definitionSize > 0) {
      this.keymapCache.set(snapshot.uid, toCachedKeymap(snapshot))
    }
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
   * キャッシュで出した表示を、裏で読み直して確かめる。
   *
   * ポーリングは止めない。要求は 1 本のキューに並ぶ(hid/transport.ts)ので、確かめている
   * あいだは matrix の間隔が延びるだけで、押下の表示は生きたままになる。
   * 違っていたら新しいキーマップでエンジンを作り直し、ポーリングを入れ替える。
   *
   * 失敗しても表示は壊さない ― キャッシュのまま使い続け、次のフォーカスか手動の読み直しに任せる。
   */
  private async verifyCached(gen: number, cached: KeyboardSnapshot): Promise<void> {
    this.update({ reloading: true })
    try {
      const next = await reloadKeymap(this.transport, cached)
      if (!this.alive(gen)) return
      if (keymapUnchanged(cached, next)) {
        this.update({ reloading: false })
        return
      }
      const engine = this.install(next, true, this.current.engine)
      this.update({ reloading: false })
      const replaced = ++this.generation // 動いているポーリングを止めて入れ替える
      void this.runPolling(replaced, next, engine)
    } catch {
      if (this.alive(gen)) this.update({ reloading: false })
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
    this.update({ status: 'ready', unlock: null, stalled: false })
    // キャッシュで始めていたら、ここから裏で読み直して確かめる
    // (アンロックが要るキーボードでは、それが済んでここに来る)
    const verify = this.pendingVerify
    this.pendingVerify = null
    if (verify) void this.verifyCached(gen, verify)
    /** 応答が返らなくなった時刻。1 回でも読めたら null に戻る。 */
    let stalledSince: number | null = null
    try {
      while (this.alive(gen)) {
        const started = this.now()
        let matrix: boolean[][]
        try {
          matrix = await getMatrixState(this.transport, snapshot.rows, snapshot.cols)
        } catch (error) {
          if (!this.alive(gen)) return
          // 時間切れ以外(デバイスが消えた・書き込みに失敗した)は待っても直らない
          if (!isTimeout(error)) throw error
          if (stalledSince === null) stalledSince = started
          if (started - stalledSince >= STALL_LIMIT_MS) throw error
          if (!this.current.stalled) this.update({ stalled: true })
          await this.sleep(POLL_RETRY_MS)
          continue
        }
        if (!this.alive(gen)) return
        if (stalledSince !== null) {
          stalledSince = null
          this.update({ stalled: false })
        }

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
