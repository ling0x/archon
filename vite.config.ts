import { defineConfig, loadEnv } from 'vite';
import { contentExtractPlugin } from './vite-plugin-content-extract';

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
  const ollamaDeepAnswerModel = env.OLLAMA_DEEP_ANSWER_MODEL?.trim() ?? '';

  const priorAssistantBudgetChars = envPositiveInt(
    env.PRIOR_ASSISTANT_BUDGET_CHARS,
    6000,
  );
  const priorAssistantBudgetCharsDeep = envPositiveInt(
    env.PRIOR_ASSISTANT_BUDGET_CHARS_DEEP,
    12000,
  );
  const ollamaAnswerNumCtx = envPositiveInt(env.OLLAMA_ANSWER_NUM_CTX, 16384);
  const ollamaDeepAnswerNumCtx = envPositiveInt(env.OLLAMA_DEEP_ANSWER_NUM_CTX, 32768);
  const ollamaJsonNumCtx = envPositiveInt(env.OLLAMA_JSON_NUM_CTX, 16384);
  const searchFormulationPriorBudgetChars = envPositiveInt(
    env.SEARCH_FORMULATION_PRIOR_BUDGET_CHARS,
    10000,
  );
  const searchFormulationNumCtx = envPositiveInt(
    env.SEARCH_FORMULATION_NUM_CTX,
    16384,
  );
  const gapFollowUpMax = envPositiveInt(env.GAP_FOLLOW_UP_MAX, 2);

  const archonShallowPerQuery = envPositiveInt(env.ARCHON_SHALLOW_PER_QUERY, 8);
  const archonShallowMaxTotal = envPositiveInt(env.ARCHON_SHALLOW_MAX_TOTAL, 16);
  const archonShallowMaxRounds = envPositiveInt(env.ARCHON_SHALLOW_MAX_ROUNDS, 1);
  const archonDeepPerQuery = envPositiveInt(env.ARCHON_DEEP_PER_QUERY, 12);
  const archonDeepMaxTotal = envPositiveInt(env.ARCHON_DEEP_MAX_TOTAL, 24);
  const archonDeepMaxRounds = envPositiveInt(env.ARCHON_DEEP_MAX_ROUNDS, 2);
  const extractMaxUrls = envPositiveInt(env.ARCHON_EXTRACT_MAX_URLS, 8);

  const extractPerUrlChars = envPositiveInt(env.ARCHON_EXTRACT_CHARS_PER_URL, 12000);
  const extractTotalChars = envPositiveInt(env.ARCHON_EXTRACT_TOTAL_CHARS, 80000);
  const extractFetchTimeoutMs = envPositiveInt(env.ARCHON_EXTRACT_FETCH_TIMEOUT_MS, 18000);
  const extractResponseBytes = envPositiveInt(env.ARCHON_EXTRACT_RESPONSE_BYTES, 2_000_000);

  return {
    plugins: [
      contentExtractPlugin({
        perUrlCharCap: extractPerUrlChars,
        totalCharCap: extractTotalChars,
        fetchTimeoutMs: extractFetchTimeoutMs,
        maxResponseBytes: extractResponseBytes,
      }),
    ],
    define: {
      __SEARCH_FORMULATION_MODEL__: JSON.stringify(searchFormulationModel),
      __OLLAMA_FALLBACK_MODEL__: JSON.stringify(ollamaFallbackModel),
      __OLLAMA_DEEP_ANSWER_MODEL__: JSON.stringify(ollamaDeepAnswerModel),
      __PRIOR_ASSISTANT_BUDGET_CHARS__: JSON.stringify(priorAssistantBudgetChars),
      __PRIOR_ASSISTANT_BUDGET_CHARS_DEEP__: JSON.stringify(priorAssistantBudgetCharsDeep),
      __OLLAMA_ANSWER_NUM_CTX__: JSON.stringify(ollamaAnswerNumCtx),
      __OLLAMA_DEEP_ANSWER_NUM_CTX__: JSON.stringify(ollamaDeepAnswerNumCtx),
      __OLLAMA_JSON_NUM_CTX__: JSON.stringify(ollamaJsonNumCtx),
      __GAP_FOLLOW_UP_MAX__: JSON.stringify(gapFollowUpMax),
      __SEARCH_FORMULATION_PRIOR_BUDGET_CHARS__: JSON.stringify(
        searchFormulationPriorBudgetChars,
      ),
      __SEARCH_FORMULATION_NUM_CTX__: JSON.stringify(searchFormulationNumCtx),
      __ARCHON_SHALLOW_PER_QUERY__: JSON.stringify(archonShallowPerQuery),
      __ARCHON_SHALLOW_MAX_TOTAL__: JSON.stringify(archonShallowMaxTotal),
      __ARCHON_SHALLOW_MAX_ROUNDS__: JSON.stringify(archonShallowMaxRounds),
      __ARCHON_DEEP_PER_QUERY__: JSON.stringify(archonDeepPerQuery),
      __ARCHON_DEEP_MAX_TOTAL__: JSON.stringify(archonDeepMaxTotal),
      __ARCHON_DEEP_MAX_ROUNDS__: JSON.stringify(archonDeepMaxRounds),
      __ARCHON_EXTRACT_MAX_URLS__: JSON.stringify(extractMaxUrls),
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
