import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { reportError } from './lib/report'
import './styles.css'

// React の外で起きたもの(非同期の失敗など)も main のログに残す。
// 配布ビルドでは DevTools を開けないので、実機で何が起きたかはこれでしか分からない
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
if (!root) throw new Error('index.html に #root が無い')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
