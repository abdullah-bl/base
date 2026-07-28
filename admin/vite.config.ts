import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  base: '/_/',
  build: {
    outDir: resolve(root, '../src/admin/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, 'index.html'),
      output: {
        entryFileNames: 'admin.js',
        chunkFileNames: 'admin-[name].js',
        assetFileNames: 'admin[extname]',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
