/** Symbol names, constants and Greek letters shared by the parser, printer and validator. */

export const CONSTANTS = ['Pi', 'ExponentialE', 'ImaginaryUnit', 'Hbar', 'Infinity'] as const;
export type Constant = (typeof CONSTANTS)[number];

export const GREEK_LOWER = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'varrho', 'sigma', 'tau', 'upsilon', 'phi',
  'varphi', 'chi', 'psi', 'omega',
] as const;

// \Pi is omitted on purpose: the name "Pi" is the constant π.
export const GREEK_UPPER = [
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
] as const;

export const GREEK = new Set<string>([...GREEK_LOWER, ...GREEK_UPPER]);

/** Unicode characters an LLM may emit, rewritten to LaTeX before tokenizing. */
export const UNICODE_TO_LATEX: Record<string, string> = {
  '−': '-', '–': '-', '—': '-', '×': '\\times ', '·': '\\cdot ', '⋅': '\\cdot ',
  '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '±': '\\pm ', 'π': '\\pi ', 'ħ': '\\hbar ',
  '∂': '\\partial ', '∞': '\\infty ', '∫': '\\int ', '∑': '\\sum ', '√': '\\sqrt ',
  '′': "'", '″': "''", '□': '\\square ', '∶': ':',
  '∈': '\\in ', 'ℤ': '\\mathbb{Z}', 'ℕ': '\\mathbb{N}', 'ℝ': '\\mathbb{R}', '⁺': '^{+}',
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'ε': '\\epsilon ',
  'ζ': '\\zeta ', 'η': '\\eta ', 'θ': '\\theta ', 'ι': '\\iota ', 'κ': '\\kappa ',
  'λ': '\\lambda ', 'μ': '\\mu ', 'ν': '\\nu ', 'ξ': '\\xi ', 'ρ': '\\rho ', 'σ': '\\sigma ',
  'τ': '\\tau ', 'υ': '\\upsilon ', 'φ': '\\phi ', 'ϕ': '\\phi ', 'χ': '\\chi ', 'ψ': '\\psi ',
  'ω': '\\omega ', 'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ',
  'Ξ': '\\Xi ', 'Σ': '\\Sigma ', 'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega ',
};

/** Number sets a symbol can be declared in, as in "n \in \mathbb{Z}^{+}" (the right side of Element). */
export const NUMBER_SETS = {
  PositiveIntegers: '\\mathbb{Z}^{+}',
  Integers: '\\mathbb{Z}',
  NaturalNumbers: '\\mathbb{N}',
  Reals: '\\mathbb{R}',
} as const;
export type NumberSet = keyof typeof NUMBER_SETS;

export function isNumberSet(s: unknown): s is NumberSet {
  return typeof s === 'string' && Object.hasOwn(NUMBER_SETS, s);
}

export const SYMBOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** "psi_n" -> "\psi_{n}", "E_n" -> "E_{n}", "x" -> "x". */
export function symbolToLatex(name: string): string {
  const cut = name.indexOf('_');
  const base = cut < 0 ? name : name.slice(0, cut);
  const sub = cut < 0 ? '' : name.slice(cut + 1);
  const baseTex = GREEK.has(base) ? `\\${base}` : base.length === 1 ? base : `\\mathrm{${base}}`;
  if (!sub) return baseTex;
  const subTex = GREEK.has(sub) ? `\\${sub}` : sub;
  return `${baseTex}_{${subTex}}`;
}

export function constantToLatex(c: Constant): string {
  switch (c) {
    case 'Pi': return '\\pi';
    case 'ExponentialE': return 'e';
    case 'ImaginaryUnit': return 'i';
    case 'Hbar': return '\\hbar';
    case 'Infinity': return '\\infty';
  }
}

export function isConstant(s: string): s is Constant {
  return (CONSTANTS as readonly string[]).includes(s);
}
