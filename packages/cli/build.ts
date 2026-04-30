/**
 * Bun 构建脚本 - 独立包模式
 * 
 * 所有 workspace 依赖内联打包，生成可独立发布的 npm 包。
 */

await Bun.build({
  entrypoints: ["src/index.ts", "src/cli.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "external",
  // 外部依赖 - 这些包不会被打包进 dist（运行时从 node_modules 解析）
  external: [
    "react-devtools-core",
    // 原生模块 - 不能被 Bun 打包
    "playwright",
    "better-sqlite3",
    // Bun 内置模块
    "bun",
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
