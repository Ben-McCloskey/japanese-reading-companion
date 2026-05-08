// ESLint flat config (required by ESLint v9). The repo has the older
// split @typescript-eslint packages, so we wire the parser + plugin
// manually rather than pulling in the unified `typescript-eslint`
// helper package. Rules are kept conservative: any rule that would
// generate large numbers of pre-existing violations is downgraded to
// warn or off, since this is the first lint pass after a long period
// without one.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      'out/**',
      'release/**',
      'node_modules/**',
      'ios/**',
      'eslint.config.mjs',
      '**/*.d.ts',
      'src/platform/shims/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
        // Vite-injected build constant. Defined in vite.web.config.ts +
        // electron.vite.config.ts via `define:`.
        __APP_VERSION__: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // typescript-eslint recommended set, applied manually because flat
      // config doesn't extend like the legacy `extends:` array.
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // TypeScript already validates identifier resolution. The base
      // `no-undef` rule double-reports browser-only types
      // (SpeechSynthesisVoice etc.) and JSX-runtime React, even though
      // they're well-typed. Disable it on TS files; tsc is the source
      // of truth.
      'no-undef': 'off',

      // React 17+ JSX runtime — no need to import React just to use JSX.
      'react/react-in-jsx-scope': 'off',
      // We're on TypeScript; PropTypes are redundant.
      'react/prop-types': 'off',

      // Allow underscore-prefixed unused vars (signal for "intentionally
      // unused" — destructured props we want to keep documenting, etc.).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // CLAUDE.md says no `any` without a justifying comment. The
      // recommended set already flags this, but we keep it as an error.
      '@typescript-eslint/no-explicit-any': 'error',

      // The codebase routinely uses `void promise` to fire-and-forget
      // mutations from event handlers — not floating promises. The
      // unbound-method rule fights React idioms. Both downgraded.
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/unbound-method': 'off',

      // Don't fight the `as unknown as Foo` escape hatch we use for
      // sax's untyped ENTITIES bag and a couple of similar cases —
      // they're all annotated.
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },

  // Tests can use any-typed mocks freely.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Vite/Capacitor config files run in a Node context and aren't part
  // of the app bundle.
  {
    files: ['*.config.{ts,js,mjs}', '*.config.*.{ts,js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
