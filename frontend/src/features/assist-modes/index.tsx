'use client';

// S-02: hint / complete assist modes (spec §14.2). Registered only when `assist_modes` is enabled.
import clsx from 'clsx';
import { Lightbulb, LightbulbOff } from 'lucide-react';
import { useEngine } from '@/components/notebook/engine-context';
import type { AssistMode } from '@/core/candidates/blocker';
import { useNotebook } from '@/core/store/notebook-store';
import type { FeaturePlugin } from '@/features/types';
import { useT } from '@/i18n';

/** Each press goes to the next mode: complete, then hint, then off, then complete again. */
const NEXT: Record<AssistMode, AssistMode> = { complete: 'hint', hint: 'off', off: 'complete' };

/** Toolbar switch with a visible label naming the current mode. */
export function AssistModeSwitch() {
  const t = useT();
  const engine = useEngine();
  const mode = useNotebook((s) => s.assistMode);
  const name = t(`assist.${mode}`);
  return (
    <button
      type="button"
      aria-label={`${t('assist.label')}: ${name}`}
      title={`${t('assist.label')}: ${name}`}
      aria-pressed={mode !== 'complete'}
      onClick={() => engine.setAssistMode(NEXT[mode])}
      className={clsx(
        'inline-flex h-11 select-none items-center gap-1.5 rounded-xl px-3 text-base font-medium transition-colors',
        mode === 'hint' ? 'bg-accent-soft text-accent-strong' : 'text-ink-soft hover:bg-hover',
        mode === 'off' && 'text-muted',
      )}
    >
      {mode === 'off' ? <LightbulbOff size={20} /> : <Lightbulb size={20} />}
      <span>{name}</span>
    </button>
  );
}

const assistModes: FeaturePlugin = { id: 'assist_modes', toolbar: [AssistModeSwitch] };
export default assistModes;
