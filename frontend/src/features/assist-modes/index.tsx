'use client';

// S-02: hint / complete assist modes (spec §14.2). Registered only when `assist_modes` is enabled.
import { Lightbulb, Sparkles } from 'lucide-react';
import { useEngine } from '@/components/notebook/engine-context';
import { useNotebook } from '@/core/store/notebook-store';
import type { FeaturePlugin } from '@/features/types';
import { useT } from '@/i18n';
import { IconButton } from '@/ui/button';

/** Toolbar switch: pressed means hint mode (no completion). */
export function AssistModeSwitch() {
  const t = useT();
  const engine = useEngine();
  const mode = useNotebook((s) => s.assistMode);
  const hint = mode === 'hint';
  return (
    <IconButton
      label={`${t('assist.label')}: ${t(hint ? 'assist.hint' : 'assist.complete')}`}
      active={hint}
      aria-pressed={hint}
      onClick={() => engine.setAssistMode(hint ? 'complete' : 'hint')}
    >
      {hint ? <Lightbulb size={20} /> : <Sparkles size={20} />}
    </IconButton>
  );
}

const assistModes: FeaturePlugin = { id: 'assist_modes', toolbar: [AssistModeSwitch] };
export default assistModes;
