// Lint: typescript-eslint's recommended rules over the packages, the web app, tests and scripts.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'apps/web/.next/**', 'apps/web/.pages-build/**', 'public/**', 'apps/web/next-env.d.ts', '.demo/**', '.loom/**', '.pnpm-store/**', 'receipts/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Destructuring a field out to drop it (const { hash, signature, ...input } = receipt) is the idiom here.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },
);
