/**
 * ENGINE 1 — LLM provider switch (owner: B)
 * Picks which provider classifies concernText, from env:
 *   CONCERN_LLM=off             -> no LLM, rules only
 *   CONCERN_LLM_PROVIDER=gemini -> Gemini (GEMINI_API_KEY, free tier)
 *   CONCERN_LLM_PROVIDER=claude -> Claude (ANTHROPIC_API_KEY, paid)
 *   no provider set             -> whichever key exists; Claude if both
 * Never runs under tests: CI must stay offline and deterministic.
 */
import { classifyWithClaude } from './claude';
import { classifyWithGemini } from './gemini';
import type { ConcernClassifier } from './prompt';

export type { ConcernClassifier, LlmConcern } from './prompt';

export type LlmProvider = 'claude' | 'gemini';

const CLASSIFIERS: Record<LlmProvider, ConcernClassifier> = { claude: classifyWithClaude, gemini: classifyWithGemini };
const KEY_VAR: Record<LlmProvider, string> = { claude: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' };

export function selectProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  if (env.CONCERN_LLM === 'off' || env.NODE_ENV === 'test') return null;
  const requested = env.CONCERN_LLM_PROVIDER;
  if (requested === 'claude' || requested === 'gemini') return env[KEY_VAR[requested]] ? requested : null;
  if (env.ANTHROPIC_API_KEY) return 'claude';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

export const llmEnabled = (env: NodeJS.ProcessEnv = process.env) => selectProvider(env) !== null;

export function selectClassifier(env: NodeJS.ProcessEnv = process.env): ConcernClassifier | null {
  const provider = selectProvider(env);
  return provider ? CLASSIFIERS[provider] : null;
}
