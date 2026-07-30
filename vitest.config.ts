import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: that config loads the Electron
// plugins, which would try to build the main process during a unit test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.ts', 'src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
  // Mirrors the alias in vite.config.js. Without it any module under test that
  // imports through '@/' fails to resolve, which rules out most of src.
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
