'use client';

import { createContext, useContext } from 'react';
import type { NotebookEngine } from '@/core/engine';

export const EngineContext = createContext<NotebookEngine | null>(null);

export function useEngine(): NotebookEngine {
  const e = useContext(EngineContext);
  if (!e) throw new Error('useEngine outside a notebook');
  return e;
}
