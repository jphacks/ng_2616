/**
 * The Schrödinger demo (Stage 1): TDSE → TISE → particle in a box → general solution.
 * Used by the scripted demo provider, the preset problem card and the CAS fixtures.
 */
import type { Assumption, FunctionDecl, Role, Status } from '../src/schemas';

export const SCHRODINGER_FUNCTIONS: FunctionDecl[] = [
  { name: 'Psi', args: ['x', 't'] },
  { name: 'psi', args: ['x'] },
  { name: 'phi', args: ['t'] },
  { name: 'V', args: ['x'] },
];

/** Assumptions written as LaTeX for `expr`; emitters parse them into IR. */
export const SCHRODINGER_ASSUMPTIONS: (Omit<Assumption, 'expr'> & { expr_latex?: string })[] = [
  { symbol: 'm', kind: 'positive', source: 'user' },
  { symbol: 'L', kind: 'positive', source: 'user' },
  { symbol: 'n', kind: 'positive_integer', source: 'user' },
  { symbol: 'psi', kind: 'nonzero', expr_latex: '\\psi(x)', source: 'user' },
  { symbol: 'phi', kind: 'nonzero', expr_latex: '\\phi(t)', source: 'user' },
];

export const TDSE_LATEX = 'i\\hbar \\frac{\\partial \\Psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2} + V(x)\\Psi';

export interface DemoStep {
  id: string;
  who: 'user' | 'ai';
  /** "$…$" marks math; anything else is prose */
  src: string;
  role: Role;
  /** a deliberately wrong AI proposal that the checker must reject */
  rejected?: boolean;
  expect: { status: Status; reason?: string; method?: string; category?: string; unverified_ancestors?: string[] };
}

export const SCHRODINGER_SCRIPT: DemoStep[] = [
  { id: 'u1', who: 'user', role: 'step', src: '$V(x) = 0$', expect: { status: 'none', reason: 'DEFINITION' } },
  {
    id: 'u2', who: 'user', role: 'step',
    src: '$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}$',
    expect: { status: 'ok' },
  },
  { id: 'a3', who: 'ai', role: 'definition', src: '$\\Psi(x,t) = \\psi(x)\\phi(t)$', expect: { status: 'none', reason: 'DEFINITION' } },
  {
    id: 'a4', who: 'ai', role: 'step',
    src: '$i\\hbar \\psi \\frac{d\\phi}{dt} = -\\frac{\\hbar^2}{2m} \\phi \\frac{d^2\\psi}{dx^2}$',
    expect: { status: 'ok', method: 'sym' },
  },
  {
    id: 'a5', who: 'ai', role: 'step',
    src: '$\\frac{i\\hbar}{\\phi}\\frac{d\\phi}{dt} = -\\frac{\\hbar^2}{2m}\\frac{1}{\\psi}\\frac{d^2\\psi}{dx^2}$',
    expect: { status: 'ok', method: 'scale' },
  },
  {
    id: 'a6', who: 'ai', role: 'step',
    src: '$\\frac{i\\hbar}{\\phi}\\frac{d\\phi}{dt} = E$, $-\\frac{\\hbar^2}{2m}\\frac{1}{\\psi}\\frac{d^2\\psi}{dx^2} = E$',
    expect: { status: 'ok', method: 'sep' },
  },
  { id: 'a7', who: 'ai', role: 'step', src: '$-\\frac{\\hbar^2}{2m}\\frac{d^2\\psi}{dx^2} = E\\psi$', expect: { status: 'ok', method: 'scale' } },
  { id: 'a8', who: 'ai', role: 'step', src: '$\\frac{d\\phi}{dt} = -\\frac{iE}{\\hbar}\\phi$', expect: { status: 'ok', method: 'scale' } },
  {
    id: 'a9x', who: 'ai', role: 'step', rejected: true, src: '$\\phi(t) = e^{iEt/\\hbar}$',
    expect: { status: 'wrong', category: 'SIGN' },
  },
  { id: 'a9', who: 'ai', role: 'step', src: '$\\phi(t) = e^{-iEt/\\hbar}$', expect: { status: 'ok', method: 'sub' } },
  { id: 'a10', who: 'ai', role: 'premise', src: '$\\psi(0) = 0, \\psi(L) = 0$', expect: { status: 'none', reason: 'PREMISE' } },
  { id: 'a11', who: 'ai', role: 'step', src: '$k = \\frac{\\sqrt{2mE}}{\\hbar}$', expect: { status: 'none', reason: 'DEFINITION' } },
  { id: 'a12', who: 'ai', role: 'step', src: '$\\psi(x) = A\\sin(kx) + B\\cos(kx)$', expect: { status: 'ok', method: 'sub' } },
  { id: 'a13', who: 'ai', role: 'step', src: '$B = 0$', expect: { status: 'ok', method: 'sets' } },
  { id: 'a14', who: 'ai', role: 'step', src: '$k = \\frac{n\\pi}{L}$', expect: { status: 'unknown', reason: 'SUBSET_OF_SOLUTIONS' } },
  {
    id: 'a15', who: 'ai', role: 'step', src: '$E_n = \\frac{n^2\\pi^2\\hbar^2}{2mL^2}$',
    expect: { status: 'ok', method: 'sets', unverified_ancestors: ['a14'] },
  },
  {
    id: 'a16', who: 'ai', role: 'step',
    src: '$\\Psi(x,t) = \\sum_{n=1}^{\\infty} c_n \\sin\\left(\\frac{n\\pi x}{L}\\right) e^{-iE_n t/\\hbar}$',
    expect: { status: 'unknown', reason: 'UNSUPPORTED' },
  },
];
