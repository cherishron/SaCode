// Web 工作台静态检查配置（ESLint flat config）。
// 服务端与测试为 Node 环境，src 下为浏览器环境，Vue SFC 走 eslint-plugin-vue。
// 格式化规则统一交给 Prettier（eslint-config-prettier 关闭冲突项），避免双重约束。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import prettierRecommended from 'eslint-config-prettier';
import globals from 'globals';

const tsFiles = ['server/**/*.ts', 'src/**/*.ts', 'test/**/*.ts', 'contracts/**/*.ts'];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'screenshots/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  prettierRecommended,
  {
    files: tsFiles,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      // 允许“先声明、闭包捕获后再赋值”的延迟绑定（如 SSE 订阅 id 在连接创建后置值）。
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser },
      // Vue SFC 由 vue-eslint-parser 解析，<script setup lang="ts"> 再交给 TS parser。
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 测试用例里允许非空的异步副作用编排，不强制每次都 await。
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    files: ['**/*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['test/helpers/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
