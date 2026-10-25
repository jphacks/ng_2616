import katex from 'katex';

/**
 * Recognised LaTeX the IR parser cannot read (an Unparsed node: \min, \forall, \Rightarrow, …) is
 * shown on screen through KaTeX, but the TeX report used to print it as escaped text. This lets it
 * typeset as math only when every token is plain notation: commands come from a fixed list, so
 * nothing can read files, define macros or change catcodes, and the result is rebuilt from the
 * tokens rather than passed through. Anything else stays text, as before.
 */

const GREEK = 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega';
const SYMBOLS =
  'le leq ge geq ne neq approx equiv sim simeq cong propto to rightarrow Rightarrow implies leftarrow Leftarrow impliedby iff Leftrightarrow leftrightarrow mapsto ' +
  'forall exists nexists in notin ni subset subseteq supset supseteq cup cap setminus emptyset varnothing land lor lnot neg wedge vee therefore because ' +
  'min max sup inf lim limsup liminf sum prod int iint oint partial nabla infty cdot times div pm mp circ ldots cdots dots vdots prime ' +
  'sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh log ln exp det dim gcd deg ker arg ' +
  'quad qquad langle rangle lvert rvert lVert rVert lfloor rfloor lceil rceil mid ' +
  'big Big bigg Bigg bigl bigr Bigl Bigr left right';
// commands that take one or two braced arguments
const WITH_ARGS = 'frac dfrac tfrac sqrt overline underline bar hat tilde vec dot ddot widehat widetilde mathbb mathrm mathbf mathcal mathit operatorname text';
const COMMANDS = new Set([...GREEK.split(' '), ...SYMBOLS.split(' '), ...WITH_ARGS.split(' ')]);
// KaTeX-only spellings mapped to LaTeX
const RENAMED: Record<string, string> = { lt: '<', gt: '>' };
// \, \; \: \! \{ \} \| and a control space
const ESCAPES = new Set([',', ';', ':', '!', '{', '}', '|', ' ']);
const DELIMITERS = new Set(['(', ')', '[', ']', '|', '.', '\\{', '\\}', '\\|', '\\langle', '\\rangle', '\\lvert', '\\rvert', '\\lVert', '\\rVert', '\\lfloor', '\\rfloor', '\\lceil', '\\rceil']);
// recognition sometimes writes these as characters
const UNICODE: Record<string, string> = {
  'ε': '\\varepsilon', 'δ': '\\delta', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu', 'π': '\\pi', 'σ': '\\sigma', 'φ': '\\varphi', 'ω': '\\omega',
  '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '→': '\\to', '⇒': '\\Rightarrow', '⟹': '\\implies', '⇔': '\\iff', '∀': '\\forall', '∃': '\\exists', '∈': '\\in', '∉': '\\notin',
  '·': '\\cdot', '×': '\\times', '−': '-', '∞': '\\infty', '∑': '\\sum', '∫': '\\int', '√': '\\sqrt', '∴': '\\therefore', '∧': '\\land', '∨': '\\lor', '¬': '\\lnot',
};
const PLAIN = /[A-Za-z0-9 +\-*/=<>()[\]|,.:;!'^_{}]/;
const MAX_LENGTH = 2000;
const MAX_DEPTH = 20;

/** The LaTeX rebuilt from allowed tokens, or null when the input must stay text. */
export function safeRawMath(raw: string): string | null {
  if (raw.length > MAX_LENGTH) return null;
  const tokens: string[] = [];
  let depth = 0;
  let open = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '\\') {
      const name = /^[A-Za-z]+/.exec(raw.slice(i + 1))?.[0];
      if (name) {
        i += name.length;
        if (RENAMED[name]) tokens.push(RENAMED[name]!);
        else if (COMMANDS.has(name)) tokens.push(`\\${name}`);
        else return null;
        continue;
      }
      const next = raw[i + 1];
      if (next === undefined || !ESCAPES.has(next)) return null;
      tokens.push(`\\${next}`);
      i++;
      continue;
    }
    // ^^ is TeX's character-code escape (^^5c is a backslash): never pass it on
    if (c === '^' && raw[i + 1] === '^') return null;
    if (c === '{' && ++depth > MAX_DEPTH) return null;
    if (c === '}' && --depth < 0) return null;
    if (UNICODE[c]) tokens.push(UNICODE[c]!, ' ');
    else if (PLAIN.test(c)) tokens.push(c);
    else if (/\s/.test(c)) tokens.push(' ');
    else return null;
  }
  if (depth !== 0) return null;
  // \left and \right pair up and are each followed by a delimiter
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== '\\left' && tokens[i] !== '\\right') continue;
    open += tokens[i] === '\\left' ? 1 : -1;
    if (open < 0) return null;
    let j = i + 1;
    while (tokens[j] === ' ') j++;
    if (!DELIMITERS.has(tokens[j] ?? '')) return null;
  }
  if (open !== 0) return null;
  const tex = tokens.join('').replace(/ {2,}/g, ' ').trim();
  if (!tex) return null;
  // \text{…} is text mode, where ^ _ { or a command would break the compile: words only
  for (const m of tex.matchAll(/\\text\s*(\{)?/g)) {
    if (!m[1] || !/^[A-Za-z0-9 ,.;:!'()-]*\}/.test(tex.slice(m.index + m[0].length))) return null;
  }
  // KaTeX's grammar matches LaTeX's for these commands: a formula it cannot parse would fail the
  // whole compile, so it stays text instead
  try {
    katex.renderToString(tex, { throwOnError: true, trust: false, strict: 'ignore' });
  } catch {
    return null;
  }
  return tex;
}
