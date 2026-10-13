/**
 * ENGINE 1 — Claude provider (owner: B). Paid API, needs ANTHROPIC_API_KEY.
 * Returns null on refusal or unparseable output; throws on network/API errors.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { OutputSchema, SYSTEM_PROMPT, customerMessage, toLlmConcern, type ConcernClassifier } from './prompt';

const DEFAULT_MODEL = 'claude-opus-5-5';

let client: Anthropic | undefined;

export const classifyWithClaude: ConcernClassifier = async (redactedText) => {
  client ??= new Anthropic({ timeout: 10_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model: process.env.CLAUDE_MODEL ?? DEFAULT_MODEL,
    max_tokens: 2048,
    output_config: { effort: 'low', format: betaZodOutputFormat(OutputSchema) },
    // On a safety decline, the API retries on a fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: customerMessage(redactedText) }],
  });
  const parsed = response.parsed_output;
  if (response.stop_reason === 'refusal' || !parsed) return null;
  return toLlmConcern(parsed);
};
