import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: that config loads the Electron
// plugins, which would try to build the main process during a unit test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.ts', 'src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
})
