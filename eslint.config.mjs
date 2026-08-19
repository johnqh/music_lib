import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import globals from 'globals';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      prettier: prettier,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      // Formatting is prettier's job; `prettierConfig` switches off the lint
      // rules that would argue with it. Same wiring as `sudojo_lib`.
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      /**
       * Off, not 'warn'.
       *
       * The codebase uses `!` deliberately after an invariant the compiler
       * cannot see (a length check, a just-inserted row, a lookup whose key
       * was built from the same collection) — roughly 200 times. As a warning
       * it produced 200 lines of output that buried every other warning,
       * which is the opposite of what a lint run is for. Turning it off makes
       * the remaining warnings visible; the alternative is rewriting 200 call
       * sites for no behavioural gain.
       */
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
