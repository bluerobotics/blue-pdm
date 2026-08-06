import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // `scripts/**` joins `cli/**` here for the same reason: plain Node developer scripts, run
  // directly rather than bundled, so the browser globals this config assumes do not apply.
  { ignores: ['dist/**', 'dist-electron/**', 'release/**', 'docs/**', 'native/**', 'cli/**', 'scripts/**', 'solidworks-service/**', 'node_modules/**'] },

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
)
