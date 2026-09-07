import { defineConfig } from 'vite';
import { simulationBuild } from './scripts/build-id.mjs';

export default defineConfig({
  define: { __SIM_BUILD__: JSON.stringify(simulationBuild()) },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: {
    chunkSizeWarningLimit: 2600,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('@dimforge')) return 'physics-engine';
      if (id.includes('/three/')) return 'three-renderer';
    } } },
  },
});
