import { SCHEMA_VERSION, declaredFunctions, segmentsFromSource, withTheorem, type Line, type Notebook, type Role, type UiLang } from '@mn/contracts';
import { TDSE_LATEX } from '@mn/contracts/fixtures';
import { uuid } from '@/core/ids';
import { givenHash } from '@/core/lean/route';
import { newDraftLine } from '@/core/notebook/model';

export type PresetId = 'blank' | 'schrodinger' | 'integral' | 'expansion' | 'solutions' | 'induction' | 'epsilon_delta' | 'sketch';

interface PresetText {
  title: string;
  statement: string;
}

const TEXT: Record<PresetId, Record<UiLang, PresetText>> = {
  blank: {
    en: { title: 'Untitled notebook', statement: '' },
    ja: { title: '無題のノート', statement: '' },
  },
  schrodinger: {
    en: {
      title: 'Schrödinger: TDSE → TISE',
      statement:
        'Starting from the time-dependent Schrödinger equation with $V(x) = 0$, derive the time-independent equation by separation of variables, solve it for a particle in a box of width $L$, and write the general solution $\\Psi(x,t)$.',
    },
    ja: {
      title: 'シュレディンガー方程式：TDSE → TISE',
      statement:
        '$V(x) = 0$ の時間依存シュレディンガー方程式から変数分離で時間に依存しない方程式を導き、幅 $L$ の箱の中の粒子について解き、一般解 $\\Psi(x,t)$ を書きなさい。',
    },
  },
  integral: {
    en: { title: 'Definite integral', statement: 'Evaluate $I(a) = \\int_0^a (3x^2 + 2x) \\, dx$ for $a > 0$.' },
    ja: { title: '定積分', statement: '$a > 0$ のとき $I(a) = \\int_0^a (3x^2 + 2x) \\, dx$ を求めなさい。' },
  },
  expansion: {
    en: { title: 'Expansion', statement: 'Expand $(x-2)(x-3)$.' },
    ja: { title: '展開', statement: '$(x-2)(x-3)$ を展開しなさい。' },
  },
  solutions: {
    en: { title: 'Solving an equation', statement: 'Solve $x^2 = 4$ over the real numbers.' },
    ja: { title: '方程式を解く', statement: '実数の範囲で $x^2 = 4$ を解きなさい。' },
  },
  // Proof templates (ADR 0008). The claim is prose on purpose: a formula on a given line is a fact
  // the CAS may use, and the statement to prove must not prove itself. Lean gets the exact theorem.
  induction: {
    en: {
      title: 'Sum of odd numbers',
      statement: 'Prove by induction that for every natural number $n$, 1 + 3 + 5 + ⋯ + (2n − 1) = n².',
    },
    ja: {
      title: '奇数の和',
      statement: '数学的帰納法により、すべての自然数 $n$ について 1 + 3 + 5 + ⋯ + (2n − 1) = n² が成り立つことを証明しなさい。',
    },
  },
  sketch: {
    en: { title: 'Sketch', statement: '' },
    ja: { title: 'スケッチ', statement: '' },
  },
  epsilon_delta: {
    en: {
      title: 'ε–δ: the limit of x² at 2',
      statement:
        'Prove from the ε–δ definition that x² → 4 as x → 2: for every ε > 0 there is a δ > 0 such that every real $x$ with |x − 2| < δ satisfies |x² − 4| < ε.',
    },
    ja: {
      title: 'ε–δ論法：x → 2 での x² の極限',
      statement:
        'ε–δ論法により、x → 2 のとき x² → 4 であることを証明しなさい。すなわち、任意の ε > 0 に対してある δ > 0 が存在し、|x − 2| < δ を満たすすべての実数 $x$ について |x² − 4| < ε となることを示しなさい。',
    },
  },
};

/** The theorem a proof template proves, as Lean states it (checked in lean-worker/tests/test_lean.py). */
export const PRESET_THEOREMS: Partial<Record<PresetId, string>> = {
  induction: '∀ n : ℕ, ∑ k ∈ Finset.range n, (2 * k + 1) = n ^ 2',
  epsilon_delta: '∀ ε : ℝ, ε > 0 → ∃ δ : ℝ, δ > 0 ∧ ∀ x : ℝ, |x - 2| < δ → |x ^ 2 - 4| < ε',
};

export const PRESET_IDS: PresetId[] = ['blank', 'schrodinger', 'integral', 'expansion', 'solutions', 'induction', 'epsilon_delta', 'sketch'];

export function presetText(id: PresetId, lang: UiLang): PresetText {
  return TEXT[id][lang];
}

interface OpeningLine {
  /** "$…$" marks math; a source without "$" is one formula */
  src: string;
  role: Extract<Role, 'premise' | 'definition'>;
}

const given = (src: string): OpeningLine => ({ src, role: 'premise' });

const SCHRODINGER_FUNCTIONS = '$\\Psi(x,t)$ $\\psi(x)$ $\\phi(t)$ $V(x)$';
const SCHRODINGER_CONDITIONS = '$m > 0, L > 0, n \\in \\mathbb{Z}^{+}, \\psi(x) \\neq 0, \\phi(t) \\neq 0$';

/**
 * The lines a template opens with after its statement: what the problem card used to show, kept
 * compact: each given equation and definition on its own line, the functions on one line and the
 * conditions on one more (or both on one). A student can write the same lines in an empty
 * notebook; assumptions, function declarations and definitions are recognised without the given
 * mark, which only equations such as the TDSE need.
 */
const OPENING: Record<PresetId, Record<UiLang, OpeningLine[]>> = {
  blank: { en: [], ja: [] },
  schrodinger: {
    en: [given(`$${TDSE_LATEX}$`), given(`Given ${SCHRODINGER_FUNCTIONS}`), given(`where ${SCHRODINGER_CONDITIONS}`)],
    ja: [given(`$${TDSE_LATEX}$`), given(`関数 ${SCHRODINGER_FUNCTIONS}`), given(`ただし ${SCHRODINGER_CONDITIONS}`)],
  },
  integral: {
    en: [{ src: '$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$', role: 'definition' }, given('Given $I(a)$ where $a > 0$')],
    ja: [{ src: '$I(a) = \\int_0^a (3x^2 + 2x) \\, dx$', role: 'definition' }, given('関数 $I(a)$ ただし $a > 0$')],
  },
  expansion: { en: [], ja: [] },
  solutions: { en: [], ja: [] },
  induction: { en: [], ja: [] },
  epsilon_delta: { en: [], ja: [] },
  sketch: { en: [], ja: [] },
};

function openingLines(id: PresetId, lang: UiLang): Line[] {
  const statement = TEXT[id][lang].statement;
  const sources: OpeningLine[] = [...(statement ? [given(statement)] : []), ...OPENING[id][lang]];
  // declarations hold for the whole page: read every line with the functions any of them declares
  const functions = declaredFunctions(sources.map((s) => ({ state: 'SETTLED', segments: segmentsFromSource(s.src) })));
  return sources.map((s) => ({ ...newDraftLine(), role: s.role, state: 'SETTLED', segments: segmentsFromSource(s.src, { functions }) }));
}

export function buildNotebook(id: PresetId, lang: UiLang): Notebook {
  const lines = [...openingLines(id, lang), newDraftLine()];
  const nb: Notebook = {
    schema_version: SCHEMA_VERSION,
    id: uuid(),
    title: TEXT[id][lang].title,
    mode: 'live',
    domain: 'Reals',
    lines,
    recoveries: [],
    extensions: id === 'schrodinger' ? { demo: { script: 'schrodinger-v1' } } : id === 'sketch' ? { kind: 'sketch', sketch: { strokes: [] } } : {},
  };
  const theorem = PRESET_THEOREMS[id];
  // tied to these given lines: marking another line as given formalizes the problem again
  return theorem ? withTheorem(nb, { statement: theorem, given_hash: givenHash(lines), source: 'template' }) : nb;
}

export function demoBinding(nb: Notebook): { script: string } | undefined {
  const demo = (nb.extensions as { demo?: { script?: string } } | undefined)?.demo;
  return demo?.script ? { script: demo.script } : undefined;
}

/** The preloaded problem sheet for the demo notebook (rendered as a text resource). */
export const SCHRODINGER_SHEET: Record<UiLang, { name: string; pages: string[] }> = {
  en: {
    name: 'Problem sheet 3 — Quantum mechanics.md',
    pages: [
      [
        '# Problem sheet 3: The Schrödinger equation',
        '',
        'The time-dependent Schrödinger equation (TDSE) for a particle of mass $m$ in a potential $V(x)$ is',
        '',
        '$$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2} + V(x)\\Psi$$',
        '',
        '**Q1.** Take $V(x) = 0$. Look for separable solutions $\\Psi(x,t) = \\psi(x)\\phi(t)$ and show that both sides of the equation must equal a constant $E$. Derive the time-independent Schrödinger equation (TISE) $-\\frac{\\hbar^2}{2m}\\frac{d^2\\psi}{dx^2} = E\\psi$ and solve the time equation for $\\phi(t)$.',
        '',
        '**Q2.** A particle is confined to a box $0 \\le x \\le L$ with infinitely high walls, so $\\psi(0) = 0$ and $\\psi(L) = 0$. Write $k = \\frac{\\sqrt{2mE}}{\\hbar}$. Find the allowed $k$ and the energy levels $E_n$, $n = 1, 2, 3, \\dots$',
        '',
        '**Q3.** Write the general solution $\\Psi(x,t)$ as a superposition of the stationary states with coefficients $c_n$.',
        '',
        '*Hint: assume $\\psi(x) \\neq 0$ and $\\phi(t) \\neq 0$ when dividing.*',
      ].join('\n'),
    ],
  },
  ja: {
    name: '演習問題3 — 量子力学.md',
    pages: [
      [
        '# 演習問題3：シュレディンガー方程式',
        '',
        '質量 $m$ の粒子がポテンシャル $V(x)$ の中にあるときの時間依存シュレディンガー方程式（TDSE）は',
        '',
        '$$i\\hbar \\frac{\\partial \\Psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2} + V(x)\\Psi$$',
        '',
        '**問1.** $V(x) = 0$ とする。変数分離解 $\\Psi(x,t) = \\psi(x)\\phi(t)$ を仮定し、両辺が定数 $E$ に等しくなることを示せ。時間に依存しないシュレディンガー方程式（TISE）$-\\frac{\\hbar^2}{2m}\\frac{d^2\\psi}{dx^2} = E\\psi$ を導き、時間部分 $\\phi(t)$ を解け。',
        '',
        '**問2.** 粒子が無限に高い壁をもつ箱 $0 \\le x \\le L$ に閉じ込められているとき、$\\psi(0) = 0$、$\\psi(L) = 0$ である。$k = \\frac{\\sqrt{2mE}}{\\hbar}$ として、許される $k$ とエネルギー準位 $E_n$（$n = 1, 2, 3, \\dots$）を求めよ。',
        '',
        '**問3.** 係数 $c_n$ を用いて、定常状態の重ね合わせとして一般解 $\\Psi(x,t)$ を書け。',
        '',
        '*ヒント：割り算をするときは $\\psi(x) \\neq 0$、$\\phi(t) \\neq 0$ と仮定してよい。*',
      ].join('\n'),
    ],
  },
};
