import type { StagApi } from './index'

declare global {
  interface Window {
    stag: StagApi
  }
}
