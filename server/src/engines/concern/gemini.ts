/**
 * ENGINE 1 — Google Gemini provider (owner: B). Has a free tier, needs GEMINI_API_KEY
 * from https://aistudio.google.com. Free-tier quotas are small and change often;
 * hitting one just means this request falls back to rules.
 * Returns null on a blocked or unparseable answer; throws on network/API errors.
 */
import { GoogleGenAI } from '@google/genai';
import { OutputSchema, SYSTEM_PROMPT, customerMessage, toLlmConcern, type ConcernClassifier } from './prompt';

// Fast enough for a 10 s timeout on the free tier; gemini-2.5-flash is closed to new keys.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/** Same shape as OutputSchema, written in the JSON Schema subset Gemini accepts. */
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    primary: { type: 'string', enum: ['MED', 'INC', 'ACC', 'DEBT', 'UNCLEAR'] },
    keywords: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
  required: ['primary', 'keywords'],
  additionalProperties: false,
};

let client: GoogleGenAI | undefined;

export const classifyWithGemini: ConcernClassifier = async (redactedText) => {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 10_000 } });
  const response = await client.models.generateContent({
    model: process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    contents: customerMessage(redactedText),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_JSON_SCHEMA,
      temperature: 0,
      maxOutputTokens: 512,
    },
  });
  return parseGeminiText(response.text);
};

/** Exported for tests. Blocked answers come back with no text. */
export function parseGeminiText(text: string | undefined): ReturnType<typeof toLlmConcern> | null {
  if (!text) return null;
  try {
    const parsed = OutputSchema.safeParse(JSON.parse(text));
    return parsed.success ? toLlmConcern(parsed.data) : null;
  } catch {
    return null; // not JSON
  }
}
