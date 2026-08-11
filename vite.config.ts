import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import pkg from './package.json'

export default defineConfig({
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          // Enable remote debugging on port 9222 for Chrome DevTools Protocol
          args.startup(['.', '--remote-debugging-port=9222'])
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs'],
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
      // Note: extension-host/host.html and preload.ts are handled by
      // scripts/copy-extension-host.js, which runs from both the predev and build scripts.
      // It must run after `vite build` so this plugin's outDir cleaning cannot remove them.
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    keepNames: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
})
