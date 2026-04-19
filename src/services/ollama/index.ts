// Ollama Service - Public API
export { formulateSearchQueries } from './formulation';
export { analyzeSearchGaps } from './gapAnalysis';
export { formulateDeepResearchPlanAndQueries } from './deepResearch';
export { streamOllamaAnswer } from './answers';
export { streamOllamaResearchNotes } from './researchNotes';
export { buildPriorBlock, buildPriorBlockForAnswer } from './prior';

export type { GapAnalysisResult, DeepResearchPlanResult, FormulationProgressHandlers } from '../../types';
export type { OllamaStreamChunk, PriorTurn, StreamChunk } from '../../types';

export {
  SEARCH_FORMULATION_MODEL,
  OLLAMA_ANSWER_NUM_CTX,
  SEARCH_FORMULATION_NUM_CTX,
  OLLAMA_DEEP_ANSWER_NUM_CTX,
  PRIOR_ASSISTANT_BUDGET_CHARS_DEEP,
  GAP_FOLLOW_UP_MAX,
  OLLAMA_JSON_NUM_CTX,
  MAX_SUB_QUERIES,
  MAX_SUBQUERY_LEN,
  PRIOR_ASSISTANT_BUDGET_CHARS,
  SEARCH_FORMULATION_PRIOR_BUDGET_CHARS,
} from './constants';