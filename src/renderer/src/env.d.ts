/// <reference types="vite/client" />
import type { RendererApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** Tauriで動いているときにplatform/tauri.tsが載せる。ブラウザで開いたときはundefined。 */
    api?: RendererApi
  }
}
