import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // 组件测试不应把 /public 中的浏览器绝对资源 URL 解析为 Windows 文件 URL。
  plugins: [vue({ template: { transformAssetUrls: false } })],
  test: {
    environment: 'node',
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/integration/real-daemon.spec.ts',
    ],
    exclude: ['test/e2e/**', 'node_modules/**'],
    testTimeout: 15000,
    pool: 'forks',
  },
});
