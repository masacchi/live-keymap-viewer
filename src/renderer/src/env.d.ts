/// <reference types="vite/client" />
import type { RendererApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** preload が contextBridge で載せる。ブラウザで開いたときは undefined。 */
    api?: RendererApi
  }
}

export {}
