import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import { defineConfig, globalIgnores } from 'eslint/config';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    plugins: { perfectionist },
    rules: {
      curly: 'error',
      eqeqeq: 'error',
      'no-console': 'warn',
      'perfectionist/sort-imports': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-interfaces': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-named-exports': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-named-imports': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-objects': ['error', { order: 'asc', type: 'alphabetical' }],
      // Advisory perf rule; our data-load and derive-from-props effects are intentional.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
