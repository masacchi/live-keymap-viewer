/// <reference types="vite/client" />
import type { RendererApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** Tauri で動いているときに platform/tauri.ts が載せる。ブラウザで開いたときは undefined。 */
    api?: RendererApi
  }
}
