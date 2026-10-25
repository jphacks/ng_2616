'use client';

// S-02: hint / complete assist modes (spec §14.2). Registered only when `assist_modes` is enabled.
import clsx from 'clsx';
import { Lightbulb } from 'lucide-react';
import { useEngine } from '@/components/notebook/engine-context';
import { useNotebook } from '@/core/store/notebook-store';
import type { FeaturePlugin } from '@/features/types';
import { useT } from '@/i18n';

/** Toolbar switch with a visible label: the lit bulb is hint mode (no completion), the plain one is complete. */
export function AssistModeSwitch() {
  const t = useT();
  const engine = useEngine();
  const mode = useNotebook((s) => s.assistMode);
  const hint = mode === 'hint';
  const name = t(hint ? 'assist.hint' : 'assist.complete');
  return (
    <button
      type="button"
      aria-label={`${t('assist.label')}: ${name}`}
      title={`${t('assist.label')}: ${name}`}
      aria-pressed={hint}
      onClick={() => engine.setAssistMode(hint ? 'complete' : 'hint')}
      className={clsx(
        'inline-flex h-11 select-none items-center gap-1.5 rounded-xl px-3 text-base font-medium transition-colors',
        hint ? 'bg-accent-soft text-accent-strong' : 'text-ink-soft hover:bg-hover',
      )}
    >
      <Lightbulb size={20} />
      <span>{name}</span>
    </button>
  );
}

const assistModes: FeaturePlugin = { id: 'assist_modes', toolbar: [AssistModeSwitch] };
export default assistModes;
