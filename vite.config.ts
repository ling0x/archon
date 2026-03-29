import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const parsed = Number.parseInt(env.PORT ?? '', 10);
  const port = Number.isFinite(parsed) ? parsed : 5173;

  const searchFormulationModel =
    env.SEARCH_FORMULATION_MODEL?.trim() || 'qwen3.5:9b';
  const ollamaFallbackModel =
    env.OLLAMA_FALLBACK_MODEL?.trim() || 'gpt-oss:20b';

  return {
    define: {
      __SEARCH_FORMULATION_MODEL__: JSON.stringify(searchFormulationModel),
      __OLLAMA_FALLBACK_MODEL__: JSON.stringify(ollamaFallbackModel),
    },
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
