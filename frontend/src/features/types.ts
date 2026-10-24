import type { ComponentType } from 'react';
import type { Feature, Line } from '@mn/contracts';

/**
 * Contract for Should/Could plug-ins (spec §2.2–2.3). Core renders these slots but never imports
 * a feature module directly; only the generated registry does. A disabled feature registers
 * nothing, and lines it created earlier stay readable.
 */
export interface FeaturePlugin {
  id: Feature;
  /** extra buttons in the floating toolbar */
  toolbar?: ComponentType[];
  /** actions next to a settled line (e.g. "Plot", "Prove with Lean") */
  lineActions?: ComponentType<{ line: Line }>[];
  /** panels opened from the top bar */
  panels?: { id: string; title: string; component: ComponentType }[];
}
