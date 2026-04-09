/**
 * Bun 构建脚本
 */

await Bun.build({
  entrypoints: ["src/index.ts", "src/cli.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "external",
  // 外部依赖 - 这些包不会被打包进 dist
  external: [
    "react-devtools-core",
    // Workspace 依赖
    "@SACODE/core",
  ],
  // 定义环境变量
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  // 压缩
  minify: false,
  // 分割代码
  splitting: true,
});

console.log("Build completed!");

/**
 * Production single-executable build (optional):
 * Run: bun build src/cli.ts --compile --outfile sacode --minify --sourcemap
 * This creates a standalone executable with React pre-bundled for ~80ms startup.
 */
