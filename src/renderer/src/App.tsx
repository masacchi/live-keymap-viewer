import { useCallback, useEffect, useState, type JSX } from 'react'
import { DevicePicker } from './components/DevicePicker'
import { KeyboardView } from './components/KeyboardView'
import { Toolbar } from './components/Toolbar'
import { UnlockPanel } from './components/UnlockPanel'
import { useVialKeyboard } from './hooks/useVialKeyboard'
import type { LabelMode } from './keycodes/labels'
import type { HidCandidate } from '../../shared/ipc'

type WindowMode = 'normal' | 'overlay'

export default function App(): JSX.Element {
  const keyboard = useVialKeyboard()
  const [labelMode, setLabelMode] = useState<LabelMode>('jis')
  const [windowMode, setWindowMode] = useState<WindowMode>('normal')
  const [candidates, setCandidates] = useState<HidCandidate[] | null>(null)

  // 設定を読み、オーバーレイなら body にクラスを付けて背景を透かす
  useEffect(() => {
    void window.api?.getSettings().then((settings) => {
      setLabelMode(settings.labelMode)
      setWindowMode(settings.mode)
    })
  }, [])

  useEffect(() => {
    document.body.classList.toggle('overlay', windowMode === 'overlay')
  }, [windowMode])

  // main からのモード変更(グローバルショートカット)はウィンドウ再生成で反映されるので、
  // 起動時に現在のモードを聞き直す
  useEffect(() => {
    void window.api?.getMode().then(setWindowMode)
  }, [])

  useEffect(() => window.api?.onChooseDevice(setCandidates), [])

  const onLabelMode = useCallback((mode: LabelMode) => {
    setLabelMode(mode)
    void window.api?.setLabelMode(mode)
  }, [])

  const onToggleWindowMode = useCallback(() => {
    void window.api?.toggleMode()
  }, [])

  const onChooseDevice = useCallback((deviceId: string | null) => {
    window.api?.chooseDevice(deviceId)
    setCandidates(null)
  }, [])

  const { geometry, snapshot, engine, layers } = keyboard
  const ready = geometry !== null && snapshot !== null && engine !== null && layers !== null

  return (
    <div className="app-shell flex h-full flex-col overflow-hidden">
      <Toolbar
        status={keyboard.status}
        deviceLabel={keyboard.deviceLabel}
        displayLayer={layers?.displayLayer ?? 0}
        activeLayers={layers?.activeLayers ?? [0]}
        labelMode={labelMode}
        windowMode={windowMode}
        reloading={keyboard.reloading}
        onReload={() => void keyboard.reload()}
        onConnect={() => void keyboard.connect()}
        onConnectMock={() => void keyboard.connectMock()}
        onDisconnect={() => void keyboard.disconnect()}
        onLabelMode={onLabelMode}
        onToggleWindowMode={onToggleWindowMode}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {keyboard.error && (
          <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
            {keyboard.error}
          </div>
        )}

        {keyboard.unlock && (keyboard.status === 'locked' || keyboard.status === 'unlocking') && (
          <UnlockPanel
            unlock={keyboard.unlock}
            unlocking={keyboard.status === 'unlocking'}
            onStart={keyboard.beginUnlock}
          />
        )}

        {ready ? (
          /*
           * ベース以外のレイヤーが出ているあいだは、図全体をそのレイヤーの色で縁取る。
           * 視線がキーの上にあっても、レイヤーが変わったことに気づけるように。
           */
          <div
            className="min-h-0 flex-1 rounded-lg border-2 p-1 transition-colors"
            style={{
              borderColor:
                layers.displayLayer === 0
                  ? 'transparent'
                  : `var(--layer-${layers.displayLayer % 10})`
            }}
          >
            <KeyboardView
              geometry={geometry}
              snapshot={snapshot}
              engine={engine}
              layers={layers}
              labelMode={labelMode}
              unlockKeys={keyboard.unlock?.keys ?? []}
            />
          </div>
        ) : (
          <EmptyState onConnect={() => void keyboard.connect()} onMock={() => void keyboard.connectMock()} />
        )}
      </main>

      {candidates && <DevicePicker devices={candidates} onChoose={onChooseDevice} />}
    </div>
  )
}

function EmptyState({
  onConnect,
  onMock
}: {
  onConnect: () => void
  onMock: () => void
}): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-[var(--muted)]">
        Vial のキーボードに接続すると、キーマップと押しているキーがここに出る。
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConnect}
          className="rounded-md bg-[var(--layer-2)] px-4 py-2 text-xs font-semibold text-neutral-900"
        >
          キーボードに接続
        </button>
        <button
          type="button"
          onClick={onMock}
          className="rounded-md bg-[var(--surface)] px-4 py-2 text-xs font-medium"
        >
          モックで試す
        </button>
      </div>
    </div>
  )
}
