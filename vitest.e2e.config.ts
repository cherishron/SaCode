/**
 * E2E 测试配置
 * 端到端测试的配置文件
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000, // E2E 测试需要更长超时
    hookTimeout: 30000,
    retries: 2, // E2E 测试允许重试
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/e2e/**/*.test.ts"],
    reporters: ["default", "html"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage-e2e",
    },
  },
});
