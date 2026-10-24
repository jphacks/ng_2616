/**
 * CAS oracle cases (spec §16.5) plus the Schrödinger demo chain. Expectations are written by
 * hand from the mathematics, not copied from implementation output.
 */
import type { Assumption, FunctionDecl, Role, Status } from '../src/schemas';
import { SCHRODINGER_ASSUMPTIONS, SCHRODINGER_FUNCTIONS, SCHRODINGER_SCRIPT, TDSE_LATEX } from './demo';

export interface FixtureProblem {
  definitions?: string[];
  conditions?: string[];
  assumptions?: (Omit<Assumption, 'expr' | 'lower' | 'upper'> & { expr_latex?: string; lower_latex?: string; upper_latex?: string })[];
  functions?: FunctionDecl[];
  unknowns?: string[];
  independent_var?: string;
}

export interface FixtureLine {
  id: string;
  src: string;
  role?: Role;
  status: Status;
  reason?: string;
  method?: string;
  unverified_ancestors?: string[];
}

export interface CasCase {
  id: string;
  note: string;
  problem: FixtureProblem;
  lines: FixtureLine[];
  target: { id: string; src?: string; text?: string; role?: Role };
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

const F_X: FunctionDecl[] = [{ name: 'f', args: ['x'] }];

export const CAS_CASES: CasCase[] = [
  { id: 'CF-01', note: 'expansion ok', problem: {}, lines: first('$(x-2)(x-3)$'), target: T('$= x^2 - 5x + 6$'), expect: { status: 'ok', method: 'sym' } },
  {
    id: 'CF-02', note: 'constant term error', problem: {}, lines: first('$(x-2)(x-3)$'), target: T('$= x^2 - 5x + 5$'),
    expect: { status: 'wrong', category: 'CONSTANT_TERM' },
  },
  {
    id: 'CF-03', note: 'missing solution', problem: {}, lines: first('$x^2 = 4$'), target: T('$x = 2$'),
    expect: { status: 'wrong', category: 'MISSING_SOLUTION', missing: ['-2'] },
  },
  {
    id: 'CF-04', note: 'extra solution', problem: {}, lines: first('$x = 2$'), target: T('$x^2 = 4$'),
    expect: { status: 'wrong', category: 'EXTRA_SOLUTION', extra: ['-2'] },
  },
  {
    id: 'CF-05', note: 'domain change', problem: {}, lines: first('$\\frac{x^2-1}{x-1}$'), target: T('$= x + 1$'),
    expect: { status: 'unknown', reason: 'DOMAIN_CHANGED' },
  },
  {
    id: 'CF-06', note: 'tiny exact difference', problem: {}, lines: first('$x + 1$'), target: T('$= x + 1 + \\frac{1}{10^{12}}$'),
    expect: { status: 'wrong', category: 'CONSTANT_TERM' },
  },
  { id: 'CF-07', note: 'agreement at 0 and 1 only', problem: {}, lines: first('$x^2$'), target: T('$= x$'), expect: { status: 'wrong' } },
  {
    id: 'CF-08', note: 'two empty real solution sets', problem: {}, lines: first('$x^2 + 1 = 0$'), target: T('$x^2 + 4 = 0$'),
    expect: { status: 'ok', method: 'sets' },
  },
  {
    id: 'CF-09', note: 'derivative coefficient', problem: { definitions: ['f(x) = x^3'], functions: F_X }, lines: [],
    target: T("$f'(x) = 2x^2$"), expect: { status: 'wrong', category: 'COEFFICIENT' },
  },
  {
    id: 'CF-10a', note: 'missing integration term',
    problem: {
      definitions: ['I(a) = \\int_0^a (3x^2 + 2x) \\, dx'], functions: [{ name: 'I', args: ['a'] }],
      assumptions: [{ symbol: 'a', kind: 'positive', source: 'user' }],
    },
    lines: [{ id: 'L1', src: '$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$', status: 'none', reason: 'DEFINITION' }],
    target: T('$= \\left[x^3\\right]_0^a$'), expect: { status: 'wrong', category: 'INTEGRATION_TERM' },
  },
  {
    id: 'CF-10b', note: 'correct primitive',
    problem: {
      definitions: ['I(a) = \\int_0^a (3x^2 + 2x) \\, dx'], functions: [{ name: 'I', args: ['a'] }],
      assumptions: [{ symbol: 'a', kind: 'positive', source: 'user' }],
    },
    lines: [{ id: 'L1', src: '$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$', status: 'none', reason: 'DEFINITION' }],
    target: T('$= \\left[x^3 + x^2\\right]_0^a$'), expect: { status: 'ok' },
  },
  {
    id: 'CF-10c', note: 'transcribing the problem definition is a definition',
    problem: { definitions: ['I(a) = \\int_0^a (3x^2 + 2x) \\, dx'], functions: [{ name: 'I', args: ['a'] }] }, lines: [],
    target: T('$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$'), expect: { status: 'none', reason: 'DEFINITION' },
  },
  { id: 'CF-11a', note: 'unreadable', problem: {}, lines: first('$x + 1$'), target: T('$= \\square + 1$'), expect: { status: 'unknown', reason: 'UNREADABLE' } },
  {
    id: 'CF-11b', note: 'empty RHS', problem: { functions: [{ name: 'I', args: ['a'] }] }, lines: [], target: T('$I(a) =$'),
    expect: { status: 'unknown', reason: 'INCOMPLETE' },
  },
  {
    id: 'CF-11c', note: 'infinite sum unsupported', problem: {}, lines: first('$x$'), target: T('$= \\sum_{n=1}^{\\infty} \\frac{1}{n^2}$'),
    expect: { status: 'unknown', reason: 'UNSUPPORTED' },
  },
  {
    id: 'CF-12a', note: 'local ok from an unknown parent', problem: {}, lines: [{ id: 'L1', src: '$x^2 = 4$', status: 'unknown', reason: 'NO_EVIDENCE' }],
    target: T('$x = \\pm 2$'), expect: { status: 'ok', unverified_ancestors: ['L1'] },
  },
  {
    id: 'CF-12b', note: 'wrong from an unknown parent keeps the annotation', problem: {},
    lines: [{ id: 'L1', src: '$x^2 = 4$', status: 'unknown', reason: 'NO_EVIDENCE' }], target: T('$x = 2$'),
    expect: { status: 'wrong', unverified_ancestors: ['L1'] },
  },
  { id: 'CF-13', note: 'exact fractions', problem: {}, lines: first('$\\frac{x+1}{2} + \\frac{x-1}{2}$'), target: T('$= x$'), expect: { status: 'ok' } },
  {
    id: 'CF-14a', note: 'sqrt with x >= 0', problem: { assumptions: [{ symbol: 'x', kind: 'nonnegative', source: 'user' }] },
    lines: first('$\\sqrt{x^2}$'), target: T('$= x$'), expect: { status: 'ok' },
  },
  { id: 'CF-14b', note: 'sqrt over the reals', problem: {}, lines: first('$\\sqrt{x^2}$'), target: T('$= x$'), expect: { status: 'wrong' } },
  { id: 'CF-15', note: 'Pythagorean identity', problem: {}, lines: first('$\\sin^2 x + \\cos^2 x$'), target: T('$= 1$'), expect: { status: 'ok' } },
  {
    id: 'CF-16', note: 'linear system', problem: { unknowns: ['x', 'y'] }, lines: first('$x + y = 3, x - y = 1$'), target: T('$x = 2, y = 1$'),
    expect: { status: 'ok' },
  },
  {
    id: 'CF-17a', note: 'function value ok', problem: { definitions: ['f(x) = x^2 + 1'], functions: F_X }, lines: [], target: T('$f(2) = 5$'),
    expect: { status: 'ok' },
  },
  {
    id: 'CF-17b', note: 'function value wrong', problem: { definitions: ['f(x) = x^2 + 1'], functions: F_X }, lines: [], target: T('$f(2) = 4$'),
    expect: { status: 'wrong' },
  },
  { id: 'CF-18', note: 'inequality solution sets', problem: {}, lines: first('$2x + 2 < 6$'), target: T('$x < 2$'), expect: { status: 'ok', method: 'sets' } },
  { id: 'CF-19a', note: 'prose only', problem: {}, lines: [], target: { id: 'T', text: 'Now differentiate both sides.' }, expect: { status: 'none', reason: 'TEXT_ONLY' } },
  { id: 'CF-19b', note: 'explicit definition', problem: {}, lines: [], target: T('$g(x) = x + 1$', 'definition'), expect: { status: 'none', reason: 'DEFINITION' } },
  { id: 'CF-19c', note: 'first expression', problem: {}, lines: [], target: T('$x^2 + 1$'), expect: { status: 'none', reason: 'NO_PARENT' } },
  {
    id: 'CF-20a', note: 'binding from a local step', problem: { definitions: ['f(x) = ux'], functions: F_X },
    lines: [
      { id: 'L1', src: '$u + 1 = 3$', status: 'unknown', reason: 'NO_EVIDENCE' },
      { id: 'L2', src: '$u = 2$', status: 'ok', method: 'sets', unverified_ancestors: ['L1'] },
    ],
    target: T('$f(x) = 2x$'), expect: { status: 'ok', unverified_ancestors: ['L1'] },
  },
  {
    id: 'CF-20b', note: 'binding from a local step, wrong', problem: { definitions: ['f(x) = ux'], functions: F_X },
    lines: [
      { id: 'L1', src: '$u + 1 = 3$', status: 'unknown', reason: 'NO_EVIDENCE' },
      { id: 'L2', src: '$u = 2$', status: 'ok', method: 'sets', unverified_ancestors: ['L1'] },
    ],
    target: T('$f(x) = x$'), expect: { status: 'wrong', unverified_ancestors: ['L1'] },
  },
  {
    id: 'CF-21', note: 'agreement at interval endpoints only',
    problem: { assumptions: [{ symbol: 'x', kind: 'interval', lower_latex: '0', upper_latex: '1', source: 'user' }] },
    lines: first('$\\sin(\\pi x)$'), target: T('$= 0$'), expect: { status: 'wrong' },
  },
  { id: 'CF-22', note: 'skip undefined sample points', problem: {}, lines: first('$\\frac{x+1}{x}$'), target: T('$= \\frac{1}{x}$'), expect: { status: 'wrong' } },
  { id: 'CE-01', note: 'constant evaluation ok', problem: {}, lines: [], target: T('$1 + 1 = 2$'), expect: { status: 'ok', method: 'eval' } },
  { id: 'CE-02', note: 'constant evaluation wrong', problem: {}, lines: [], target: T('$1 + 1 = 3$'), expect: { status: 'wrong', category: 'UNCLASSIFIED' } },
  {
    id: 'CE-03', note: 'completed RHS of an incomplete first line', problem: {},
    lines: [], target: T('$\\frac{1}{2} + \\frac{1}{3} = \\frac{5}{6}$'), expect: { status: 'ok', method: 'eval' },
  },
  { id: 'CE-04', note: 'incomplete line', problem: {}, lines: [], target: T('$1 + 1 =$'), expect: { status: 'unknown', reason: 'INCOMPLETE' } },
  {
    id: 'PH-01', note: 'sign error in the TDSE with V = 0',
    problem: { conditions: [TDSE_LATEX], functions: SCHRODINGER_FUNCTIONS, assumptions: SCHRODINGER_ASSUMPTIONS },
    lines: [{ id: 'u1', src: '$V(x) = 0$', status: 'none', reason: 'DEFINITION' }],
    target: T('$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = \\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}$'),
    expect: { status: 'wrong', category: 'SIGN' },
  },
];

/** Every step of the demo, checked against the steps before it (rejected proposals excluded). */
export function demoCases(): CasCase[] {
  const problem: FixtureProblem = {
    conditions: [TDSE_LATEX],
    functions: SCHRODINGER_FUNCTIONS,
    assumptions: SCHRODINGER_ASSUMPTIONS,
  };
  const out: CasCase[] = [];
  const accepted: FixtureLine[] = [];
  for (const step of SCHRODINGER_SCRIPT) {
    out.push({
      id: `DEMO-${step.id}`,
      note: step.src,
      problem,
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
        problem,
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
