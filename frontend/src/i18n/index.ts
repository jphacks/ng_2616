'use client';

import type { UiLang } from '@mn/contracts';
import { useCallback } from 'react';
import { create } from 'zustand';
import { en, type MessageKey } from './en';
import { ja } from './ja';

export type { MessageKey };
export type Vars = Record<string, string | number>;

const DICTS: Record<UiLang, Partial<Record<MessageKey, string>>> = { en, ja };
const STORAGE_KEY = 'mn.locale';

export function translate(locale: UiLang, key: string, vars?: Vars): string {
  const template = DICTS[locale][key as MessageKey] ?? en[key as MessageKey] ?? key;
  return vars ? template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : template;
}

export const useLocale = create<{ locale: UiLang; setLocale: (l: UiLang) => void }>((set) => ({
  locale: 'en',
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // storage can be unavailable (private mode); the toggle still works for this tab
    }
    document.documentElement.lang = locale;
    set({ locale });
  },
}));

/** Stored preference, else the browser language. Runs after hydration to avoid mismatches. */
export function initLocale() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const locale: UiLang = stored === 'ja' || stored === 'en' ? stored : navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  useLocale.getState().setLocale(locale);
}

export function useT() {
  const locale = useLocale((s) => s.locale);
  return useCallback((key: MessageKey | string, vars?: Vars) => translate(locale, key, vars), [locale]);
}

export const currentLocale = () => useLocale.getState().locale;
export const t = (key: MessageKey | string, vars?: Vars) => translate(currentLocale(), key, vars);
