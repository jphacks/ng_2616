'use client';

import clsx from 'clsx';
import katex from 'katex';
import { Fragment, memo, useMemo, type ReactNode } from 'react';

/** KaTeX with trust:false. Rendering errors stay visible instead of being replaced (spec §8.2). */
export const Tex = memo(function Tex({ latex, display = false, className }: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, trust: false, displayMode: display, strict: 'ignore', output: 'html' }),
    [latex, display],
  );
  return <span className={clsx(display ? 'block' : 'inline-block', className)} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Prose with $inline$ / $$display$$ math and a little markdown (#, **, *). */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => text.split(/\n{2,}/), [text]);
  return (
    <div className={clsx('space-y-3 leading-relaxed', className)}>
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
          return <Tex key={i} latex={trimmed.slice(2, -2)} display className="my-2 overflow-x-auto" />;
        }
        const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (heading) {
          const size = heading[1]!.length === 1 ? 'text-3xl font-semibold' : 'text-2xl font-semibold';
          return <h3 key={i} className={size}>{inline(heading[2]!)}</h3>;
        }
        return <p key={i}>{inline(trimmed)}</p>;
      })}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\$([^$]+)\$|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] !== undefined) out.push(<Tex key={k++} latex={m[1]} />);
    else if (m[2] !== undefined) out.push(<strong key={k++}>{inline(m[2])}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k++}>{inline(m[3])}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return out;
}
