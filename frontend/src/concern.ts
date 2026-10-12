/**
 * What the concern engine (Engine 1) understood from the free text, in a form the
 * form can show. Free text overrides the chip on the server, so the user must see it.
 */
import type { ConcernCode, ConcernResult } from '@insightshield/shared';

export type ConcernInsight =
  | { kind: 'none' }                                   // no text typed
  | { kind: 'pending' }                                // text typed, result not back yet
  | { kind: 'no-signal' }                              // text had nothing recognisable; the chip is used
  | { kind: 'read'; primary: ConcernCode; keywords: string[]; byAi: boolean; overridesChoice: boolean };

/**
 * @param text      the free text currently in the box
 * @param result    the engine's result, or null when it isn't for the current text yet
 * @param chosen    the concern chip the user selected
 */
export function readConcern(text: string | undefined, result: ConcernResult | null, chosen: ConcernCode): ConcernInsight {
  if (!text?.trim()) return { kind: 'none' };
  if (!result) return { kind: 'pending' };
  const keywords = [...new Set(result.extracted.keywords)].slice(0, 3);
  const byAi = result.source === 'llm';
  // The rules engine only moves off the chip when it finds keywords; an LLM may decide without them
  if (!byAi && keywords.length === 0) return { kind: 'no-signal' };
  return { kind: 'read', primary: result.primary, keywords, byAi, overridesChoice: result.primary !== chosen };
}
