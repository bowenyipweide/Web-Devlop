import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The e2e suite overrides this so Playwright talks to its own throwaway backend
// (see playwright.config.js) instead of a developer's dev server on :4000.
const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split vendor code so no single fingerprinted bundle has to be
        // compiled in one long task. Keeping react, the router and telemetry
        // apart also lets them be cached and parsed independently.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-router') || id.includes('@remix-run')) return 'router';
          if (id.includes('faro') || id.includes('grafana') || id.includes('opentelemetry')) return 'telemetry';
          if (id.includes('node_modules/react-dom/') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler/')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
