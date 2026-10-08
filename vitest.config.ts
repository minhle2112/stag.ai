import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Test logic thuần của main + renderer, chạy trong Node (không có DOM, không chạy Electron).
// Alias giống electron.vite.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
