/**
 * Deterministic LaTeX → IR parser (ADR 0002).
 *
 * The recognizer (an LLM) transcribes handwriting as LaTeX; this parser turns it into the
 * unnormalized MathJSON IR. It never simplifies or repairs: term order, signs, grouping and
 * omissions survive exactly as written. Anything it cannot represent fails loudly, so the ink
 * is kept and the line shows a recognition failure instead of a guessed formula.
 */
import { isRelation, type MathJSON } from './ops';
import { GREEK, SYMBOL_NAME, UNICODE_TO_LATEX, isConstant, type NumberSet } from './symbols';
import { freeSymbols, validateExpr } from './validate';

export interface FunctionDecl {
  name: string;
  args: string[];
}

export interface ParseOptions {
  /** Declared functions: `ψ(x)` parses as application, a bare `ψ` as [Apply, psi]. */
  functions?: readonly FunctionDecl[];
  /** Names that must stay symbols even when they are "e" or "i". */
  symbols?: readonly string[];
  /** Variable for an Evaluate bracket whose variable is not written. */
  evaluateVar?: string;
}

export type Notation = 'plain' | 'continuation';

export type ParseErrorCode = 'PARSE_ERROR' | 'UNSUPPORTED_NOTATION' | 'EMPTY' | 'IR_INVALID';

export type ParseResult =
  | { ok: true; expr: MathJSON; notation: Notation }
  | { ok: false; error: { code: ParseErrorCode; message: string; at: number } };

/** Names that read as functions when directly followed by "(" even if undeclared. */
const DEFAULT_FUNCTION_NAMES = new Set(['f', 'g', 'h', 'F', 'G', 'H', 'y', 'u', 'psi', 'Psi', 'phi', 'Phi', 'varphi', 'chi']);

const FN_CMDS = new Set(['sin', 'cos', 'tan', 'ln', 'log', 'exp', 'arctan', 'arcsin', 'arccos', 'atan', 'asin', 'acos']);
const SKIP_CMDS = new Set([
  ',', ';', ':', '!', ' ', '>', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl',
  'biggr', 'Biggl', 'Biggr', 'displaystyle', 'textstyle', 'limits', 'nolimits', 'mathstrut',
  'notag', 'tag', 'label', 'nonumber',
]);
const REL_CMDS: Record<string, string> = {
  le: 'LessEqual', leq: 'LessEqual', leqslant: 'LessEqual', ge: 'GreaterEqual', geq: 'GreaterEqual',
  geqslant: 'GreaterEqual', ne: 'NotEqual', neq: 'NotEqual', lt: 'Less', gt: 'Greater', in: 'Element',
};
const NON_STARTERS = new Set([
  ...Object.keys(REL_CMDS), 'cdot', 'times', 'pm', 'mp', 'to', '}', 'lor', 'land', 'cdots', 'ldots', 'dots',
]);

type Tok =
  | { k: 'num'; v: string; at: number }
  | { k: 'letter'; v: string; at: number }
  | { k: 'cmd'; v: string; at: number }
  | { k: 'sym'; v: string; at: number };

class ParseError extends Error {
  code: ParseErrorCode;
  at: number;
  constructor(code: ParseErrorCode, message: string, at: number) {
    super(message);
    this.code = code;
    this.at = at;
  }
}

function normalize(src: string): string {
  // 1. Recover control characters corrupted by JSON decoding of single-backslash LaTeX
  let s = src
    // \x0c (form feed from JSON \f): \x0crac -> \frac, etc.
    .replace(/\x0crac/g, '\\frac')
    .replace(/\x0c([a-zA-Z])/g, '\\f$1')
    // \x08 (backspace from JSON \b): \x08eta -> \beta, etc.
    .replace(/\x08([a-zA-Z])/g, '\\b$1')
    // \x09 (tab from JSON \t): \x09int -> \int, \x09([a-zA-Z]) -> \t$1
    .replace(/\x09int/g, '\\int')
    .replace(/\x09([a-zA-Z])/g, '\\t$1')
    // \x0d (carriage return from JSON \r): \x0dight -> \right, \x0dho -> \rho
    .replace(/\x0d([a-zA-Z])/g, '\\r$1')
    // \x0a (newline from JSON \n): \x0a(notag|nu|nabla|neq) -> \$1
    .replace(/\x0a(notag|nu|nabla|neq)\b/g, '\\$1');

  // 2. Fix typos and stripped backslashes for structural commands
  s = s
    .replace(/\\tint\b/g, '\\int')
    .replace(/(?<![\\a-zA-Z])rac\{/g, '\\frac{')
    .replace(/(?<![\\a-zA-Z])int(?=[_^])/g, '\\int');

  // 3. Unicode substitutions
  let out = '';
  for (const ch of s) out += UNICODE_TO_LATEX[ch] ?? ch;
  return out;
}

function tokenize(src: string): Tok[] {
  const s = normalize(src);
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      let j = i + 1;
      if (j < s.length && /[A-Za-z]/.test(s[j]!)) {
        while (j < s.length && /[A-Za-z]/.test(s[j]!)) j++;
        const name = s.slice(i + 1, j);
        if (name === 'left' || name === 'right') {
          let k = j;
          while (s[k] === ' ') k++;
          if (s[k] === '.') {
            if (name === 'left') toks.push({ k: 'sym', v: 'NULLDELIM', at: i });
            i = k + 1;
            continue;
          }
          i = j;
          continue;
        }
        if (['mathrm', 'mathit', 'operatorname', 'text', 'textrm', 'mbox'].includes(name)) {
          let k = j;
          while (s[k] === ' ') k++;
          if (s[k] === '{') {
            const close = s.indexOf('}', k);
            if (close < 0) throw new ParseError('PARSE_ERROR', 'unclosed group', i);
            const raw = s.slice(k + 1, close).trim();
            if (raw === 'd' || raw === 'e' || raw === 'i') {
              toks.push({ k: 'letter', v: raw, at: i });
            } else if (name === 'operatorname' && FN_CMDS.has(raw)) {
              toks.push({ k: 'cmd', v: raw, at: i });
            } else {
              throw new ParseError('UNSUPPORTED_NOTATION', `text inside a formula: "${raw}"`, i);
            }
            i = close + 1;
            continue;
          }
        }
        i = j;
        if (SKIP_CMDS.has(name)) continue;
        if (name === 'quad' || name === 'qquad') { toks.push({ k: 'sym', v: ';', at: i }); continue; }
        if (name === 'lvert' || name === 'rvert' || name === 'vert' || name === 'mid') { toks.push({ k: 'sym', v: '|', at: i }); continue; }
        if (name === 'lbrace') { toks.push({ k: 'cmd', v: '{', at: i }); continue; }
        if (name === 'rbrace') { toks.push({ k: 'cmd', v: '}', at: i }); continue; }
        if (name === 'dfrac' || name === 'tfrac') { toks.push({ k: 'cmd', v: 'frac', at: i }); continue; }
        toks.push({ k: 'cmd', v: name, at: i });
        continue;
      }
      const ch = s[j] ?? '';
      const at = i;
      i = j + 1;
      if (SKIP_CMDS.has(ch)) continue;
      if (ch === '{' || ch === '}') { toks.push({ k: 'cmd', v: ch, at }); continue; }
      if (ch === '|') { toks.push({ k: 'sym', v: '|', at }); continue; }
      throw new ParseError('UNSUPPORTED_NOTATION', `unsupported command "\\${ch}"`, at);
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i;
      let dot = false;
      while (j < s.length && (/[0-9]/.test(s[j]!) || (s[j] === '.' && !dot && /[0-9]/.test(s[j + 1] ?? '')))) {
        if (s[j] === '.') dot = true;
        j++;
      }
      toks.push({ k: 'num', v: s.slice(i, j), at: i });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) { toks.push({ k: 'letter', v: c, at: i }); i++; continue; }
    if (c === '&' || c === '$') {
      throw new ParseError('UNSUPPORTED_NOTATION', `"${c}" is not allowed in a single formula`, i);
    }
    toks.push({ k: 'sym', v: c, at: i });
    i++;
  }
  return toks;
}

interface Resolved {
  functions: Map<string, string[]>;
  symbols: Set<string>;
  evaluateVar?: string;
}

class Parser {
  pos = 0;
  absDepth = 0;
  stopAtDiff = false;

  private toks: Tok[];
  private opts: Resolved;

  constructor(toks: Tok[], opts: Resolved) {
    this.toks = toks;
    this.opts = opts;
  }

  // ---- token helpers ----
  peek(o = 0): Tok | undefined { return this.toks[this.pos + o]; }
  next(): Tok {
    const t = this.toks[this.pos];
    if (!t) this.fail('unexpected end of formula');
    this.pos++;
    return t;
  }
  atEnd(): boolean { return this.pos >= this.toks.length; }
  isSym(v: string, o = 0): boolean { const t = this.peek(o); return t?.k === 'sym' && t.v === v; }
  isCmd(v: string, o = 0): boolean { const t = this.peek(o); return t?.k === 'cmd' && t.v === v; }
  expectSym(v: string): void { if (!this.isSym(v)) this.fail(`expected "${v}"`); this.pos++; }
  expectCmd(v: string): void { if (!this.isCmd(v)) this.fail(`expected "\\${v}"`); this.pos++; }
  fail(message: string, code: ParseErrorCode = 'PARSE_ERROR'): never {
    const t = this.peek() ?? this.toks[this.toks.length - 1];
    throw new ParseError(code, message, t?.at ?? 0);
  }
  fresh<T>(fn: () => T): T {
    const [s, a] = [this.stopAtDiff, this.absDepth];
    this.stopAtDiff = false;
    this.absDepth = 0;
    try { return fn(); } finally { this.stopAtDiff = s; this.absDepth = a; }
  }
  isSeparator(): boolean { return this.isSym(',') || this.isSym(';') || this.isCmd('lor'); }
  isClosing(): boolean {
    const t = this.peek();
    if (!t) return true;
    if (t.k === 'sym') return t.v === ')' || t.v === ']' || t.v === '}' || (t.v === '|' && this.absDepth > 0);
    return t.k === 'cmd' && t.v === '}';
  }

  // ---- grammar ----
  parseTop(): MathJSON {
    const decl = this.functionDeclaration();
    if (decl) return decl;
    const e = this.parseRelationList();
    if (!this.atEnd()) this.fail(`unexpected "${tokText(this.peek()!)}"`);
    return e;
  }

  /**
   * A formula that is only a name applied to distinct variables, such as "\Psi(x,t)" or "V(x)",
   * declares that function, whether or not the name is declared or reads as a function by default.
   * The same head before "=" ("I(a) = \int_0^a …") reads as the function throughout the formula.
   */
  functionDeclaration(): MathJSON | null {
    const head = this.functionHead();
    const end = this.pos;
    this.pos = 0;
    if (!head) return null;
    if (end === this.toks.length) {
      this.pos = end;
      return ['Apply', head.name, ...head.args];
    }
    const next = this.toks[end]!;
    if (next.k === 'sym' && next.v === '=' && !this.opts.functions.has(head.name)) this.opts.functions.set(head.name, head.args);
    return null;
  }

  /** Reads "name(var, …)" from the start; the caller rewinds. */
  functionHead(): FunctionDecl | null {
    const name = (): string | null => {
      const t = this.peek();
      if (!t || !(t.k === 'letter' || (t.k === 'cmd' && GREEK.has(t.v)))) return null;
      this.next();
      const sub = this.readNameSubscript();
      const n = sub ? `${t.v}_${sub}` : t.v;
      return SYMBOL_NAME.test(n) && n !== 'e' && n !== 'i' ? n : null;
    };
    try {
      const fn = name();
      if (fn === null || !this.isSym('(')) return null;
      this.next();
      const args: string[] = [];
      for (;;) {
        const a = name();
        if (a === null || args.includes(a) || a === fn) return null;
        args.push(a);
        if (this.isSym(',')) { this.next(); continue; }
        if (!this.isSym(')') || args.length > 4) return null;
        this.next();
        return { name: fn, args };
      }
    } catch (e) {
      if (e instanceof ParseError) return null;
      throw e;
    }
  }

  parseRelationList(): MathJSON {
    const items: MathJSON[] = [this.parseRelation()];
    let joiner: 'And' | 'Or' | null = null;
    while (this.isSeparator()) {
      const j = this.isCmd('lor') ? 'Or' : 'And';
      if (joiner && joiner !== j) this.fail('mixed "," and "or"', 'UNSUPPORTED_NOTATION');
      joiner = j;
      this.next();
      items.push(this.parseRelation());
    }
    if (items.length === 1) return items[0]!;
    if (!items.every(isRelation)) this.fail('a list must contain relations, e.g. "x = 1, y = 2"', 'UNSUPPORTED_NOTATION');
    if (items.length > 16) this.fail('too many relations');
    return [joiner!, ...items];
  }

  relOp(): string | null {
    const t = this.peek();
    if (!t) return null;
    if (t.k === 'sym') {
      if (t.v === '=') return 'Equal';
      if (t.v === '<') return this.isSym('=', 1) ? 'LessEqual' : 'Less';
      if (t.v === '>') return this.isSym('=', 1) ? 'GreaterEqual' : 'Greater';
      return null;
    }
    return t.k === 'cmd' ? REL_CMDS[t.v] ?? null : null;
  }

  parseRelation(): MathJSON {
    const parts: MathJSON[] = [this.parseAdditive()];
    const ops: string[] = [];
    for (;;) {
      const op = this.relOp();
      if (!op) break;
      const t = this.next();
      if (t.k === 'sym' && (t.v === '<' || t.v === '>') && this.isSym('=')) this.next();
      ops.push(op);
      if (this.atEnd() || this.isSeparator() || this.isClosing()) {
        if (op !== 'Equal') this.fail('missing right-hand side');
        parts.push(null);
        break;
      }
      parts.push(this.parseAdditive());
    }
    if (ops.length === 0) return parts[0]!;
    if (ops.length === 1) return [ops[0]!, parts[0]!, parts[1]!];
    if (parts.includes(null)) this.fail('empty right-hand side inside a chain', 'UNSUPPORTED_NOTATION');
    if (ops.every((o) => o === 'Equal')) return ['EqualChain', ...parts];
    return ['And', ...ops.map((o, i): MathJSON => [o, parts[i]!, parts[i + 1]!])];
  }

  parseAdditive(): MathJSON {
    type Term = { sign: '+' | '-' | 'pm'; e: MathJSON };
    const terms: Term[] = [];
    let sign: Term['sign'] = '+';
    if (this.isSym('+')) this.next();
    else if (this.isSym('-')) { this.next(); sign = '-'; }
    else if (this.isCmd('pm')) { this.next(); sign = 'pm'; }
    terms.push({ sign, e: this.parseTerm() });
    for (;;) {
      if (this.isSym('+')) { this.next(); terms.push({ sign: '+', e: this.parseTerm() }); }
      else if (this.isSym('-')) { this.next(); terms.push({ sign: '-', e: this.parseTerm() }); }
      else if (this.isCmd('pm')) { this.next(); terms.push({ sign: 'pm', e: this.parseTerm() }); }
      else if (this.isCmd('mp')) this.fail('"∓" is not supported', 'UNSUPPORTED_NOTATION');
      else break;
    }
    const [t0, t1] = terms as [Term, Term | undefined];
    if (terms.length === 1) return t0.sign === '+' ? t0.e : t0.sign === '-' ? ['Negate', t0.e] : ['PlusMinus', t0.e];
    if (terms.length === 2 && t0.sign === '+' && t1) {
      if (t1.sign === '-') return ['Subtract', t0.e, t1.e];
      if (t1.sign === 'pm') return ['PlusMinus', t0.e, t1.e];
    }
    if (terms.some((t) => t.sign === 'pm')) this.fail('"±" inside a longer sum', 'UNSUPPORTED_NOTATION');
    if (terms.length > 16) this.fail('more than 16 terms');
    return ['Add', ...terms.map((t): MathJSON => (t.sign === '-' ? ['Negate', t.e] : t.e))];
  }

  parseTerm(): MathJSON {
    let factors: MathJSON[] = [this.parseSignedFactor()];
    for (;;) {
      if (this.stopAtDiff && this.isDifferentialAhead()) break;
      if (this.isCmd('cdot') || this.isCmd('times') || this.isSym('*')) {
        this.next();
        factors.push(this.parseSignedFactor());
        continue;
      }
      if (this.isSym('/')) {
        this.next();
        const den = this.parseSignedFactor();
        const num: MathJSON = factors.length === 1 ? factors[0]! : ['Multiply', ...factors];
        factors = [['Divide', num, den]];
        continue;
      }
      if (this.canStartImplicit()) { factors.push(this.parsePostfix()); continue; }
      break;
    }
    if (factors.length > 16) this.fail('more than 16 factors');
    return factors.length === 1 ? factors[0]! : ['Multiply', ...factors];
  }

  parseSignedFactor(): MathJSON {
    if (this.isSym('-')) { this.next(); return ['Negate', this.parseSignedFactor()]; }
    if (this.isSym('+')) { this.next(); return this.parseSignedFactor(); }
    return this.parsePostfix();
  }

  canStartImplicit(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.k === 'num' || t.k === 'letter') return true;
    if (t.k === 'sym') return t.v === '(' || t.v === '[' || t.v === 'NULLDELIM' || t.v === '{' || t.v === '?' || (t.v === '|' && this.absDepth === 0);
    return !NON_STARTERS.has(t.v);
  }

  isDifferentialAhead(): boolean {
    const a = this.peek(0);
    const b = this.peek(1);
    if (!(a?.k === 'letter' && a.v === 'd')) return false;
    if (!(b && (b.k === 'letter' || (b.k === 'cmd' && GREEK.has(b.v))))) return false;
    const c = this.peek(2);
    if (!c) return true;
    if (c.k === 'sym') return [')', ']', '}', '+', '-', '=', '<', '>', ',', ';', '|'].includes(c.v);
    if (c.k === 'cmd') return c.v in REL_CMDS || c.v === '}' || c.v === 'pm' || c.v === 'lor';
    return false;
  }

  parsePostfix(): MathJSON {
    let base = this.parsePrimary();
    for (;;) {
      if (this.isSym('^')) {
        this.next();
        const ex = this.parseScript();
        base = base === 'ExponentialE' ? ['Exp', ex] : ['Power', base, ex];
        continue;
      }
      if (this.isSym("'")) this.fail('prime on an expression', 'UNSUPPORTED_NOTATION');
      if (this.isSym('!')) this.fail('factorials are not supported', 'UNSUPPORTED_NOTATION');
      return base;
    }
  }

  /** Argument of ^ or _ : a braced group or a single token (TeX takes one digit). */
  parseScript(): MathJSON {
    if (this.isSym('{')) {
      this.next();
      const e = this.fresh(() => this.parseRelationList());
      this.expectSym('}');
      return e;
    }
    const t = this.next();
    if (t.k === 'num') {
      if (t.v.length > 1 && !t.v.includes('.')) {
        this.toks.splice(this.pos, 0, { k: 'num', v: t.v.slice(1), at: t.at + 1 });
        return Number(t.v[0]);
      }
      return this.numberValue(t);
    }
    if (t.k === 'letter') return this.nameValue(t.v);
    if (t.k === 'cmd') {
      if (GREEK.has(t.v)) return t.v;
      if (t.v === 'pi') return 'Pi';
      if (t.v === 'infty') return 'Infinity';
      if (t.v === 'hbar') return 'Hbar';
    }
    if (t.k === 'sym' && (t.v === '+' || t.v === '-')) return t.v; // only meaningful for limit directions
    this.pos--;
    return this.fail('unsupported script');
  }

  numberValue(t: Tok): MathJSON {
    const v = t.v;
    if (!v.includes('.')) {
      const n = Number(v);
      if (n > 1e12) this.fail('integer larger than 10^12');
      return n;
    }
    const [int, frac] = v.split('.') as [string, string];
    const num = Number(int + frac);
    if (num > 1e12) this.fail('decimal too long');
    return ['Divide', num, 10 ** frac.length];
  }

  nameValue(name: string): MathJSON {
    if (!this.opts.symbols.has(name) && !this.opts.functions.has(name)) {
      if (name === 'e') return 'ExponentialE';
      if (name === 'i') return 'ImaginaryUnit';
    }
    return name;
  }

  readNameSubscript(): string {
    if (!this.isSym('_')) return '';
    this.next();
    const part = (t: Tok): string => {
      if (t.k === 'letter') return t.v;
      if (t.k === 'num' && /^\d+$/.test(t.v)) return t.v;
      if (t.k === 'cmd' && GREEK.has(t.v)) return t.v;
      return this.fail('only letters and digits are supported in subscripts', 'UNSUPPORTED_NOTATION');
    };
    if (this.isSym('{')) {
      this.next();
      let s = '';
      while (!this.isSym('}')) s += part(this.next());
      this.next();
      if (!s) this.fail('empty subscript');
      return s;
    }
    const t = this.next();
    if (t.k === 'num' && t.v.length > 1) {
      this.toks.splice(this.pos, 0, { k: 'num', v: t.v.slice(1), at: t.at + 1 });
      return t.v[0]!;
    }
    return part(t);
  }

  parseArgs(): MathJSON[] {
    this.expectSym('(');
    const args = this.fresh(() => {
      const out = [this.parseAdditive()];
      while (this.isSym(',')) { this.next(); out.push(this.parseAdditive()); }
      return out;
    });
    this.expectSym(')');
    if (args.length > 4) this.fail('functions take at most four arguments');
    return args;
  }

  parseName(base: string): MathJSON {
    const sub = this.readNameSubscript();
    const name = sub ? `${base}_${sub}` : base;
    if (!SYMBOL_NAME.test(name)) this.fail(`invalid name "${name}"`);
    if (!sub) {
      const v = this.nameValue(name);
      if (v !== name) return v;
    }
    if (this.isSym("'")) {
      let n = 0;
      while (this.isSym("'")) { this.next(); n++; }
      if (n > 3) this.fail('at most three primes', 'UNSUPPORTED_NOTATION');
      const args = this.isSym('(') ? this.parseArgs() : [];
      return ['Prime', ['Apply', name, ...args], n];
    }
    const declared = this.opts.functions.has(name);
    if (this.isSym('(') && (declared || DEFAULT_FUNCTION_NAMES.has(name))) return ['Apply', name, ...this.parseArgs()];
    if (declared) return ['Apply', name];
    return name;
  }

  parsePrimary(): MathJSON {
    const t = this.peek();
    if (!t) return this.fail('unexpected end of formula');
    if (t.k === 'num') { this.next(); return this.numberValue(t); }
    if (t.k === 'letter') { this.next(); return this.parseName(t.v); }
    if (t.k === 'sym') return this.parseSymPrimary(t);
    return this.parseCmdPrimary(t);
  }

  parseSymPrimary(t: Tok): MathJSON {
    switch (t.v) {
      case '(': {
        this.next();
        const e = this.fresh(() => this.parseRelationList());
        this.expectSym(')');
        return e;
      }
      case '[': {
        this.next();
        const e = this.fresh(() => this.parseRelationList());
        this.expectSym(']');
        return this.isSym('_') || this.isSym('^') ? this.parseEvaluateBounds(e) : e;
      }
      case 'NULLDELIM': {
        this.next();
        const e = this.fresh(() => { this.absDepth = 1; return this.parseRelationList(); });
        this.expectSym('|');
        return this.parseEvaluateBounds(e);
      }
      case '|': {
        this.next();
        const e = this.fresh(() => { this.absDepth = 1; return this.parseAdditive(); });
        this.expectSym('|');
        return ['Abs', e];
      }
      case '{': {
        this.next();
        const e = this.fresh(() => this.parseRelationList());
        this.expectSym('}');
        return e;
      }
      case '?':
        this.next();
        return ['Unreadable'];
      default:
        return this.fail(`unexpected "${t.v}"`);
    }
  }

  parseCmdPrimary(t: Tok): MathJSON {
    const v = t.v;
    if (GREEK.has(v)) { this.next(); return this.parseName(v); }
    this.next();
    switch (v) {
      case 'pi': return 'Pi';
      case 'hbar': return 'Hbar';
      case 'infty': return 'Infinity';
      case 'square': case 'Box': case 'blacksquare': return ['Unreadable'];
      case 'frac': return this.parseFrac();
      case 'sqrt': return this.parseSqrt();
      case 'sin': case 'cos': case 'tan': case 'ln': case 'log': case 'exp':
      case 'arctan': case 'arcsin': case 'arccos': case 'atan': case 'asin': case 'acos':
        return this.parseFn(v);
      case 'int': case 'tint': return this.parseIntegral();
      case 'sum': return this.parseSum();
      case 'lim': return this.parseLimit();
      case 'partial': return this.parsePartialPrefix();
      case 'mathbb': return this.parseNumberSet();
      case '{': return this.parseSet();
      case 'cdots': case 'ldots': case 'dots': case 'vdots':
        this.pos--;
        return this.fail('"…" belongs in a text segment', 'UNSUPPORTED_NOTATION');
      default:
        this.pos--;
        return this.fail(`unsupported command "\\${v}"`, 'UNSUPPORTED_NOTATION');
    }
  }

  readGroupTokens(): Tok[] {
    if (this.isSym('{')) {
      this.next();
      const start = this.pos;
      let depth = 1;
      while (depth > 0) {
        const t = this.next();
        if (t.k === 'sym' && t.v === '{') depth++;
        else if (t.k === 'sym' && t.v === '}') depth--;
      }
      return this.toks.slice(start, this.pos - 1);
    }
    const t = this.next();
    if (t.k === 'num' && t.v.length > 1 && !t.v.includes('.')) {
      this.toks.splice(this.pos, 0, { k: 'num', v: t.v.slice(1), at: t.at + 1 });
      return [{ k: 'num', v: t.v[0]!, at: t.at }];
    }
    return [t];
  }

  /** \mathbb{Z}^{+}, \mathbb{Z}_{>0}, \mathbb{Z}, \mathbb{N}, \mathbb{R}; the validator allows them only after \in. */
  parseNumberSet(): NumberSet {
    const letter = this.readGroupTokens();
    const v = letter.length === 1 && letter[0]!.k === 'letter' ? letter[0]!.v : '';
    if (v === 'R') return 'Reals';
    if (v === 'N') return 'NaturalNumbers';
    if (v !== 'Z') return this.fail('only \\mathbb{Z}, \\mathbb{N} and \\mathbb{R} are supported', 'UNSUPPORTED_NOTATION');
    if (!this.isSym('^') && !this.isSym('_')) return 'Integers';
    this.next();
    const mark = this.readGroupTokens().map((t) => t.v).join('');
    if (mark === '+' || mark === '>0') return 'PositiveIntegers';
    return this.fail(`unsupported number set "\\mathbb{Z}" with "${mark}"`, 'UNSUPPORTED_NOTATION');
  }

  subParse(toks: Tok[]): MathJSON {
    if (toks.length === 0) this.fail('empty group');
    const p = new Parser([...toks], this.opts);
    const e = p.parseRelationList();
    if (!p.atEnd()) p.fail(`unexpected "${tokText(p.peek()!)}"`);
    return e;
  }

  parseFrac(): MathJSON {
    const num = this.readGroupTokens();
    const den = this.readGroupTokens();
    const d = this.tryDerivative(num, den);
    if (d !== undefined) return d;
    return ['Divide', this.subParse(num), this.subParse(den)];
  }

  tryDerivative(num: Tok[], den: Tok[]): MathJSON | undefined {
    const isMarker = (t?: Tok) => !!t && ((t.k === 'letter' && t.v === 'd') || (t.k === 'cmd' && t.v === 'partial'));
    if (!isMarker(num[0]) || !isMarker(den[0])) return undefined;
    const kind = num[0]!.k === 'cmd' ? 'PartialD' : 'D';
    const readOrder = (toks: Tok[], i: number): [number, number] | undefined => {
      if (!(toks[i]?.k === 'sym' && toks[i]!.v === '^')) return [1, i];
      const a = toks[i + 1];
      if (a?.k === 'num') return [Number(a.v), i + 2];
      if (a?.k === 'sym' && a.v === '{' && toks[i + 2]?.k === 'num' && toks[i + 3]?.k === 'sym' && toks[i + 3]!.v === '}') {
        return [Number(toks[i + 2]!.v), i + 4];
      }
      return undefined;
    };
    const vars: string[] = [];
    let i = 0;
    while (i < den.length) {
      if (!isMarker(den[i])) return undefined;
      const vt = den[i + 1];
      let name: string;
      if (vt?.k === 'letter') name = vt.v;
      else if (vt?.k === 'cmd' && GREEK.has(vt.v)) name = vt.v;
      else return undefined;
      const r = readOrder(den, i + 2);
      if (!r) return undefined;
      for (let k = 0; k < r[0]; k++) vars.push(name);
      i = r[1];
    }
    if (vars.length === 0) return undefined;
    const r = readOrder(num, 1);
    if (!r) return undefined;
    if (r[0] !== vars.length) this.fail('derivative orders do not match');
    const rest = num.slice(r[1]);
    let operand: MathJSON;
    if (rest.length === 0) {
      operand = this.parseTerm();
    } else {
      operand = this.subParse(rest);
      if (typeof operand === 'string' && !isConstant(operand)) operand = ['Apply', operand];
    }
    let out = operand;
    for (let k = vars.length - 1; k >= 0; k--) out = [kind, out, vars[k]!];
    return out;
  }

  parseSqrt(): MathJSON {
    let index: MathJSON | undefined;
    if (this.isSym('[')) {
      this.next();
      index = this.fresh(() => this.parseAdditive());
      this.expectSym(']');
    }
    const arg = this.subParse(this.readGroupTokens());
    return index === undefined ? ['Sqrt', arg] : ['Power', arg, ['Divide', 1, index]];
  }

  parseFn(name: string): MathJSON {
    let power: MathJSON | undefined;
    if (this.isSym('^')) {
      this.next();
      power = this.parseScript();
      if (power === -1 || (Array.isArray(power) && power[0] === 'Negate')) {
        this.fail('inverse-function notation is not supported', 'UNSUPPORTED_NOTATION');
      }
    }
    let arg: MathJSON;
    if (this.isSym('(') || this.isSym('[') || this.isSym('{')) {
      const open = this.next().v;
      const close = open === '(' ? ')' : open === '[' ? ']' : '}';
      arg = this.fresh(() => this.parseAdditive());
      this.expectSym(close);
    } else {
      const factors: MathJSON[] = [];
      while (
        this.canStartImplicit() &&
        !(this.peek()!.k === 'cmd' && (FN_CMDS.has(this.peek()!.v) || ['int', 'sum', 'lim'].includes(this.peek()!.v))) &&
        !(this.stopAtDiff && this.isDifferentialAhead())
      ) {
        factors.push(this.parsePostfix());
      }
      if (factors.length === 0) this.fail(`\\${name} needs an argument`);
      arg = factors.length === 1 ? factors[0]! : ['Multiply', ...factors];
    }
    const op: Record<string, string> = {
      sin: 'Sin', cos: 'Cos', tan: 'Tan', exp: 'Exp', ln: 'Ln', log: 'Ln',
      arctan: 'ArcTan', atan: 'ArcTan',
      arcsin: 'ArcSin', asin: 'ArcSin',
      arccos: 'ArcCos', acos: 'ArcCos',
    };
    const node: MathJSON = [op[name]!, arg];
    return power === undefined ? node : ['Power', node, power];
  }

  parseIntegral(): MathJSON {
    let lower: MathJSON = null;
    let upper: MathJSON = null;
    for (let k = 0; k < 2; k++) {
      if (this.isSym('_')) { this.next(); lower = this.parseScript(); }
      else if (this.isSym('^')) { this.next(); upper = this.parseScript(); }
    }
    const save = this.stopAtDiff;
    this.stopAtDiff = true;
    const body = this.isDifferentialAhead() ? 1 : this.parseAdditive();
    this.stopAtDiff = save;
    if (!this.isDifferentialAhead()) this.fail('integral without a differential such as "dx"');
    this.next();
    const vt = this.next();
    const v = vt.k === 'letter' || vt.k === 'cmd' ? vt.v : this.fail('differential variable');
    return ['Integrate', body, ['Tuple', v, lower, upper]];
  }

  parseSum(): MathJSON {
    let v: string | null = null;
    let lower: MathJSON = null;
    let upper: MathJSON = null;
    for (let k = 0; k < 2; k++) {
      if (this.isSym('_')) {
        this.next();
        const s = this.parseScript();
        const asIndex = (x: MathJSON) => (x === 'ImaginaryUnit' ? 'i' : x);
        if (typeof s === 'string') v = asIndex(s) as string;
        else if (Array.isArray(s) && s[0] === 'Equal' && typeof s[1] === 'string') { v = asIndex(s[1]) as string; lower = s[2] ?? null; }
        else this.fail('sum index must be "n" or "n = 1"', 'UNSUPPORTED_NOTATION');
      } else if (this.isSym('^')) { this.next(); upper = this.parseScript(); }
    }
    if (!v) this.fail('sum needs an index');
    const body = this.parseTerm();
    return ['Sum', body, ['Tuple', v, lower, upper]];
  }

  parseLimit(): MathJSON {
    if (!this.isSym('_')) this.fail('limit needs "x \\to a"');
    this.next();
    const toks = this.readGroupTokens();
    const to = toks.findIndex((t) => t.k === 'cmd' && t.v === 'to');
    if (to !== 1) this.fail('limit needs "x \\to a"', 'UNSUPPORTED_NOTATION');
    const vt = toks[0]!;
    const v = vt.k === 'letter' || (vt.k === 'cmd' && GREEK.has(vt.v)) ? vt.v : this.fail('limit variable');
    let valueToks = toks.slice(2);
    let dir: 'both' | 'left' | 'right' = 'both';
    const n = valueToks.length;
    const lastIs = (s: string) => valueToks[n - 1]?.k === 'sym' && valueToks[n - 1]!.v === s;
    if (n >= 2 && valueToks[n - 2]?.k === 'sym' && valueToks[n - 2]!.v === '^' && (lastIs('+') || lastIs('-'))) {
      dir = lastIs('+') ? 'right' : 'left';
      valueToks = valueToks.slice(0, n - 2);
    } else if (n >= 4 && valueToks[n - 4]?.k === 'sym' && valueToks[n - 4]!.v === '^' && valueToks[n - 3]?.k === 'sym' && valueToks[n - 3]!.v === '{') {
      const s = valueToks[n - 2];
      if (s?.k === 'sym' && (s.v === '+' || s.v === '-')) { dir = s.v === '+' ? 'right' : 'left'; valueToks = valueToks.slice(0, n - 4); }
    }
    const value = this.subParse(valueToks);
    const body = this.parseTerm();
    return ['Limit', body, ['LimitSpec', v, value, dir]];
  }

  parsePartialPrefix(): MathJSON {
    if (!this.isSym('_')) this.fail('write partial derivatives as \\frac{\\partial f}{\\partial x}', 'UNSUPPORTED_NOTATION');
    this.next();
    const vt = this.next();
    const v = vt.k === 'letter' || (vt.k === 'cmd' && GREEK.has(vt.v)) ? vt.v : this.fail('partial variable');
    let order = 1;
    if (this.isSym('^')) {
      this.next();
      const o = this.parseScript();
      if (typeof o !== 'number') this.fail('derivative order must be a number');
      order = o;
    }
    let operand = this.parsePostfix();
    if (typeof operand === 'string' && !isConstant(operand)) operand = ['Apply', operand];
    for (let k = 0; k < order; k++) operand = ['PartialD', operand, v];
    return operand;
  }

  parseSet(): MathJSON {
    if (this.isCmd('}')) { this.next(); return ['Set']; }
    const els = this.fresh(() => {
      const out = [this.parseAdditive()];
      while (this.isSym(',')) { this.next(); out.push(this.parseAdditive()); }
      return out;
    });
    this.expectCmd('}');
    if (els.length > 16) this.fail('sets hold at most 16 elements');
    return ['Set', ...els];
  }

  parseEvaluateBounds(body: MathJSON): MathJSON {
    let lower: MathJSON | undefined;
    let upper: MathJSON | undefined;
    for (let k = 0; k < 2; k++) {
      if (this.isSym('_')) { this.next(); lower = this.parseScript(); }
      else if (this.isSym('^')) { this.next(); upper = this.parseScript(); }
    }
    if (lower === undefined || upper === undefined) this.fail('evaluation brackets need both bounds');
    return ['Evaluate', body, ['Tuple', inferVariable(body, this.opts.evaluateVar), lower, upper]];
  }
}

function inferVariable(body: MathJSON, preferred?: string): string {
  const fs = [...freeSymbols(body)].sort();
  if (preferred && fs.includes(preferred)) return preferred;
  for (const c of ['x', 't', 'u', 's']) if (fs.includes(c)) return c;
  return fs[0] ?? preferred ?? 'x';
}

function tokText(t: Tok): string {
  return t.k === 'cmd' ? `\\${t.v}` : t.v;
}

function stripDelimiters(s: string): string {
  let out = s.trim();
  const pairs: [string, string][] = [['$$', '$$'], ['$', '$'], ['\\(', '\\)'], ['\\[', '\\]']];
  for (const [a, b] of pairs) {
    if (out.startsWith(a) && out.endsWith(b) && out.length >= a.length + b.length) {
      out = out.slice(a.length, out.length - b.length).trim();
      break;
    }
  }
  return out;
}

export function resolveParseOptions(options: ParseOptions = {}): Resolved {
  return {
    functions: new Map((options.functions ?? []).map((f) => [f.name, f.args])),
    symbols: new Set(options.symbols ?? []),
    evaluateVar: options.evaluateVar,
  };
}

/** Parse one math segment. A leading "=" marks a continuation of the previous expression. */
export function parseMathLatex(latex: string, options: ParseOptions = {}): ParseResult {
  let body = stripDelimiters(latex);
  let notation: Notation = 'plain';
  if (body.startsWith('=')) {
    notation = 'continuation';
    body = body.slice(1);
  }
  try {
    const toks = tokenize(body);
    if (toks.length === 0) {
      return { ok: false, error: { code: 'EMPTY', message: 'empty formula', at: 0 } };
    }
    const parser = new Parser(toks, resolveParseOptions(options));
    const expr = parser.parseTop();
    if (notation === 'continuation' && isRelation(expr)) {
      return { ok: false, error: { code: 'UNSUPPORTED_NOTATION', message: 'a continuation cannot contain a relation', at: 0 } };
    }
    const issue = validateExpr(expr);
    if (issue) return { ok: false, error: { code: 'IR_INVALID', message: issue.message, at: 0 } };
    return { ok: true, expr, notation };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: { code: e.code, message: e.message, at: e.at } };
    throw e;
  }
}
