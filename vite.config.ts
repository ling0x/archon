import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/searxng': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/searxng/, ''),
      },
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
});
