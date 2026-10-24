import { NotebookSchema, PdfDocumentSchema, hashOf, type Line, type Notebook, type PdfBlock, type PdfDocument, type PdfFragment, type Segment, type UiLang } from '@mn/contracts';
import { printSegmentLatex, SYMBOL_NAME, validateExpr, type MathJSON } from '@mn/contracts/ir';
import { inputHash, payloadForLine } from '@/core/cas/payload';

const MAX_LINES = 500;

export interface ReportDetails { title: string; author: string; studentId: string }

const WORDS = {
  en: { problem: 'Problem', derivation: 'Derivation', history: 'Revision history', statement: 'Statement', given: 'Given', definitions: 'Definitions', assumptions: 'Assumptions', unknowns: 'Unknowns', variable: 'Independent variable', functions: 'Functions', origin: 'Source', verified: 'Verified', local: 'Local transformation consistent; depends on unverified lines', wrong: 'Wrong', unknown: 'Unverified', none: 'Not checked', stale: 'Verification is pending or no longer current', premise: 'Reference material (not verified)', definition: 'Definition (not verified)', draft: 'Unfinished line omitted', unparsed: 'Unparsed formula (not verified)', mock: 'MOCK / scripted content', ai: 'AI-assisted', aiUnknown: 'AI suggestion adopted without verification', superseded: 'Superseded', empty: 'No confirmed lines.', unreadable: 'Contains unreadable content', snapshot: 'Content at the time PDF export was requested. Verification labels describe the notebook; they are not a new proof.' },
  ja: { problem: '問題', derivation: '導出', history: '修正履歴', statement: '問題文', given: '条件', definitions: '定義', assumptions: '仮定', unknowns: '未知数', variable: '独立変数', functions: '関数', origin: '出典', verified: '検証済み', local: '局所変形は整合（未検証の行に依存）', wrong: '誤り', unknown: '確認不能', none: '検証対象外', stale: '検証待ち、または現在の前提では未検証', premise: '資料参照（未検証）', definition: '定義（未検証）', draft: '未確定行の数式・筆跡は省略', unparsed: '解析不能の数式（未検証）', mock: '模擬・台本の内容', ai: 'AIによる補完を含む', aiUnknown: '未検証のAI候補を採用', superseded: '修正済み', empty: '確定済みの行はありません。', unreadable: '未読箇所あり', snapshot: 'PDF出力を開始した時点の内容です。検証表示はノートの記録であり、新たな証明ではありません。' },
} as const;

function text(value: string): PdfFragment { return { kind: 'text', value }; }

function contains(expr: MathJSON, operator: string): boolean {
  return Array.isArray(expr) && (expr[0] === operator || expr.slice(1).some((e) => contains(e, operator)));
}

function formula(expr: MathJSON, notation: 'plain' | 'continuation' = 'plain'): PdfFragment {
  if (validateExpr(expr)) throw new Error('IR_INVALID');
  if (contains(expr, 'Unparsed')) {
    // Never let raw recognition strings become executable TeX, including nested Unparsed nodes.
    const raw = (e: MathJSON): string => Array.isArray(e) ? e[0] === 'Unparsed' ? String(e[1]) : `${e[0]}(${e.slice(1).map(raw).join(', ')})` : String(e ?? '');
    return text(raw(expr));
  }
  return { kind: 'math', value: printSegmentLatex(expr, notation) };
}

function symbol(name: string): MathJSON {
  if (!SYMBOL_NAME.test(name)) throw new Error('IR_INVALID');
  return name;
}

function fragments(segments: readonly Segment[]): PdfFragment[] {
  return segments.map((s) => s.type === 'text' ? text(s.text) : formula(s.expr, s.notation));
}

/** Strip data the PDF does not use before rendering; this never mutates the live notebook. */
export function exportSnapshot(nb: Notebook): Notebook {
  return {
    ...nb, extensions: nb.extensions?.demo ? { demo: true } : undefined, recoveries: [],
    lines: nb.lines.map((l) => ({ ...l, ink: [], extensions: undefined, failure: l.failure ? { stage: l.failure.stage, code: l.failure.code } : undefined,
      verified: l.verified ? { ...l.verified, proof: { ...l.verified.proof, evidence: [], hints: [] } } : undefined })),
  };
}

/** Bound document work, including notebooks restored from device/cloud storage. */
export function validateExportSnapshot(value: unknown): Notebook {
  let nodes = 0;
  const walk = (v: unknown, depth: number) => {
    if (++nodes > 250000 || depth > 40) throw new Error('EXPORT_TOO_LARGE');
    if (v && typeof v === 'object') for (const child of Object.values(v)) walk(child, depth + 1);
  };
  walk(value, 0);
  const nb = NotebookSchema.parse(value);
  if (nb.lines.length > MAX_LINES || new Set(nb.lines.map((l) => l.id)).size !== nb.lines.length) throw new Error('EXPORT_TOO_LARGE');
  return nb;
}

export function serializeNotebook(nb: Notebook, language: UiLang, report?: ReportDetails): { document: PdfDocument; snapshotHash: string; omitted: number } {
  const w = WORDS[language];
  const p = nb.problem;
  const blocks: PdfBlock[] = [];
  const add = (label: string, parts: PdfFragment[], notes: string[] = []) => blocks.push({ label, fragments: parts, notes });
  add(p.title, [], nb.mode === 'mock' || nb.extensions?.demo ? [w.mock] : []);
  if (p.statement.length) add(w.statement, fragments(p.statement));
  p.conditions.forEach((e) => add(w.given, [formula(e)]));
  p.definitions.forEach((e) => add(w.definitions, [formula(e)]));
  for (const a of p.assumptions) {
    const s = symbol(a.symbol);
    const math = (e: MathJSON) => add(w.assumptions, [formula(e)]);
    switch (a.kind) {
      case 'positive': math(['Greater', s, 0]); break;
      case 'nonnegative': math(['GreaterEqual', s, 0]); break;
      case 'nonzero': math(['NotEqual', a.expr ?? s, 0]); break;
      case 'interval':
        if (a.lower !== undefined) math(['LessEqual', a.lower, s]);
        if (a.upper !== undefined) math(['LessEqual', s, a.upper]);
        break;
      case 'positive_integer': add(w.assumptions, [formula(s), text(language === 'ja' ? '正の整数' : 'positive integer')]); break;
      case 'real': add(w.assumptions, [formula(s), text(language === 'ja' ? '実数' : 'real')]); break;
    }
  }
  if (p.unknowns.length) add(w.unknowns, p.unknowns.map((s) => formula(symbol(s))));
  if (p.independent_var) add(w.variable, [formula(symbol(p.independent_var))]);
  for (const f of p.functions ?? []) add(w.functions, [formula(['Apply', symbol(f.name), ...f.args.map(symbol)])]);
  if (p.origin) add(w.origin, [text(`${p.origin.name}${p.origin.page ? ` · p.${p.origin.page}` : ''}`)]);

  let omitted = 0;
  const numbers = new Map(nb.lines.filter((l) => l.state !== 'SUPERSEDED').map((l, i) => [l.id, String(i + 1)]));
  const renderLine = (l: Line, historical = false): PdfBlock => {
    const notes: string[] = [];
    const proof = l.verified?.proof;
    let current = historical;
    if (!historical && l.state === 'SETTLED' && proof) {
      try { current = inputHash(nb, payloadForLine(nb, l.id), proof.cas.version) === l.verified?.input_hash && proof.input_hash === l.verified.input_hash; } catch { current = false; }
    }
    if (l.role === 'premise') notes.push(w.premise);
    else if (l.role === 'definition') notes.push(w.definition);
    else if (!current || !proof) notes.push(w.stale);
    else if (proof.status === 'ok') notes.push(proof.depends_on_unverified || proof.unverified_ancestors.length ? `${w.local}: ${proof.unverified_ancestors.map((id) => numbers.get(id) ?? id).join(', ')}` : w.verified);
    else notes.push(w[proof.status]);
    if (l.ai_origin || l.source === 'ai') notes.push(l.ai_origin?.unverified_adoption ? w.aiUnknown : w.ai);
    if (nb.mode === 'mock' || nb.extensions?.demo || proof?.mock) notes.push(w.mock);
    if (l.document_origin) notes.push(`${w.origin}: ${l.document_origin.name} · p.${l.document_origin.page}${l.document_origin.has_unreadable ? ` · ${w.unreadable}` : ''}`);
    else if (l.source === 'pdf' || l.source === 'resource') notes.push(`${w.origin}: ${l.source}`);
    if (l.segments.some((s) => s.type === 'math' && contains(s.expr, 'Unparsed'))) notes.push(w.unparsed);
    if (l.segments.some((s) => s.type === 'math' && contains(s.expr, 'Unreadable'))) notes.push(w.unreadable);
    if (historical) notes.push(`${w.superseded}${l.superseded_by ? ` → ${numbers.get(l.superseded_by) ?? l.superseded_by}` : ''}`);
    return { label: historical ? l.id : numbers.get(l.id) ?? l.id, fragments: fragments(l.segments), notes };
  };
  const lines: PdfBlock[] = [];
  const history: PdfBlock[] = [];
  for (const l of nb.lines) {
    if (l.state === 'SUPERSEDED') history.push(renderLine(l, true));
    else if (l.state !== 'SETTLED') {
      // The trailing empty draft is a cursor, not omitted work.
      if (l.state !== 'DRAFT' || l.version > 1 || l.segments.length || l.ink.length) { omitted++; lines.push({ label: numbers.get(l.id) ?? l.id, fragments: [text(w.draft)], notes: [l.state] }); }
    } else lines.push(renderLine(l));
  }
  if (!lines.length) lines.push({ label: '', fragments: [text(w.empty)], notes: [] });
  const document = PdfDocumentSchema.parse({ title: report?.title.trim() || nb.title, author: report?.author.trim() || undefined, student_id: report?.studentId.trim() || undefined, language, sections: [{ title: w.problem, blocks }, { title: w.derivation, blocks: lines }, ...(history.length ? [{ title: w.history, blocks: history }] : [])] });
  // Hash binds the exact export representation, not omitted ink or volatile timings.
  return { document, snapshotHash: hashOf({ notebook_id: nb.id, document }), omitted };
}
