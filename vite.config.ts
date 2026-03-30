import { defineConfig, loadEnv } from 'vite';

function envPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw?.trim() ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const parsed = Number.parseInt(env.PORT ?? '', 10);
  const port = Number.isFinite(parsed) ? parsed : 5173;

  const searchFormulationModel =
    env.SEARCH_FORMULATION_MODEL?.trim() || 'qwen3.5:9b';
  const ollamaFallbackModel =
    env.OLLAMA_FALLBACK_MODEL?.trim() || 'gpt-oss:20b';

  const priorAssistantBudgetChars = envPositiveInt(
    env.PRIOR_ASSISTANT_BUDGET_CHARS,
    6000,
  );
  const ollamaAnswerNumCtx = envPositiveInt(env.OLLAMA_ANSWER_NUM_CTX, 16384);
  const searchFormulationPriorBudgetChars = envPositiveInt(
    env.SEARCH_FORMULATION_PRIOR_BUDGET_CHARS,
    10000,
  );
  const searchFormulationNumCtx = envPositiveInt(
    env.SEARCH_FORMULATION_NUM_CTX,
    16384,
  );

  return {
    define: {
      __SEARCH_FORMULATION_MODEL__: JSON.stringify(searchFormulationModel),
      __OLLAMA_FALLBACK_MODEL__: JSON.stringify(ollamaFallbackModel),
      __PRIOR_ASSISTANT_BUDGET_CHARS__: JSON.stringify(priorAssistantBudgetChars),
      __OLLAMA_ANSWER_NUM_CTX__: JSON.stringify(ollamaAnswerNumCtx),
      __SEARCH_FORMULATION_PRIOR_BUDGET_CHARS__: JSON.stringify(
        searchFormulationPriorBudgetChars,
      ),
      __SEARCH_FORMULATION_NUM_CTX__: JSON.stringify(searchFormulationNumCtx),
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
