import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2600,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('@dimforge')) return 'physics-engine';
      if (id.includes('/three/')) return 'three-renderer';
    } } },
  },
});
