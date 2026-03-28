import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const parsed = Number.parseInt(env.PORT ?? '', 10);
  const port = Number.isFinite(parsed) ? parsed : 5173;

  return {
    publicDir: 'static',
    server: {
      port,
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
  };
});
