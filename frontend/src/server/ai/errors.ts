export type AiErrorCode =
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_429'
  | 'UPSTREAM_AUTH'
  | 'UPSTREAM_INVALID'
  | 'SCHEMA_INVALID'
  | 'IR_INVALID'
  | 'RECOGNIZE_UNREADABLE'
  | 'LLM_NOT_CONFIGURED'
  | 'FEATURE_DISABLED';

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
