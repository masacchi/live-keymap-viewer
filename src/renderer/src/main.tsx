// Tauriで動いているならwindow.apiとHIDを用意する。部品より先に読み込むこと
import './platform/tauri'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { reportError } from './lib/report'
import './styles.css'

// Reactの外で起きたエラー(非同期の失敗など)もログに残す。
// 配布ビルドではDevToolsを開けないので、実機で何が起きたかはこれでしか分からない
window.addEventListener('error', (event) => {
  reportError(event.message, event.error instanceof Error ? event.error.stack : undefined)
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportError(
    reason instanceof Error ? reason.message : String(reason),
    reason instanceof Error ? reason.stack : undefined
  )
})

const root = document.getElementById('root')
if (!root) throw new Error('index.htmlに#rootが無い')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
