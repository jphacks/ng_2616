'use client';

import clsx from 'clsx';
import { BookOpen, FileText, NotebookText, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ResourceKind, ResourceRecord } from '@/core/resources/db';
import { listResources, removeResource } from '@/core/resources/service';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { ResourceViewer } from './resource-viewer';
import { UploadSheet } from './upload-sheet';

export const KIND_ICON: Record<ResourceKind, typeof FileText> = { problem_sheet: FileText, textbook: BookOpen, notes: NotebookText };

/** Full-screen Resources tab: what the AI reads as context (NotebookLM-style sources). */
export function ResourcesView({ ownerId }: { ownerId: string }) {
  const t = useT();
  const notebookId = useNotebook((s) => s.notebook!.id);
  const [items, setItems] = useState<ResourceRecord[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listResources(ownerId, notebookId);
    setItems(list);
    setSelected((cur) => (cur && list.some((r) => r.id === cur) ? cur : (list[0]?.id ?? null)));
  }, [ownerId, notebookId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = items?.find((r) => r.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[19rem] shrink-0 flex-col border-r border-border bg-paper max-md:w-56">
        <div className="space-y-1 px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold">{t('res.title')}</h2>
          <p className="text-[13px] leading-snug text-muted">{t('res.subtitle')}</p>
        </div>
        <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {items?.map((r) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <div
                key={r.id}
                className={clsx('group flex min-h-16 items-center gap-1 rounded-2xl pr-1 transition-colors', r.id === selected ? 'bg-sheet shadow-card' : 'hover:bg-black/[0.04]')}
              >
                <button type="button" onClick={() => setSelected(r.id)} aria-pressed={r.id === selected} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Icon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{r.name}</span>
                    <span className="block text-[12px] text-muted">
                      {t(`res.kind.${r.kind}`)} · {r.builtin ? t('res.builtin') : t('res.pages', { n: r.pages.length })}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('res.delete')}
                  onClick={async () => {
                    if (!window.confirm(t('res.deleteConfirm', { name: r.name }))) return;
                    await removeResource(ownerId, r.id);
                    void refresh();
                  }}
                  // touch screens have no hover: always shown on the selected resource
                  className={clsx(
                    'h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-black/5',
                    r.id === selected ? 'inline-flex' : 'hidden group-hover:inline-flex',
                  )}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
          {items?.length === 0 && <p className="px-3 py-6 text-center text-[14px] text-muted">{t('res.empty')}</p>}
        </div>
        <div className="border-t border-border p-3">
          <Button variant="primary" className="w-full" icon={<Plus size={18} />} onClick={() => setUploading(true)}>
            {t('res.upload')}
          </Button>
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        {current ? (
          <ResourceViewer key={current.id} ownerId={ownerId} resource={current} onChanged={refresh} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-muted">
            <BookOpen size={36} className="text-faint" />
            <p className="max-w-sm text-[15px]">{t('res.empty')}</p>
            <Button icon={<Plus size={18} />} onClick={() => setUploading(true)}>
              {t('res.upload')}
            </Button>
          </div>
        )}
      </section>
      <UploadSheet
        open={uploading}
        ownerId={ownerId}
        notebookId={notebookId}
        onClose={() => setUploading(false)}
        onImported={(r) => {
          setUploading(false);
          void refresh().then(() => setSelected(r.id));
        }}
      />
    </div>
  );
}
