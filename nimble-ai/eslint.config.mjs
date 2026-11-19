import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * ESLint 9 扁平配置。
 * 只做代码质量检查，不管格式（格式用 `npm run format`，这里用 eslint-config-prettier 关掉冲突规则）。
 * 项目里 any 和未使用的解构占位很常见，按警告处理，避免 `npm run lint` 一次改动几百个文件。
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'workspace/**', 'ai/_users/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  prettier,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
