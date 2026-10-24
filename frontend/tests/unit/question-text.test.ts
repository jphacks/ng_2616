import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positionedPdfLines, questionPageFromText } from '../../src/core/resources/question-text';

test('preserves raised exponents, keeps Greek chi and splits two columns into ten questions', () => {
  const lines = ['数学3', '次の方程式を解きなさい。', '(１) ３χ²－１５＝０  (２) (χ＋７)²－１８＝０', '(３) χ²＋１０χ＋２４＝０  (４) χ²－１２χ＋３５＝０', '(５) χ²－χ－７２＝０  (６) χ²＋１９χ＝０', '(７) χ²－１８χ＋８１＝０  (８) ３χ²＋９χ＋２＝０', '(９) χ²－３χ＋１＝０  (10) χ²－６χ＋２＝０'];
  const result = questionPageFromText(lines, 1, 'ja');
  assert.equal(result.questions.length, 10);
  assert.deepEqual(result.questions.map((q) => q.label), ['1','2','3','4','5','6','7','8','9','10']);
  assert.deepEqual(result.questions[0]!.unknowns, ['chi']);
  assert.ok(result.questions.every((q) => !q.premises.length));
  const math = result.lines.flatMap((l) => l.segments).filter((s) => s.type === 'math');
  assert.equal(math.length, 10);
  assert.ok(JSON.stringify(math[0]!.expr).includes('Power'));
});
test('positioned extraction retains exponent geometry and left-to-right question order', () => {
  const item = (str: string, x: number, y: number, h: number, width: number) => ({ str, width, height: h, transform: [h,0,0,h,x,y] });
  const lines = positionedPdfLines([item('(1) 3χ', 10, 100, 14, 35), item('2', 45, 106, 9, 5), item('−15=0', 52, 100, 14, 55), item('(2) (χ+7)', 250, 100, 14, 65), item('2', 315, 106, 9, 5), item('−18=0', 321, 100, 14, 55)]);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes('^{2}'));
  assert.equal(questionPageFromText(lines, 1, 'ja').questions.length, 2);
});
test('does not treat ordinary parentheses in an equation as new question numbers', () => {
  assert.equal(questionPageFromText(['(1) x = (2) + 3'], 1, 'en').questions.length, 1);
  const page = questionPageFromText(['(1) (x+7)^2-18=0'], 1, 'en');
  assert.equal(page.questions.length, 1);
});
