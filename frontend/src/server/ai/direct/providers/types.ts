export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export type Part = { type: 'text'; text: string } | { type: 'image'; mime: 'image/png' | 'image/jpeg'; data: string };

export interface JsonRequest {
  task: 'recognize' | 'suggest' | 'ocr';
  model: string;
  thinking: ThinkingLevel;
  /** static instructions first, so identical prefixes can be cached by the provider */
  system: string;
  parts: Part[];
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  readonly mock: boolean;
  generateJson(req: JsonRequest): Promise<unknown>;
}
