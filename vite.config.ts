import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const pagesBase = process.env.GITHUB_ACTIONS === 'true'
  && repositoryName
  && !repositoryName.endsWith('.github.io')
  ? `/${repositoryName}/`
  : '/'

// https://vite.dev/config/
export default defineConfig({
  base: pagesBase,
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        user: resolve(root, 'index.html'),
        admin: resolve(root, 'admin.html'),
        marketlab: resolve(root, 'marketlab.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
