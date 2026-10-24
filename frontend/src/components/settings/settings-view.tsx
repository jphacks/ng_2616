'use client';

import { SCHEMA_VERSION, type UiLang } from '@mn/contracts';
import { Switch } from '@base-ui/react/switch';
import clsx from 'clsx';
import { ChevronLeft, Download } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { DEV_BYPASS, useSessionUser } from '@/core/auth/browser';
import { getRepository, isCloudUnavailable } from '@/core/persistence/repo';
import { useDevicePrefs, type InkWeight, type InputMode, type ToolbarSide } from '@/core/prefs/device';
import { useLocale, useT } from '@/i18n';
import { AccountMenu } from '@/components/account/account-menu';
import { Button } from '@/ui/button';
import { Spinner } from '@/ui/spinner';

const INPUT_MODES: InputMode[] = ['auto', 'pen', 'touch'];

export function SettingsView() {
  const t = useT();
  const { user, loading } = useSessionUser();
  const { locale, setLocale } = useLocale();
  const device = useDevicePrefs();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  const local = DEV_BYPASS || isCloudUnavailable();

  const exportAll = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const repo = getRepository(user.id);
      const summaries = await repo.list();
      const notebooks = [];
      for (const s of summaries) {
        const res = await repo.load(s.id);
        if (res) notebooks.push(res.notebook);
      }
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), schema_version: SCHEMA_VERSION, notebooks }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `math-notebooks-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setExportError(t('settings.exportFailed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-border bg-paper/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur">
        <Link href="/notebooks" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-[15px] text-ink-soft hover:bg-black/5">
          <ChevronLeft size={20} aria-hidden />
          {t('top.notebooks')}
        </Link>
        <h1 className="flex-1 text-center text-[16px] font-semibold">{t('settings.title')}</h1>
        <AccountMenu user={user} />
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <Section title={t('settings.account')}>
          <Row label={t('settings.email')}>
            <span className="truncate text-ink-soft">{user.email}</span>
          </Row>
          <Row label={t('settings.storage')}>
            <span className="text-ink-soft">{t(local ? 'account.storage.local' : 'account.storage.cloud')}</span>
          </Row>
        </Section>

        <Section title={t('settings.language')}>
          <Choices
            label={t('settings.language')}
            value={locale}
            onChange={(v) => setLocale(v as UiLang)}
            options={[
              { value: 'en', label: t('lang.en') },
              { value: 'ja', label: t('lang.ja') },
            ]}
          />
        </Section>

        <Section title={t('settings.writing')}>
          <div>
            <div aria-hidden className="px-5 pt-4 text-[13px] font-medium text-muted">
              {t('settings.input')}
            </div>
            <Choices
              label={t('settings.input')}
              value={device.inputMode}
              onChange={(v) => device.setPref('inputMode', v as InputMode)}
              options={INPUT_MODES.map((m) => ({ value: m, label: t(`settings.input.${m}`), description: t(`settings.input.${m}Desc`) }))}
            />
          </div>
          <Row label={t('settings.ink')}>
            <Segmented
              label={t('settings.ink')}
              value={device.inkWeight}
              onChange={(v) => device.setPref('inkWeight', v as InkWeight)}
              options={(['thin', 'medium', 'thick'] as const).map((w) => ({ value: w, label: t(`ink.${w}`) }))}
            />
          </Row>
          <Row label={t('settings.toolbar')}>
            <Segmented
              label={t('settings.toolbar')}
              value={device.toolbarSide}
              onChange={(v) => device.setPref('toolbarSide', v as ToolbarSide)}
              options={(['left', 'center', 'right'] as const).map((w) => ({ value: w, label: t(`settings.toolbar.${w}`) }))}
            />
          </Row>
          <Toggle
            label={t('settings.scratch')}
            description={t('settings.scratchDesc')}
            checked={device.scratchToErase}
            onChange={(v) => device.setPref('scratchToErase', v)}
          />
          <Toggle
            label={t('settings.autoConfirm')}
            description={t('settings.autoConfirmDesc')}
            checked={device.autoConfirm}
            onChange={(v) => device.setPref('autoConfirm', v)}
          />
        </Section>

        <Section title={t('settings.data')}>
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{t('settings.export')}</div>
              <div className="text-[13px] text-pretty text-muted">{t('settings.exportDesc')}</div>
              {exportError && (
                <div role="alert" className="mt-1 text-[13px] text-wrong-strong">
                  {exportError}
                </div>
              )}
            </div>
            <Button icon={exporting ? <Spinner /> : <Download size={17} aria-hidden />} disabled={exporting} onClick={() => void exportAll()}>
              {t(exporting ? 'settings.exporting' : 'settings.exportButton')}
            </Button>
          </div>
        </Section>

        <Section title={t('settings.about')}>
          <Row label={t('app.name')}>
            <span className="text-ink-soft tabular-nums">{t('settings.format', { v: SCHEMA_VERSION })}</span>
          </Row>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-3xl bg-sheet shadow-card">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-4 px-5 py-3 text-[15px]">
      <span className="shrink-0 font-medium">{label}</span>
      <span className="flex min-w-0 flex-1 justify-end">{children}</span>
    </div>
  );
}

/** Native radio group styled as a list; keyboard and screen readers work as for any radio. */
function Choices({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; description?: string }[];
}) {
  const name = useId();
  return (
    <fieldset className="divide-y divide-border">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex min-h-14 cursor-pointer items-center gap-4 px-5 py-3 hover:bg-black/[0.02]">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">{o.label}</span>
            {o.description && <span className="block text-[13px] text-pretty text-muted">{o.description}</span>}
          </span>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="peer sr-only" />
          <span
            aria-hidden
            className={clsx(
              'flex size-5 shrink-0 items-center justify-center rounded-full ring-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
              value === o.value ? 'bg-accent ring-accent' : 'ring-border',
            )}
          >
            {value === o.value && <span className="size-2 rounded-full bg-white" />}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A short set of options side by side, as native radios. */
function Segmented({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const name = useId();
  return (
    <fieldset className="inline-flex rounded-xl bg-black/[0.05] p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={clsx(
            'relative flex min-h-9 cursor-pointer items-center rounded-lg px-3 text-[14px] font-medium has-focus-visible:outline-2 has-focus-visible:outline-accent',
            value === o.value ? 'bg-sheet text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-4 px-5 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="block text-[13px] text-pretty text-muted">{description}</span>}
      </span>
      <Switch.Root
        checked={checked}
        onCheckedChange={onChange}
        className="flex h-7 w-12 shrink-0 rounded-full bg-black/10 p-0.5 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 data-checked:bg-accent"
      >
        <Switch.Thumb className="size-6 rounded-full bg-white shadow-card transition-transform duration-150 data-checked:translate-x-5" />
      </Switch.Root>
    </label>
  );
}
