import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '*.tsbuildinfo'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Fabric.js has no useful types for the bits we touch (custom `objectId`
      // on objects, brush subclasses), so `any` is load-bearing in canvas/.
      '@typescript-eslint/no-explicit-any': 'off',

      // Warn, don't fail — unused vars are a cleanup task, not a broken build.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Config files run in Node, not the browser.
    files: ['*.config.{js,ts}', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: { globals: globals.node },
  }
);
