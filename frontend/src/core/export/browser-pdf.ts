'use client';

import katex from 'katex';
import type { PdfDocument } from '@mn/contracts';

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const MAX_PAGES = 50;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

export interface PdfProgress { done: number; total: number }

export function pdfFileName(title: string): string {
  const clean = Array.from(title).filter((c) => c.charCodeAt(0) >= 32).join('').replace(/[<>:"/\\|?*]/g, '-').replace(/\.pdf$/i, '').trim().replace(/[. ]+$/, '').slice(0, 120);
  return `${clean || 'notebook'}.pdf`;
}

function check(signal: AbortSignal) { signal.throwIfAborted(); }

async function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  check(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const timer = setTimeout(() => reject(new Error('PDF_ASSETS_FAILED')), 30000);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', abort); });
  });
}

// Bound text units before pagination so a paragraph is never cropped at a page edge.
export function textChunks(value: string, limit = 500): string[] {
  const chars = Array.from(value);
  const out: string[] = [];
  while (chars.length) {
    let end = Math.min(limit, chars.length);
    if (end < chars.length) {
      for (let i = end; i > end / 2; i--) if (/[\s。.!?]/u.test(chars[i - 1]!)) { end = i; break; }
    }
    out.push(chars.splice(0, end).join(''));
  }
  return out;
}

const CSS = `
html,body{margin:0;padding:0;width:794px;height:auto;background:#fff;color:#182033;color-scheme:light}
*{box-sizing:border-box}
body{font-family:Arial,"Noto Sans JP","Yu Gothic",Meiryo,sans-serif;font-size:15px;line-height:1.7}
.pdf-page{position:relative;width:794px;height:1123px;padding:48px 56px 55px;background:#fff;overflow:hidden}
.pdf-content{height:1020px;overflow:visible}
.pdf-unit{margin:0 0 10px;overflow-wrap:anywhere;white-space:pre-wrap}
.pdf-title{font-size:25px;font-weight:700;line-height:1.5;margin-bottom:20px;text-align:center}
.pdf-author{font-size:14px;text-align:right;margin-bottom:22px}
.pdf-section{font-size:19px;font-weight:700;border-bottom:1px solid #cbd0da;padding:12px 0 6px;margin-bottom:14px}
.pdf-label{font-size:14px;font-weight:700;color:#343e52;margin-top:8px;margin-bottom:6px}
.pdf-note{font-size:12px;color:#4b5563;border-left:2px solid #cbd0da;padding-left:10px}
.pdf-math{white-space:nowrap;margin:10px 0 14px;line-height:normal}
.pdf-math-inner{display:inline-block;transform-origin:top left}
.pdf-math .katex{font-size:1.22em;line-height:1.2}
.pdf-footer{position:absolute;bottom:22px;left:56px;right:56px;border-top:1px solid #e0e3e8;padding-top:6px;font:11px Arial,sans-serif;color:#657085;text-align:right}
`;

/** The only innerHTML comes from KaTeX with trust:false. All notebook prose uses textContent. */
function unitsFor(doc: Document, data: PdfDocument): HTMLElement[] {
  const units: HTMLElement[] = [];
  let group = 0;
  const finishBlock = (start: number) => {
    for (const unit of units.slice(start)) unit.dataset.group = String(group);
    group++;
  };
  const add = (value: string, cls = '', keep = false) => {
    for (const chunk of textChunks(value)) {
      const el = doc.createElement('div');
      el.className = `pdf-unit ${cls}`;
      el.textContent = chunk;
      if (keep) el.dataset.keepNext = 'true';
      units.push(el);
    }
  };
  add(data.title, 'pdf-title', true);
  if (data.author || data.student_id) add([
    data.author ? `${data.language === 'ja' ? '氏名' : 'Name'}: ${data.author}` : '',
    data.student_id ? `${data.language === 'ja' ? '学籍番号' : 'Student ID'}: ${data.student_id}` : '',
  ].filter(Boolean).join('　　'), 'pdf-author');
  for (const section of data.sections) {
    const sectionStart = units.length;
    add(section.title, 'pdf-section', true);
    for (const [index, block] of section.blocks.entries()) {
      const blockStart = index === 0 ? sectionStart : units.length;
      if (block.label) add(block.label, 'pdf-label', true);
      if (block.fragments.some((f) => f.kind === 'text') && block.fragments.some((f) => f.kind === 'math')) {
        // A problem statement is a paragraph with inline formulas, not a stack of app rows.
        let para = doc.createElement('div'); para.className = 'pdf-unit';
        const flush = () => { if (para.childNodes.length) units.push(para); para = doc.createElement('div'); para.className = 'pdf-unit'; };
        let length = 0;
        for (const fragment of block.fragments) {
          if (fragment.kind === 'text') {
            const chunks = textChunks(fragment.value);
            for (const [i, chunk] of chunks.entries()) {
              if (length + chunk.length > 600 || i) { flush(); length = 0; }
              para.append(doc.createTextNode(chunk)); length += chunk.length;
            }
          } else {
            const math = doc.createElement('span');
            try { math.innerHTML = katex.renderToString(fragment.value, { output: 'html', throwOnError: true, trust: false, strict: 'ignore' }); }
            catch { math.textContent = fragment.value; }
            para.append(math); length += 40;
          }
        }
        flush();
        for (const note of block.notes) add(note, 'pdf-note');
        finishBlock(blockStart);
        continue;
      }
      for (const fragment of block.fragments) {
        if (fragment.kind === 'text') { add(fragment.value); continue; }
        const outer = doc.createElement('div');
        outer.className = 'pdf-unit pdf-math';
        const inner = doc.createElement('span');
        inner.className = 'pdf-math-inner';
        try {
          inner.innerHTML = katex.renderToString(`\\displaystyle ${fragment.value}`, { output: 'html', throwOnError: true, trust: false, displayMode: false, strict: 'ignore' });
          outer.append(inner);
          units.push(outer);
        } catch {
          add(`${data.language === 'ja' ? '数式を表示できません（未検証）' : 'Formula could not be rendered (unverified)'}: ${fragment.value}`, 'pdf-note');
        }
      }
      for (const note of block.notes) add(note, 'pdf-note');
      finishBlock(blockStart);
    }
  }
  return units;
}

async function prepareFrame(signal: AbortSignal): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.dataset.pdfExport = 'true';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;pointer-events:none;';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    // A separate document avoids exporting toolbars and Tailwind's unsupported color functions.
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    doc.close();
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    await waitFor(Promise.all(links.map((source) => new Promise<void>((resolve, reject) => {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = source.href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('PDF_ASSETS_FAILED'));
      doc.head.append(link);
    }))), signal);
    // Next's development runtime can inject KaTeX rules as inline styles.
    for (const style of document.querySelectorAll('style')) doc.head.append(style.cloneNode(true));
    const style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.append(style);
    check(signal);
    return frame;
  } catch (e) { frame.remove(); throw e; }
}

function paginate(doc: Document, units: HTMLElement[]): HTMLElement[] {
  const pages: HTMLElement[] = [];
  let content: HTMLElement;
  const newPage = () => {
    if (pages.length >= MAX_PAGES) throw new Error('EXPORT_TOO_LARGE');
    const page = doc.createElement('article');
    page.className = 'pdf-page';
    content = doc.createElement('div');
    content.className = 'pdf-content';
    page.append(content);
    doc.body.append(page);
    pages.push(page);
  };
  newPage();
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    // Keep an equation and its verification/source notes together when the block fits a page.
    if (unit.dataset.group && unit.dataset.group !== units[i - 1]?.dataset.group) {
      const block: HTMLElement[] = [];
      const previousCount = content!.childElementCount;
      for (let k = i; k < units.length && units[k]!.dataset.group === unit.dataset.group; k++) {
        content!.append(units[k]!); block.push(units[k]!);
      }
      const last = block.at(-1)!;
      const bottom = last.offsetTop + last.offsetHeight;
      const height = bottom - unit.offsetTop;
      const overflows = bottom - content!.offsetTop > content!.clientHeight;
      for (const part of block) part.remove();
      if (previousCount && height <= content!.clientHeight && overflows) newPage();
    }
    content!.append(unit);
    const inner = unit.querySelector<HTMLElement>('.pdf-math-inner');
    if (inner) {
      const size = inner.getBoundingClientRect();
      const scale = Math.min(1, content!.clientWidth / Math.max(1, size.width), 650 / Math.max(1, size.height));
      inner.style.transform = `scale(${scale})`;
      unit.style.height = `${Math.ceil(size.height * scale)}px`;
    }
    let used = unit.offsetTop + unit.offsetHeight - content!.offsetTop;
    // Measure headings together with the next actual content, not a guessed line height.
    const lookahead: HTMLElement[] = [];
    if (unit.dataset.keepNext) {
      for (let k = i + 1; k < units.length; k++) {
        const next = units[k]!;
        content!.append(next);
        lookahead.push(next);
        used = next.offsetTop + next.offsetHeight - content!.offsetTop;
        if (!next.dataset.keepNext) break;
      }
    }
    for (const next of lookahead) next.remove();
    if (used > content!.clientHeight && content!.childElementCount > 1) {
      unit.remove(); newPage(); content!.append(unit);
    }
    if (unit.offsetHeight > content!.clientHeight) throw new Error('EXPORT_TOO_LARGE');
  }
  pages.forEach((page, i) => {
    const footer = doc.createElement('div');
    footer.className = 'pdf-footer';
    const count = doc.createElement('span'); count.textContent = `${i + 1} / ${pages.length}`;
    footer.append(count); page.append(footer);
  });
  return pages;
}

/** KaTeX exposes safe break points between top-level relations/terms as base spans. */
function wrapWideFormulas(doc: Document, units: HTMLElement[]): HTMLElement[] {
  const width = PAGE_WIDTH - 112;
  return units.flatMap((unit) => {
    const inner = unit.querySelector<HTMLElement>('.pdf-math-inner');
    const root = inner?.querySelector('.katex');
    const html = root?.querySelector('.katex-html');
    if (!inner || !root || !html || inner.getBoundingClientRect().width <= width) return [unit];
    const bases = [...html.children];
    if (bases.length < 2 || bases.some((b) => !b.matches('.katex-base, .base'))) return [unit];
    const rows: HTMLElement[] = [];
    let rowBases: Element[] = [];
    let rowWidth = 0;
    const flush = () => {
      if (!rowBases.length) return;
      const row = unit.cloneNode(false) as HTMLElement;
      const rowInner = inner.cloneNode(false) as HTMLElement;
      const rowRoot = root.cloneNode(false) as Element;
      const rowHtml = html.cloneNode(false) as Element;
      rowHtml.append(...rowBases.map((b) => b.cloneNode(true)));
      rowRoot.appendChild(rowHtml); rowInner.append(rowRoot); row.append(rowInner);
      doc.body.append(row); rows.push(row);
      rowBases = []; rowWidth = 0;
    };
    for (const base of bases) {
      const baseWidth = base.getBoundingClientRect().width;
      if (rowBases.length && rowWidth + baseWidth > width - 8) flush();
      rowBases.push(base); rowWidth += baseWidth;
    }
    flush(); unit.remove();
    return rows;
  });
}

/** Entirely device-local. Render one A4 page at a time to keep mobile memory bounded. */
export async function generateBrowserPdf(data: PdfDocument, signal: AbortSignal, progress: (p: PdfProgress) => void): Promise<Blob> {
  check(signal);
  const [{ jsPDF }, { toCanvas, getFontEmbedCSS }] = await Promise.all([import('jspdf'), import('html-to-image')]);
  check(signal);
  const frame = await prepareFrame(signal);
  try {
    const doc = frame.contentDocument!;
    const units = unitsFor(doc, data);
    doc.body.append(...units);
    await waitFor(doc.fonts.ready, signal);
    check(signal);
    const pages = paginate(doc, wrapWideFormulas(doc, units));
    // Explicitly include all KaTeX families: iframe nodes belong to a different HTMLElement realm.
    const fontCollector = document.createElement('div');
    fontCollector.style.fontFamily = 'KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, KaTeX_Main, KaTeX_Math, KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1, KaTeX_Size2, KaTeX_Size3, KaTeX_Size4, KaTeX_Typewriter';
    const fontEmbedCSS = await waitFor(getFontEmbedCSS(fontCollector, { preferredFontFormat: 'woff2' }), signal);
    const pdf = new jsPDF({ unit: 'px', format: [PAGE_WIDTH, PAGE_HEIGHT], orientation: 'portrait', hotfixes: ['px_scaling'], compress: true });
    pdf.setProperties({ title: data.title, creator: 'Math Notebook', subject: 'Notebook export' });
    for (const [i, page] of pages.entries()) {
      check(signal);
      progress({ done: i, total: pages.length });
      // Keep the captured page at the iframe origin. Deep, off-screen foreignObjects can lose
      // text painting in Chromium even though their DOM/layout measurements are correct.
      doc.body.replaceChildren(page);
      frame.contentWindow?.scrollTo(0, 0);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const canvas = await waitFor(toCanvas(page, { pixelRatio: 2, width: PAGE_WIDTH, height: PAGE_HEIGHT, backgroundColor: '#ffffff', fontEmbedCSS }), signal);
      check(signal);
      if (i) pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT], 'portrait');
      pdf.addImage(canvas, 'PNG', 0, 0, PAGE_WIDTH, PAGE_HEIGHT, undefined, 'FAST');
      canvas.width = 0; canvas.height = 0;
    }
    const blob = pdf.output('blob');
    if (blob.size > MAX_PDF_BYTES) throw new Error('EXPORT_TOO_LARGE');
    progress({ done: pages.length, total: pages.length });
    return blob;
  } finally { frame.remove(); }
}
