import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// patterns avoid backslashes and "/" (ESLint's selector parser would eat or end on them)
const RAW_DESIGN_VALUE = [
  ['#[0-9a-fA-F]{3,8}|rgba?[(]|hsla?[(]', 'a raw color; use a color token from globals.css (bg-accent, text-muted, …)'],
  ['text-[[][0-9]', 'an arbitrary font size; use the type scale (text-xs … text-4xl)'],
  ['(^|[ :])(bg|text|border|ring|fill|stroke)-(white|black)($|[^-a-z])', 'black or white; use a token (bg-hover, bg-fill, text-on-solid, bg-raised, …)'],
  ['(^|[ :])z-([0-9]|[[])', 'a numeric z-index; use a layer (z-raised, z-sticky, z-overlay, z-popover, …)'],
];

// flags string and template literals in components that contain a raw design value
const DESIGN_TOKEN_RULES = RAW_DESIGN_VALUE.flatMap(([pattern, message]) => [
  { selector: `Literal[value=/${pattern}/]`, message: `Found ${message}.` },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message: `Found ${message}.` },
]);

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'public/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
  {
    rules: {
      // data loading from IndexedDB/Supabase on mount is an intended effect pattern here
      'react-hooks/set-state-in-effect': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // the design system lives in src/app/globals.css: components use its tokens, never raw values
    files: ['src/**/*.tsx'],
    ignores: ['src/components/auth/login-form.tsx'], // the Google logo keeps its brand colors
    rules: {
      'no-restricted-syntax': ['error', ...DESIGN_TOKEN_RULES],
    },
  },
]);
