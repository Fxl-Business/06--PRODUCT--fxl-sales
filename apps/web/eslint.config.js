import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022 },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['badgeVariants', 'buttonVariants', 'router'] },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      /**
       * The native picker ban (CLAUDE.md, "UI Controls"). Browser pickers cannot be
       * searched, cannot show a "create new" affordance and cannot be styled to match
       * the app, so this codebase has exactly one single-select control: `Combobox`.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message:
            'Native <select> is banned. Use <Combobox> from @/components/ui/combobox (CLAUDE.md, UI Controls).',
        },
        {
          selector: 'JSXOpeningElement[name.name="datalist"]',
          message:
            'Native <datalist> is banned. Use <Combobox> from @/components/ui/combobox (CLAUDE.md, UI Controls).',
        },
        {
          selector: 'JSXOpeningElement[name.name="option"]',
          message:
            '<option> only exists inside a native picker, which is banned. Use <Combobox> options (CLAUDE.md, UI Controls).',
        },
        {
          selector:
            'JSXOpeningElement[name.name="input"] > JSXAttribute[name.name="type"][value.value="number"]',
          message:
            'Use <Input type="number"> from @/components/ui/input; a raw <input type="number"> renders OS spin buttons.',
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/lib/app-mutation.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@tanstack/react-query',
          importNames: ['useMutation'],
          message:
            'Use useAppMutation from @/lib/app-mutation. It requires an `invalidates` query-key list so a new mutation cannot ship without refreshing the cache it owns.',
        }],
      }],
    },
  },
);
