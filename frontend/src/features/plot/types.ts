import type { MathJSON } from '@mn/contracts';

export interface PlotSettings {
  x_var: string;
  params: Record<string, number>;
  range: [number, number]; // [min, max]
  points: number; // default 400
  view: 're' | 'im' | 'abs2';
  overlay_ids?: string[];
}

export interface ParamMeta {
  name: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface PlotAnalysis {
  drawable: boolean;
  reason?: string;
  reasonKey?: string;
  xVar: string;
  latex: string;
  targetExpr: MathJSON | null;
  freeSymbols: string[];
  paramsMeta: Record<string, ParamMeta>;
  initialParams: Record<string, number>;
}
