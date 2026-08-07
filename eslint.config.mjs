import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // `scripts/*.js` joins `cli/**` here for the same reason: plain Node developer scripts, run
  // directly rather than bundled, so the browser globals this config assumes do not apply.
  // The ignore is deliberately narrowed to `.js`: `scripts/repair-config-maps.ts` is a shipped
  // operator entry point (`npm run repair:config-maps`) for the schema-94 config-map repair, not a
  // developer convenience, and it is linted and typechecked like the rest of the TypeScript.
  //
  // `dist` is `**/dist/**` rather than `dist/**` because flat-config ignore patterns are anchored at
  // the config file's directory: `dist/**` matches the root build output only and leaves `api/dist/`
  // linted, so a local `npm run api:build` adds 43 errors that CI never sees. No tracked file has a
  // `dist` path segment, so the recursive form excludes nothing real.
  {
    ignores: [
      '**/dist/**',
      'dist-electron/**',
      'release/**',
      'docs/**',
      'native/**',
      'cli/**',
      'scripts/**/*.js',
      'solidworks-service/**',
      'node_modules/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['electron/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // A command-line tool's stdout is its output, not stray debugging, and these scripts have no
  // logger to route it through — `log.*` is an app and API facility. The rest of the ruleset,
  // including the type-safety rules, still applies.
  {
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
