import 'server-only';
import {
  OCR_JSON_SCHEMA,
  OcrWireSchema,
  RECOGNIZE_JSON_SCHEMA,
  RecognizeWireSchema,
  SUGGEST_JSON_SCHEMA,
  SuggestWireSchema,
  wireToSegments,
  type CandidateDraftResult,
  type OcrPageInput,
  type OcrPageResult,
  type RecognizeInput,
  type RecognizeResult,
  type SuggestInput,
} from '@mn/contracts';
import type { ServerEnv } from '@/server/env';
import { AiError } from '../errors';
import type { AiService, CallCtx } from '../service';
import { finalizeCandidate } from './candidate';
import { DEMO_SCRIPT_ID, scriptedRecognition, scriptedSuggestion } from './demo';
import { OCR_SYSTEM, RECOGNIZE_SYSTEM, SUGGEST_SYSTEM, recognizeParts, suggestParts } from './prompts';
import type { LlmProvider } from './providers/types';

/** Stage 1: the Next.js server calls the LLM itself. Relay mode swaps this for the FastAPI backend. */
export class DirectAiService implements AiService {
  constructor(
    private llm: LlmProvider,
    private env: ServerEnv,
  ) {}

  status() {
    return { provider: this.llm.name, configured: !this.llm.mock, mock: this.llm.mock };
  }

  async recognize(input: RecognizeInput, ctx: CallCtx): Promise<RecognizeResult> {
    if (this.llm.mock) {
      if (input.demo?.script === DEMO_SCRIPT_ID) return scriptedRecognition(input);
      return { segments: [], unreadable: true, mock: true };
    }
    const raw = await this.llm.generateJson({
      task: 'recognize',
      model: this.env.LLM_MODEL_RECOGNIZE,
      thinking: this.env.LLM_THINKING_RECOGNIZE,
      system: RECOGNIZE_SYSTEM,
      parts: recognizeParts(input),
      schema: RECOGNIZE_JSON_SCHEMA,
      maxOutputTokens: 4096,
      timeoutMs: 30_000,
      signal: ctx.signal,
    });
    const wire = RecognizeWireSchema.safeParse(raw);
    if (!wire.success) throw new AiError('SCHEMA_INVALID', 'recognition output did not match the schema');
    const transcription = wire.data.segments.map((s) => s.content).join('  ');
    if (wire.data.segments.length === 0) {
      if (wire.data.unreadable) throw new AiError('RECOGNIZE_UNREADABLE', 'nothing in the line could be read');
      throw new AiError('SCHEMA_INVALID', 'empty transcription');
    }
    // a read the parser cannot handle is kept as written and marked not checkable, never failed
    const parsed = wireToSegments(wire.data.segments, { functions: input.functions, symbols: input.symbols, allowUnparsed: true });
    if (!parsed.ok) throw new AiError('IR_INVALID', `${parsed.message} — read as: ${parsed.latex}`.slice(0, 400));
    return { segments: parsed.segments, unreadable: wire.data.unreadable, mock: false, transcription, ...(wire.data.route ? { route: wire.data.route } : {}) };
  }

  async suggest(input: SuggestInput, ctx: CallCtx): Promise<CandidateDraftResult> {
    if (input.mode === 'BRIDGE') throw new AiError('FEATURE_DISABLED', 'bridging is not enabled');
    // an unresolved wrong line locks completion for every mode (spec §11): the model is not asked at all
    if (input.context.lines.some((l) => l.status === 'wrong')) return { state: 'NONE', reason: 'UNRESOLVED_WRONG', mock: this.llm.mock };
    if (input.demo?.script === DEMO_SCRIPT_ID) return scriptedSuggestion(input, ctx.signal);
    if (this.llm.mock) return { state: 'NONE', reason: 'MOCK_PROVIDER', mock: true };
    const raw = await this.llm.generateJson({
      task: 'suggest',
      model: this.env.LLM_MODEL_SUGGEST,
      thinking: this.env.LLM_THINKING_SUGGEST,
      system: SUGGEST_SYSTEM,
      parts: suggestParts(input),
      schema: SUGGEST_JSON_SCHEMA,
      // Larger than the 600 tokens / 20 s of spec v2.0 §13 (AI-S), which predates Gemini's thinking_level: the model's
      // thinking tokens count against the output limit, so 600 would cut the answer off. This reasoning is an
      // assumption, not measured; v2.1 gives no figures. Revisit with real latency and truncation data (NOTES R29).
      maxOutputTokens: 8192,
      timeoutMs: 40_000,
      signal: ctx.signal,
    });
    const wire = SuggestWireSchema.safeParse(raw);
    if (!wire.success) throw new AiError('SCHEMA_INVALID', 'suggestion output did not match the schema');
    if (process.env.NODE_ENV === 'development') console.info('[suggest]', input.mode, JSON.stringify(raw).slice(0, 600));
    if (!wire.data.has_candidate) return { state: 'NONE', reason: 'MODEL_DECLINED', mock: false };
    const strict = wireToSegments(wire.data.segments, { functions: input.context.functions ?? [] });
    // a proof step keeps notation the CAS cannot read: Lean checks it instead (ADR 0008)
    const proofStep = wire.data.route === 'lean' && input.mode === 'NEXT_STEP';
    const parsed = proofStep ? wireToSegments(wire.data.segments, { functions: input.context.functions ?? [], allowUnparsed: true }) : strict;
    if (!parsed.ok) {
      if (process.env.NODE_ENV === 'development') console.info('[suggest] unparsable', parsed.message, parsed.latex);
      return { state: 'NONE', reason: 'IR_INVALID', mock: false };
    }
    return finalizeCandidate(input, parsed.segments, wire.data.role, false, proofStep ? 'lean' : undefined);
  }

  async ocrPage(input: OcrPageInput, ctx: CallCtx): Promise<OcrPageResult> {
    if (this.llm.mock) return { text: '', mock: true };
    const raw = await this.llm.generateJson({
      task: 'ocr',
      model: this.env.LLM_MODEL_OCR,
      thinking: this.env.LLM_THINKING_OCR,
      system: OCR_SYSTEM,
      parts: [{ type: 'image', mime: input.image.mime, data: input.image.data }],
      schema: OCR_JSON_SCHEMA,
      maxOutputTokens: 8192,
      timeoutMs: 25_000,
      signal: ctx.signal,
    });
    const wire = OcrWireSchema.safeParse(raw);
    if (!wire.success) throw new AiError('SCHEMA_INVALID', 'OCR output did not match the schema');
    return { text: wire.data.text, mock: false };
  }
}
