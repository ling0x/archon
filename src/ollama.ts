// =============================================================================
// Ollama Service - Re-exports
// =============================================================================
// This file re-exports the ollama service for backward compatibility.
// New code should import from services/ollama directly.

// Re-export types for external consumers
export type { OllamaStreamChunk } from './services/ollama';

// Re-export services for backward compatibility
export {
  formulateSearchQueries,
  analyzeSearchGaps,
  formulateDeepResearchPlanAndQueries,
  streamOllamaAnswer,
  streamOllamaResearchNotes,
  buildPriorBlock,
  buildPriorBlockForAnswer,
  SEARCH_FORMULATION_MODEL,
} from './services/ollama';

// Re-export types
export type {
  GapAnalysisResult,
  DeepResearchPlanResult,
  FormulationProgressHandlers,
  StreamChunk,
  PriorTurn,
} from './services/ollama';