// Optional LLM layer (Anthropic Claude via the official TypeScript SDK).
// The deterministic engine is always the source of truth; the model only
// drafts narratives from the JSON facts it is given. When ANTHROPIC_API_KEY
// is not set every helper returns { configured: false } and callers report
// generated_by: 'rules'.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131';
import { env } from './auth.ts';

export type Locale = 'ar' | 'en';
export type Effort = 'low' | 'medium' | 'high';

const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function llmModel(): string {
  return env('AI_MODEL') ?? DEFAULT_MODEL;
}

export function llmConfigured(): boolean {
  return !!env('ANTHROPIC_API_KEY');
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return client;
}

// Stable system prompts (kept byte-identical across requests).
const NARRATIVE_SYSTEM = `You are the reporting assistant of TANMIA, a program and social-impact management platform used by Saudi organizations.

You write short DRAFT narratives for program managers. Rules:
- Use ONLY the facts in the JSON the user provides. Never invent numbers, names, dates, percentages, beneficiaries or events. If a fact is missing, say it is not available.
- Quote numbers exactly as given. Do not recompute or round them differently.
- Write in the language requested: "ar" means clear Modern Standard Arabic; "en" means plain professional English.
- The text is a draft for human review: begin with a one-line label ("مسودة آلية للمراجعة" in Arabic, "Automated draft for review" in English).
- Causal language must match the evidence level supplied in the facts. Distinguish three levels: observed change (a pre/post difference only — never say the program "caused", "led to" or "resulted in" it), contribution (consistent with an approved theory of change and verified evidence — say the program "likely contributed"), and stronger causal evidence (only when a comparison group / difference-in-differences is reported). When no level is supplied, describe changes as observed change only.
- Recommendations must follow from the insights and recommended actions in the facts; present them as suggestions for human decision, not as automatic decisions.
- No markdown headings or tables; short paragraphs or simple bullet lines only.`;

const TRANSLATION_SYSTEM = `You translate assessment questionnaire items for TANMIA, a Saudi program-management platform.
Translate each item faithfully between Arabic (Modern Standard Arabic) and English, preserving meaning, tone, scale direction and any placeholders.
Do not add, drop or merge items. Keep each id exactly as given. Return only the JSON requested.`;

export interface LlmResult {
  text: string | null;
  configured: boolean;
  model: string | null;
  refused?: boolean;
  truncated?: boolean;
  error?: string;
}

// deno-lint-ignore no-explicit-any
type JsonSchema = Record<string, any>;

async function call(opts: { system: string; prompt: string; effort: Effort; maxTokens: number; schema?: JsonSchema }): Promise<LlmResult> {
  const c = getClient();
  const model = llmModel();
  if (!c) return { text: null, configured: false, model: null };
  try {
    const res = await c.beta.messages.create({
      model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
      output_config: opts.schema ? { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } } : { effort: opts.effort },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
    // Always inspect stop_reason before reading content.
    if (res.stop_reason === 'refusal') {
      return { text: null, configured: true, model: res.model ?? model, refused: true };
    }
    const text = res.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { text: text || null, configured: true, model: res.model ?? model, truncated: res.stop_reason === 'max_tokens' };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      console.error('[llm] rate limited');
      return { text: null, configured: true, model, error: 'rate_limited' };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      console.error('[llm] connection error', e.message);
      return { text: null, configured: true, model, error: 'connection_error' };
    }
    if (e instanceof Anthropic.APIError) {
      console.error('[llm] api error', e.status, e.message);
      return { text: null, configured: true, model, error: `api_error_${e.status ?? 'unknown'}` };
    }
    throw e;
  }
}

/**
 * Drafts a grounded narrative from JSON facts. `task` describes what to write.
 * Returns text null when not configured, refused, or on provider error.
 */
export async function draftNarrative(input: { task: string; facts: unknown; locale: Locale; effort?: Effort; maxTokens?: number }): Promise<LlmResult> {
  if (!llmConfigured()) return { text: null, configured: false, model: null };
  const prompt = [
    `Language: ${input.locale}`,
    `Task: ${input.task}`,
    'Facts (JSON, the only allowed source):',
    '<facts>',
    JSON.stringify(input.facts),
    '</facts>',
  ].join('\n');
  return call({ system: NARRATIVE_SYSTEM, prompt, effort: input.effort ?? 'low', maxTokens: input.maxTokens ?? 4000 });
}

/** Like draftNarrative but asks for a JSON object with the given string fields. */
export async function draftSections<K extends string>(input: { task: string; facts: unknown; locale: Locale; fields: Record<K, string>; effort?: Effort; maxTokens?: number }):
  Promise<{ sections: Partial<Record<K, string>> | null } & Omit<LlmResult, 'text'>> {
  if (!llmConfigured()) return { sections: null, configured: false, model: null };
  const keys = Object.keys(input.fields) as K[];
  const schema: JsonSchema = {
    type: 'object',
    properties: Object.fromEntries(keys.map((k) => [k, { type: 'string', description: input.fields[k] }])),
    required: keys,
    additionalProperties: false,
  };
  const prompt = [
    `Language: ${input.locale}`,
    `Task: ${input.task}`,
    `Return a JSON object with these string fields: ${keys.map((k) => `"${k}" (${input.fields[k]})`).join('; ')}.`,
    'Facts (JSON, the only allowed source):',
    '<facts>',
    JSON.stringify(input.facts),
    '</facts>',
  ].join('\n');
  const r = await call({ system: NARRATIVE_SYSTEM, prompt, effort: input.effort ?? 'medium', maxTokens: input.maxTokens ?? 8000, schema });
  const { text, ...rest } = r;
  if (!text) return { sections: null, ...rest };
  const parsed = parseJsonLoose(text);
  if (!parsed || typeof parsed !== 'object') return { sections: null, ...rest, error: rest.error ?? 'invalid_json' };
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const v = (parsed as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return { sections: out, ...rest };
}

/** Machine translation of questionnaire strings. Returns id → translated text. */
export async function translateItems(items: { id: string; text: string }[], target: Locale):
  Promise<{ translations: Record<string, string> | null } & Omit<LlmResult, 'text'>> {
  if (!llmConfigured()) return { translations: null, configured: false, model: null };
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, text: { type: 'string' } },
          required: ['id', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['translations'],
    additionalProperties: false,
  };
  const prompt = [
    `Target language: ${target === 'ar' ? 'Arabic (Modern Standard Arabic)' : 'English'}.`,
    'Translate every item. Return {"translations":[{"id":"...","text":"..."}]} with one entry per input item.',
    '<items>',
    JSON.stringify(items),
    '</items>',
  ].join('\n');
  const r = await call({ system: TRANSLATION_SYSTEM, prompt, effort: 'low', maxTokens: 8000, schema });
  const { text, ...rest } = r;
  if (!text) return { translations: null, ...rest };
  const parsed = parseJsonLoose(text) as { translations?: { id?: unknown; text?: unknown }[] } | null;
  if (!parsed || !Array.isArray(parsed.translations)) return { translations: null, ...rest, error: rest.error ?? 'invalid_json' };
  const ids = new Set(items.map((i) => i.id));
  const out: Record<string, string> = {};
  for (const t of parsed.translations) {
    if (typeof t?.id === 'string' && ids.has(t.id) && typeof t.text === 'string' && t.text.trim()) out[t.id] = t.text.trim();
  }
  return { translations: out, ...rest };
}

/** JSON.parse that tolerates surrounding prose or code fences. */
export function parseJsonLoose(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}
