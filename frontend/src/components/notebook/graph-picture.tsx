'use client';

import type { GraphSpec } from '@mn/contracts';
import clsx from 'clsx';
import { TriangleAlert } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { getGraphs, pngSrc, type GraphImage } from '@/core/graph/controller';
import { useT } from '@/i18n';
import { Spinner } from '@/ui/spinner';

/** The drawing of a graph spec; the same spec is drawn once and then served from the cache. */
export function useGraphImage(spec: GraphSpec | undefined): GraphImage | null {
  const [image, setImage] = useState<{ spec: GraphSpec; image: GraphImage } | null>(null);
  useEffect(() => {
    if (!spec) return;
    let live = true;
    void getGraphs()
      .render(spec)
      .then((r) => live && setImage({ spec, image: r }));
    return () => {
      live = false;
    };
  }, [spec]);
  return image && image.spec === spec ? image.image : null;
}

/** A graph as a still picture, with its title underneath; a placeholder of the same shape while it draws. */
export const GraphPicture = memo(function GraphPicture({ spec, className }: { spec: GraphSpec; className?: string }) {
  const t = useT();
  const image = useGraphImage(spec);
  const ratio = spec.kind === '3d' ? '4 / 3' : '8 / 5';
  return (
    <figure className={clsx('w-full max-w-2xl', className)}>
      {image?.ok ? (
        <img
          src={pngSrc(image.png)}
          width={image.width}
          height={image.height}
          alt={spec.title || t('graph.alt')}
          className="block h-auto w-full rounded-lg bg-page"
        />
      ) : (
        <div
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-fill text-sm text-muted"
          style={{ aspectRatio: ratio }}
          role={image ? 'alert' : 'status'}
        >
          {image ? (
            <span className="inline-flex max-w-[80%] items-center gap-2 text-danger">
              <TriangleAlert size={16} className="shrink-0" />
              <span>{t('graph.failed', { reason: image.message })}</span>
            </span>
          ) : (
            <>
              <Spinner size={14} /> {t('graph.drawing')}
            </>
          )}
        </div>
      )}
      {spec.title && <figcaption className="mt-1.5 text-sm text-ink-soft">{spec.title}</figcaption>}
    </figure>
  );
});
