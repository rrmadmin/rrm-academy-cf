/**
 * ESLint config dedicated to quality reporting.
 * Kept separate from eslint.config.js so `npm run lint` is unchanged.
 * complexity is set to 'warn' with a threshold of 1 so EVERY function gets
 * a report entry.
 *
 * TypeScript files in src/lib/ (8 of 16) require @typescript-eslint/parser
 * or they'd be silently skipped by the complexity pass.
 */
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';

const complexityRules = {
  // Report every function regardless of size — threshold 1 = always report
  complexity: ['warn', { max: 1 }],
};

export default [
  js.configs.recommended,
  {
    // JS/MJS files — default espree parser
    files: ['src/lib/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: complexityRules,
  },
  {
    // TS files — typescript-eslint parser, no type-checking (fast)
    files: ['src/lib/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: complexityRules,
  },
];
