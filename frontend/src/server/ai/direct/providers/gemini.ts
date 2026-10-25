import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { AiError } from '../../errors';
import type { JsonRequest, LlmProvider } from './types';

/** Gemini via the Interactions API with JSON-schema output. Retries 429/5xx/timeouts once (spec §13). */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  readonly mock = false;
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateJson(req: JsonRequest): Promise<unknown> {
    const started = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.once(req, req.timeoutMs - (Date.now() - started));
      } catch (e) {
        const err = this.toAiError(e, req.signal);
        const remaining = req.timeoutMs - (Date.now() - started);
        if (attempt === 0 && err.retryable && remaining > 2000 && !req.signal.aborted) {
          await new Promise((r) => setTimeout(r, Math.min(1000, remaining / 4)));
          continue;
        }
        throw err;
      }
    }
    throw new AiError('UPSTREAM_INVALID', 'unreachable');
  }

  private async once(req: JsonRequest, timeoutMs: number): Promise<unknown> {
    const input = req.parts.map((p) =>
      p.type === 'text'
        ? { type: 'text' as const, text: p.text }
        : { type: 'image' as const, data: p.data, mime_type: p.mime, resolution: 'high' as const },
    );
    const interaction = await this.client.interactions.create(
      {
        model: req.model,
        system_instruction: req.system,
        input,
        response_format: { type: 'text', mime_type: 'application/json', schema: req.schema },
        generation_config: { thinking_level: req.thinking, max_output_tokens: req.maxOutputTokens },
        store: false,
      },
      // our generateJson owns the retry policy; SDK retries on 429 would outlive the job deadline
      { timeout_ms: Math.max(1000, timeoutMs), fetchOptions: { signal: req.signal }, retries: { strategy: 'none' } },
    );
    const text = interaction.output_text;
    if (!text) throw new AiError('UPSTREAM_INVALID', 'empty model output', true);
    try {
      return JSON.parse(repairJsonLatex(text));
    } catch {
      try {
        return JSON.parse(text);
      } catch {
        // truncated or non-JSON output is never treated as success
        throw new AiError('SCHEMA_INVALID', 'model output is not valid JSON');
      }
    }
  }

  private toAiError(e: unknown, signal: AbortSignal): AiError {
    if (e instanceof AiError) return e;
    if (signal.aborted) return new AiError('UPSTREAM_TIMEOUT', 'request aborted');
    const status = (e as { status?: number; statusCode?: number }).status ?? (e as { statusCode?: number }).statusCode;
    const message = e instanceof Error ? e.message : String(e);
    if (status === 429) {
      // e.g. "limit: 20 requests per day on Free Tier … Please retry in 2h9m51s": a quota, not a blip
      const limit = /limit:[^)]*\)?/i.exec(message)?.[0];
      const wait = /retry in ([0-9hms.]+)/i.exec(message)?.[1];
      const daily = /per day/i.test(message) || (wait !== undefined && /h|[0-9]{2,}m/.test(wait));
      const detail = ['Gemini quota reached', limit && `(${limit.replace(/\)$/, '')})`, wait && `retry in ${wait}`].filter(Boolean).join(' ');
      return new AiError('UPSTREAM_429', daily ? `${detail}. Enable billing or set LLM_MODEL_* to another model.` : detail, !daily);
    }
    if (status === 401 || status === 403) return new AiError('UPSTREAM_AUTH', 'provider rejected the API key');
    if (status && status >= 500) return new AiError('UPSTREAM_INVALID', `provider error ${status}`, true);
    if (status && status >= 400) return new AiError('UPSTREAM_INVALID', `provider rejected the request (${status}): ${message.slice(0, 200)}`);
    if (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message)) return new AiError('UPSTREAM_TIMEOUT', 'provider timeout', true);
    return new AiError('UPSTREAM_INVALID', message.slice(0, 200), true);
  }
}

/**
 * Repairs raw JSON from LLMs when LaTeX formulas contain single backslashes.
 * In JSON strings, single-backslash LaTeX commands like \frac, \tau, \notag, \int, \sqrt
 * either turn into control characters (\f -> formfeed, \t -> tab, \n -> newline)
 * or cause JSON.parse syntax errors (\i, \s, \,).
 * This function preserves valid JSON escapes (\" and \\) and properly escapes any
 * LaTeX backslashes inside JSON string literals.
 */
export function repairJsonLatex(jsonStr: string): string {
  let inString = false;
  let result = '';
  let i = 0;
  while (i < jsonStr.length) {
    const ch = jsonStr[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      i++;
      continue;
    }
    // Inside string literal
    if (ch === '"') {
      inString = false;
      result += ch;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = jsonStr[i + 1];
      if (next === undefined) {
        result += '\\\\';
        i++;
        continue;
      }
      // If already escaped \\
      if (next === '\\') {
        result += '\\\\';
        i += 2;
        continue;
      }
      // If escaped quote \"
      if (next === '"') {
        result += '\\"';
        i += 2;
        continue;
      }
      // If valid unicode escape \uXXXX
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(jsonStr.slice(i + 2, i + 6))) {
        result += jsonStr.slice(i, i + 6);
        i += 6;
        continue;
      }
      // If JSON whitespace escape (\n, \r, \t) NOT followed by a letter, preserve it
      if ((next === 'n' || next === 'r' || next === 't') && !/[a-zA-Z]/.test(jsonStr[i + 2] ?? '')) {
        result += '\\' + next;
        i += 2;
        continue;
      }
      // Any other backslash in JSON string is a LaTeX command:
      // \frac, \tint, \notag, \tau, \theta, \int, \sqrt, \,
      result += '\\\\';
      i++;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}
