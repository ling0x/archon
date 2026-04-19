// =============================================================================
// Ollama Service Constants
// =============================================================================

// Build-time injected values (from Vite define config)
// These are baked in at build time for performance

export const SEARCH_FORMULATION_MODEL = __SEARCH_FORMULATION_MODEL__;
export const OLLAMA_ANSWER_NUM_CTX = __OLLAMA_ANSWER_NUM_CTX__;
export const SEARCH_FORMULATION_NUM_CTX = __SEARCH_FORMULATION_NUM_CTX__;
export const OLLAMA_DEEP_ANSWER_NUM_CTX = __OLLAMA_DEEP_ANSWER_NUM_CTX__;
export const PRIOR_ASSISTANT_BUDGET_CHARS_DEEP = __PRIOR_ASSISTANT_BUDGET_CHARS_DEEP__;
export const GAP_FOLLOW_UP_MAX = __GAP_FOLLOW_UP_MAX__;
export const OLLAMA_JSON_NUM_CTX = __OLLAMA_JSON_NUM_CTX__;

// Hardcoded constants
export const MAX_SUB_QUERIES = 3;
export const MAX_SUBQUERY_LEN = 200;
export const PRIOR_ASSISTANT_BUDGET_CHARS = __PRIOR_ASSISTANT_BUDGET_CHARS__;
export const SEARCH_FORMULATION_PRIOR_BUDGET_CHARS = __SEARCH_FORMULATION_PRIOR_BUDGET_CHARS__;