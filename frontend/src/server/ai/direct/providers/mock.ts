import 'server-only';
import type { JsonRequest, LlmProvider } from './types';

/** No network. Used when no API key is configured and in tests; outputs follow the wire schemas. */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly mock = true;

  async generateJson(req: JsonRequest): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 600));
    switch (req.task) {
      case 'recognize':
        return { unreadable: false, segments: [{ type: 'math', content: 'x^2 - 1' }] };
      case 'suggest':
        return { has_candidate: false, role: 'step', segments: [] };
      case 'ocr':
        return { text: '(mock transcription)' };
      case 'lean':
        return { scope: 'theorem', statement: '', steps: [], hint: '' };
    }
  }
}
