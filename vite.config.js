import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Windows: native file events get lost after atomic saves (stale modules); polling is reliable.
  server: { watch: { usePolling: true, interval: 200 } },
})
