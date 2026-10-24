/**
 * LLM wire formats (ADR 0002). Deliberately flat: math travels as LaTeX strings and is
 * parsed into IR by our own deterministic parser, never by the model.
 */
import { z } from 'zod';

export const WireSegmentSchema = z.object({
  type: z.enum(['text', 'math']),
  /** prose for text segments, LaTeX for math segments */
  content: z.string().max(4000),
});

export const RecognizeWireSchema = z.object({
  unreadable: z.boolean(),
  segments: z.array(WireSegmentSchema).max(16),
});

export const SuggestWireSchema = z.object({
  has_candidate: z.boolean(),
  role: z.enum(['step', 'definition', 'premise']),
  segments: z.array(WireSegmentSchema).max(16),
});

export const OcrWireSchema = z.object({ text: z.string().max(20000) });

export type WireSegment = z.infer<typeof WireSegmentSchema>;
export type RecognizeWire = z.infer<typeof RecognizeWireSchema>;
export type SuggestWire = z.infer<typeof SuggestWireSchema>;
export type OcrWire = z.infer<typeof OcrWireSchema>;

const segmentJsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['text', 'math'] },
    content: { type: 'string' },
  },
  required: ['type', 'content'],
  additionalProperties: false,
} as const;

/** JSON Schemas handed to the provider's structured-output mode. */
export const RECOGNIZE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    unreadable: { type: 'boolean' },
    segments: { type: 'array', items: segmentJsonSchema, maxItems: 16 },
  },
  required: ['unreadable', 'segments'],
  additionalProperties: false,
} as const;

export const SUGGEST_JSON_SCHEMA = {
  type: 'object',
  properties: {
    has_candidate: { type: 'boolean' },
    role: { type: 'string', enum: ['step', 'definition', 'premise'] },
    segments: { type: 'array', items: segmentJsonSchema, maxItems: 16 },
  },
  required: ['has_candidate', 'role', 'segments'],
  additionalProperties: false,
} as const;

export const OCR_JSON_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
} as const;
