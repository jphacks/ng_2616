import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { repairJsonLatex } from '@/server/ai/direct/providers/gemini';

describe('repairJsonLatex', () => {
  it('repairs single-backslash LaTeX commands in JSON strings', () => {
    const raw = '{"content": "4 \\notag \\tint_{2}^{3} \\frac{1}{x} \\, dx"}';
    const repaired = repairJsonLatex(raw);
    const parsed = JSON.parse(repaired) as { content: string };
    assert.equal(parsed.content, '4 \\notag \\tint_{2}^{3} \\frac{1}{x} \\, dx');
  });

  it('repairs illegal JSON escape sequences without crashing JSON.parse', () => {
    const raw = '{"content": "\\int_{2}^{3} \\sqrt{x} \\left( \\frac{1}{2} \\right) \\, dx"}';
    assert.throws(() => JSON.parse(raw));
    const repaired = repairJsonLatex(raw);
    const parsed = JSON.parse(repaired) as { content: string };
    assert.equal(parsed.content, '\\int_{2}^{3} \\sqrt{x} \\left( \\frac{1}{2} \\right) \\, dx');
  });

  it('preserves already double-escaped valid JSON', () => {
    const raw = '{"content": "\\\\int_{2}^{3} \\\\frac{1}{x} \\\\, dx"}';
    const repaired = repairJsonLatex(raw);
    const parsed = JSON.parse(repaired) as { content: string };
    assert.equal(parsed.content, '\\int_{2}^{3} \\frac{1}{x} \\, dx');
  });

  it('preserves valid JSON escape sequences like \\", \\\\, and \\n in prose', () => {
    const raw = '{"text": "Line 1\\nLine 2", "quote": "He said \\"hello\\""}';
    const repaired = repairJsonLatex(raw);
    const parsed = JSON.parse(repaired) as { text: string; quote: string };
    assert.equal(parsed.text, 'Line 1\nLine 2');
    assert.equal(parsed.quote, 'He said "hello"');
  });
});
