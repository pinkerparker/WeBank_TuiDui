/**
 * ENGINE 1 — PII redaction (owner: B)
 * Runs on concernText before it leaves the server (LLM call) and before keywords
 * reach the audit ledger. Best-effort pattern matching, not a guarantee: free-form
 * names without a "my name is" cue are not caught.
 */

export type PiiKind = 'EMAIL' | 'URL' | 'NUMBER' | 'NAME';

const RULES: { kind: PiiKind; pattern: RegExp }[] = [
  { kind: 'EMAIL', pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu },
  { kind: 'URL', pattern: /\b(?:https?:\/\/|www\.)\S+/giu },
  // Phone, card, account, ID and passport numbers: 7+ digits, allowing spaces, dots and dashes.
  { kind: 'NUMBER', pattern: /\+?\d(?:[\s.-]?\d){6,}/gu },
  { kind: 'NAME', pattern: /\b(?:[Mm]y name is|[Nn]ame\s*:|I am called|I'm called)\s+\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*)*/gu },
];

export function redactPii(text: string): { text: string; found: PiiKind[] } {
  const found: PiiKind[] = [];
  let out = text;
  for (const { kind, pattern } of RULES) {
    out = out.replace(pattern, (match) => {
      found.push(kind);
      // Keep the cue words so the sentence still reads naturally ("my name is [NAME]").
      if (kind === 'NAME') return match.replace(/\s+\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*)*$/u, ' [NAME]');
      return `[${kind}]`;
    });
  }
  return { text: out, found };
}
