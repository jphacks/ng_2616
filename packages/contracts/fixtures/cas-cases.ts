/**
 * CAS oracle cases (spec §16.5) plus the Schrödinger demo chain. Expectations are written by
 * hand from the mathematics, not copied from implementation output.
 */
import type { Role, Status } from '../src/schemas';
import { SCHRODINGER_GIVEN, SCHRODINGER_SCRIPT, TDSE_LATEX } from './demo';

export interface FixtureLine {
  id: string;
  src: string;
  /** LaTeX kept as an Unparsed node instead of parsing `src` */
  unparsed?: string;
  role?: Role;
  status: Status;
  reason?: string;
  method?: string;
  unverified_ancestors?: string[];
}

export interface CasCase {
  id: string;
  note: string;
  /** LaTeX of the lines that open the page marked as given: conditions, assumptions, function declarations */
  given?: string[];
  /** LaTeX of definition lines after the given lines */
  definitions?: string[];
  lines: FixtureLine[];
  target: { id: string; src?: string; text?: string; unparsed?: string; role?: Role };
  parent?: string;
  expect: {
    status: Status;
    reason?: string;
    category?: string;
    method?: string;
    unverified_ancestors?: string[];
    missing?: string[];
    extra?: string[];
  };
}

const T = (src: string, role?: Role) => ({ id: 'T', src, role });
const first = (src: string, status: Status = 'none', reason = 'NO_PARENT'): FixtureLine[] => [{ id: 'L1', src, status, reason }];

export const CAS_CASES: CasCase[] = [
  { id: 'CF-01', note: 'expansion ok', lines: first('$(x-2)(x-3)$'), target: T('$= x^2 - 5x + 6$'), expect: { status: 'ok', method: 'sym' } },
  {
    id: 'CF-02', note: 'constant term error', lines: first('$(x-2)(x-3)$'), target: T('$= x^2 - 5x + 5$'),
    expect: { status: 'wrong', category: 'CONSTANT_TERM' },
  },
  {
    id: 'CF-03', note: 'missing solution', lines: first('$x^2 = 4$'), target: T('$x = 2$'),
    expect: { status: 'wrong', category: 'MISSING_SOLUTION', missing: ['-2'] },
  },
  {
    id: 'CF-04', note: 'extra solution', lines: first('$x = 2$'), target: T('$x^2 = 4$'),
    expect: { status: 'wrong', category: 'EXTRA_SOLUTION', extra: ['-2'] },
  },
  {
    id: 'CF-05', note: 'domain change', lines: first('$\\frac{x^2-1}{x-1}$'), target: T('$= x + 1$'),
    expect: { status: 'unknown', reason: 'DOMAIN_CHANGED' },
  },
  {
    id: 'CF-06', note: 'tiny exact difference', lines: first('$x + 1$'), target: T('$= x + 1 + \\frac{1}{10^{12}}$'),
    expect: { status: 'wrong', category: 'CONSTANT_TERM' },
  },
  { id: 'CF-07', note: 'agreement at 0 and 1 only', lines: first('$x^2$'), target: T('$= x$'), expect: { status: 'wrong' } },
  {
    id: 'CF-08', note: 'two empty real solution sets', lines: first('$x^2 + 1 = 0$'), target: T('$x^2 + 4 = 0$'),
    expect: { status: 'ok', method: 'sets' },
  },
  {
    id: 'CF-09', note: 'derivative coefficient', given: ['f(x)'], definitions: ['f(x) = x^3'], lines: [],
    target: T("$f'(x) = 2x^2$"), expect: { status: 'wrong', category: 'COEFFICIENT' },
  },
  {
    id: 'CF-10a', note: 'missing integration term', given: ['a > 0', 'I(a)'], definitions: ['I(a) = \\int_0^a (3x^2 + 2x) \\, dx'],
    lines: [{ id: 'L1', src: '$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$', status: 'none', reason: 'DEFINITION' }],
    target: T('$= \\left[x^3\\right]_0^a$'), expect: { status: 'wrong', category: 'INTEGRATION_TERM' },
  },
  {
    id: 'CF-10b', note: 'correct primitive', given: ['a > 0', 'I(a)'], definitions: ['I(a) = \\int_0^a (3x^2 + 2x) \\, dx'],
    lines: [{ id: 'L1', src: '$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$', status: 'none', reason: 'DEFINITION' }],
    target: T('$= \\left[x^3 + x^2\\right]_0^a$'), expect: { status: 'ok' },
  },
  {
    id: 'CF-10c', note: 'transcribing a definition line again is a definition',
    given: ['I(a)'], definitions: ['I(a) = \\int_0^a (3x^2 + 2x) \\, dx'], lines: [],
    target: T('$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$'), expect: { status: 'none', reason: 'DEFINITION' },
  },
  { id: 'CF-11a', note: 'unreadable', lines: first('$x + 1$'), target: T('$= \\square + 1$'), expect: { status: 'unknown', reason: 'UNREADABLE' } },
  {
    id: 'CF-11d', note: 'notation outside the parser grammar is not checkable', lines: first('$x + 1$'),
    target: { id: 'T', unparsed: '\\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}' }, expect: { status: 'unknown', reason: 'UNPARSED' },
  },
  {
    id: 'CF-11e', note: 'a step after a not-checkable line cannot be justified by it',
    lines: [{ id: 'L1', src: '', unparsed: 'x \\overset{!}{=} 2', status: 'unknown', reason: 'UNPARSED' }],
    target: T('$x + 1 = 3$'), expect: { status: 'unknown', reason: 'PARENT_UNPARSED' },
  },
  {
    id: 'CF-11f', note: 'an expression after a not-checkable line',
    lines: [{ id: 'L1', src: '', unparsed: '\\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}', status: 'unknown', reason: 'UNPARSED' }],
    target: T('$x + 1$'), expect: { status: 'unknown', reason: 'PARENT_UNPARSED' },
  },
  {
    id: 'CF-11b', note: 'empty RHS', given: ['I(a)'], lines: [], target: T('$I(a) =$'),
    expect: { status: 'unknown', reason: 'INCOMPLETE' },
  },
  {
    id: 'CF-11c', note: 'infinite sum unsupported', lines: first('$x$'), target: T('$= \\sum_{n=1}^{\\infty} \\frac{1}{n^2}$'),
    expect: { status: 'unknown', reason: 'UNSUPPORTED' },
  },
  {
    id: 'CF-12a', note: 'local ok from an unknown parent', lines: [{ id: 'L1', src: '$x^2 = 4$', status: 'unknown', reason: 'NO_EVIDENCE' }],
    target: T('$x = \\pm 2$'), expect: { status: 'ok', unverified_ancestors: ['L1'] },
  },
  {
    id: 'CF-12b', note: 'wrong from an unknown parent keeps the annotation',
    lines: [{ id: 'L1', src: '$x^2 = 4$', status: 'unknown', reason: 'NO_EVIDENCE' }], target: T('$x = 2$'),
    expect: { status: 'wrong', unverified_ancestors: ['L1'] },
  },
  { id: 'CF-13', note: 'exact fractions', lines: first('$\\frac{x+1}{2} + \\frac{x-1}{2}$'), target: T('$= x$'), expect: { status: 'ok' } },
  {
    id: 'CF-14a', note: 'sqrt with x >= 0', given: ['x \\ge 0'],
    lines: first('$\\sqrt{x^2}$'), target: T('$= x$'), expect: { status: 'ok' },
  },
  { id: 'CF-14b', note: 'sqrt over the reals', lines: first('$\\sqrt{x^2}$'), target: T('$= x$'), expect: { status: 'wrong' } },
  { id: 'CF-15', note: 'Pythagorean identity', lines: first('$\\sin^2 x + \\cos^2 x$'), target: T('$= 1$'), expect: { status: 'ok' } },
  {
    id: 'CF-16', note: 'linear system', lines: first('$x + y = 3, x - y = 1$'), target: T('$x = 2, y = 1$'),
    expect: { status: 'ok' },
  },
  {
    id: 'CF-17a', note: 'function value ok', given: ['f(x)'], definitions: ['f(x) = x^2 + 1'], lines: [], target: T('$f(2) = 5$'),
    expect: { status: 'ok' },
  },
  {
    id: 'CF-17b', note: 'function value wrong', given: ['f(x)'], definitions: ['f(x) = x^2 + 1'], lines: [], target: T('$f(2) = 4$'),
    expect: { status: 'wrong' },
  },
  { id: 'CF-18', note: 'inequality solution sets', lines: first('$2x + 2 < 6$'), target: T('$x < 2$'), expect: { status: 'ok', method: 'sets' } },
  { id: 'CF-19a', note: 'prose only', lines: [], target: { id: 'T', text: 'Now differentiate both sides.' }, expect: { status: 'none', reason: 'TEXT_ONLY' } },
  { id: 'CF-19b', note: 'explicit definition', lines: [], target: T('$g(x) = x + 1$', 'definition'), expect: { status: 'none', reason: 'DEFINITION' } },
  { id: 'CF-19c', note: 'first expression', lines: [], target: T('$x^2 + 1$'), expect: { status: 'none', reason: 'NO_PARENT' } },
  {
    id: 'CF-20a', note: 'binding from a local step', given: ['f(x)'], definitions: ['f(x) = ux'],
    lines: [
      { id: 'L1', src: '$u + 1 = 3$', status: 'unknown', reason: 'NO_EVIDENCE' },
      { id: 'L2', src: '$u = 2$', status: 'ok', method: 'sets', unverified_ancestors: ['L1'] },
    ],
    target: T('$f(x) = 2x$'), expect: { status: 'ok', unverified_ancestors: ['L1'] },
  },
  {
    id: 'CF-20b', note: 'binding from a local step, wrong', given: ['f(x)'], definitions: ['f(x) = ux'],
    lines: [
      { id: 'L1', src: '$u + 1 = 3$', status: 'unknown', reason: 'NO_EVIDENCE' },
      { id: 'L2', src: '$u = 2$', status: 'ok', method: 'sets', unverified_ancestors: ['L1'] },
    ],
    target: T('$f(x) = x$'), expect: { status: 'wrong', unverified_ancestors: ['L1'] },
  },
  {
    id: 'CF-21', note: 'agreement at interval endpoints only',
    given: ['0 \\le x \\le 1'],
    lines: first('$\\sin(\\pi x)$'), target: T('$= 0$'), expect: { status: 'wrong' },
  },
  { id: 'CF-22', note: 'skip undefined sample points', lines: first('$\\frac{x+1}{x}$'), target: T('$= \\frac{1}{x}$'), expect: { status: 'wrong' } },
  { id: 'CE-01', note: 'constant evaluation ok', lines: [], target: T('$1 + 1 = 2$'), expect: { status: 'ok', method: 'eval' } },
  { id: 'CE-02', note: 'constant evaluation wrong', lines: [], target: T('$1 + 1 = 3$'), expect: { status: 'wrong', category: 'UNCLASSIFIED' } },
  {
    id: 'CE-03', note: 'completed RHS of an incomplete first line',
    lines: [], target: T('$\\frac{1}{2} + \\frac{1}{3} = \\frac{5}{6}$'), expect: { status: 'ok', method: 'eval' },
  },
  { id: 'CE-04', note: 'incomplete line', lines: [], target: T('$1 + 1 =$'), expect: { status: 'unknown', reason: 'INCOMPLETE' } },
  {
    id: 'PH-01', note: 'sign error in the TDSE with V = 0',
    given: SCHRODINGER_GIVEN,
    lines: [{ id: 'u1', src: '$V(x) = 0$', status: 'none', reason: 'DEFINITION' }],
    target: T('$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = \\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}$'),
    expect: { status: 'wrong', category: 'SIGN' },
  },
  // v2.2: assumptions and function declarations are lines, recognised by shape without a marker
  { id: 'DC-01', note: 'a positivity line is an assumption', lines: [], target: T('$m > 0$'), expect: { status: 'none', reason: 'ASSUMPTION' } },
  { id: 'DC-02', note: 'a number set line is an assumption', lines: [], target: T('$n \\in \\mathbb{Z}^{+}$'), expect: { status: 'none', reason: 'ASSUMPTION' } },
  { id: 'DC-03', note: 'a nonzero function line is an assumption', lines: [], target: T('$\\psi(x) \\neq 0$'), expect: { status: 'none', reason: 'ASSUMPTION' } },
  { id: 'DC-04', note: 'a lone application declares a function', lines: [], target: T('$V(x)$'), expect: { status: 'none', reason: 'FUNCTION' } },
  { id: 'DC-05', note: 'an assumption marked as given is still an assumption', given: ['L > 0'], lines: [], target: T('$L > 0$', 'premise'), expect: { status: 'none', reason: 'ASSUMPTION' } },
  {
    id: 'DC-06', note: 'an unmarked assumption line counts',
    lines: [{ id: 'A', src: '$x \\ge 0$', status: 'none', reason: 'ASSUMPTION' }, { id: 'L1', src: '$\\sqrt{x^2}$', status: 'none', reason: 'NO_PARENT' }],
    target: T('$= x$'), expect: { status: 'ok' },
  },
  {
    id: 'DC-07', note: 'an unmarked interval line counts',
    lines: [{ id: 'A', src: '$0 \\le x \\le 1$', status: 'none', reason: 'ASSUMPTION' }, { id: 'L1', src: '$\\sin(\\pi x)$', status: 'none', reason: 'NO_PARENT' }],
    target: T('$= 0$'), expect: { status: 'wrong' },
  },
  {
    id: 'DC-08', note: 'the Schrödinger givens written as plain lines, functions declared below the TDSE',
    lines: [
      ...SCHRODINGER_GIVEN.map((latex, i): FixtureLine => ({ id: `S${i + 1}`, src: `$${latex}$`, status: 'none', reason: i === 0 ? 'NO_PARENT' : 'ASSUMPTION' })),
      { id: 'u1', src: '$V(x) = 0$', status: 'none', reason: 'DEFINITION' },
    ],
    target: T('$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}$'),
    expect: { status: 'ok' },
  },
  {
    id: 'DC-10', note: 'the compact Schrödinger template: functions on one line, conditions on the next',
    lines: [
      { id: 'S1', src: `$${TDSE_LATEX}$`, role: 'premise', status: 'none', reason: 'PREMISE' },
      { id: 'S2', src: 'Given $\\Psi(x,t)$ $\\psi(x)$ $\\phi(t)$ $V(x)$', role: 'premise', status: 'none', reason: 'FUNCTION' },
      { id: 'S3', src: 'where $m > 0, L > 0, n \\in \\mathbb{Z}^{+}, \\psi(x) \\neq 0, \\phi(t) \\neq 0$', role: 'premise', status: 'none', reason: 'ASSUMPTION' },
      { id: 'u1', src: '$V(x) = 0$', status: 'none', reason: 'DEFINITION' },
    ],
    target: T('$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = \\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}$'),
    expect: { status: 'wrong', category: 'SIGN' },
  },
  { id: 'DC-11', note: 'a line of function declarations', lines: [], target: T('Given $\\Psi(x,t)$ $\\psi(x)$ $\\phi(t)$'), expect: { status: 'none', reason: 'FUNCTION' } },
  { id: 'DC-12', note: 'a line of assumptions', lines: [], target: T('where $m > 0, L > 0, n \\in \\mathbb{Z}^{+}$'), expect: { status: 'none', reason: 'ASSUMPTION' } },
  { id: 'DC-13', note: 'functions and assumptions on one line', lines: [], target: T('Given $I(a)$, where $a > 0$'), expect: { status: 'none', reason: 'DECLARATION' } },
  {
    id: 'DC-14', note: 'an assumption from a compact line applies',
    lines: [{ id: 'A', src: 'where $x \\ge 0, y > 0$', status: 'none', reason: 'ASSUMPTION' }, { id: 'L1', src: '$\\sqrt{x^2}$', status: 'none', reason: 'NO_PARENT' }],
    target: T('$= x$'), expect: { status: 'ok' },
  },
  {
    id: 'DC-09', note: 'the same with a sign error',
    lines: [
      ...SCHRODINGER_GIVEN.map((latex, i): FixtureLine => ({ id: `S${i + 1}`, src: `$${latex}$`, status: 'none', reason: i === 0 ? 'NO_PARENT' : 'ASSUMPTION' })),
      { id: 'u1', src: '$V(x) = 0$', status: 'none', reason: 'DEFINITION' },
    ],
    target: T('$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = \\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}$'),
    expect: { status: 'wrong', category: 'SIGN' },
  },
];

/** Every step of the demo, checked against the steps before it (rejected proposals excluded). */
export function demoCases(): CasCase[] {
  const out: CasCase[] = [];
  const accepted: FixtureLine[] = [];
  for (const step of SCHRODINGER_SCRIPT) {
    out.push({
      id: `DEMO-${step.id}`,
      note: step.src,
      given: SCHRODINGER_GIVEN,
      lines: accepted.map((l) => ({ ...l })),
      target: { id: step.id, src: step.src, role: step.role },
      parent: accepted[accepted.length - 1]?.id,
      expect: step.expect,
    });
    if (step.id === 'a10') {
      // regression: once φ(t) = e^{-iEt/ħ} is established, the sign-flipped version must stay wrong
      const wrong = SCHRODINGER_SCRIPT.find((s) => s.rejected)!;
      out.push({
        id: 'DEMO-a9x-after-a9',
        note: 'wrong step proposed again after its correction',
        given: SCHRODINGER_GIVEN,
        lines: accepted.map((l) => ({ ...l })),
        target: { id: 'a9x2', src: wrong.src, role: wrong.role },
        parent: accepted[accepted.length - 1]?.id,
        expect: { status: 'wrong' },
      });
    }
    if (!step.rejected) {
      accepted.push({
        id: step.id,
        src: step.src,
        role: step.role,
        status: step.expect.status,
        reason: step.expect.reason,
        method: step.expect.method,
        unverified_ancestors: step.expect.unverified_ancestors,
      });
    }
  }
  return out;
}
