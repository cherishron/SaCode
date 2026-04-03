import chalk from "chalk";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface StartOptions {
  port: string;
  host: string;
  api?: boolean;
  web?: boolean;
}

// 存储子进程引用
let apiProcess: ReturnType<typeof spawn> | null = null;
let webProcess: ReturnType<typeof spawn> | null = null;

export async function startServer(options: StartOptions): Promise<void> {
  const { port, host } = options;

  console.log(chalk.cyan("\n🚀 Starting SACODE Server\n"));
  console.log(`  Host: ${chalk.green(host)}`);
  console.log(`  Port: ${chalk.green(port)}`);
  console.log();

  // 确定启动哪些服务
  const startApi = options.api || !options.web;
  const startWeb = options.web || !options.api;

  if (startApi) {
    await startApiServer(host, port);
  }

  if (startWeb) {
    await startWebServer(host, 5173);
  }

  console.log();
  console.log(chalk.cyan("═══════════════════════════════════════"));
  if (startApi) {
    console.log(chalk.green(`📡 API Server:  http://${host}:${port}`));
  }
  if (startWeb) {
    console.log(chalk.green(`🌐 Web UI:      http://${host}:5173`));
  }
  console.log(chalk.cyan("═══════════════════════════════════════"));
  console.log(chalk.gray("\nPress Ctrl+C to stop all services\n"));

  // 监听退出信号
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function startApiServer(host: string, port: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const apiPackagePath = path.join(__dirname, "../../api");
    
    console.log(chalk.gray("Starting API server..."));
    
    // 使用 tsx 运行源码
    apiProcess = spawn("npx", ["tsx", "src/server.ts"], {
      stdio: "inherit",
      cwd: apiPackagePath,
      env: { ...process.env, PORT: port, HOST: host },
    });

    apiProcess.on("error", (err) => {
      console.error(chalk.red("Failed to start API server:"), err.message);
      reject(err);
    });

    apiProcess.on("spawn", () => {
      console.log(chalk.green("✓ API server started\n"));
      resolve();
    });
  });
}

async function startWebServer(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // 使用 Vite preview 模式启动
    const webPackagePath = path.join(__dirname, "../../web");
    
    console.log(chalk.gray("Starting Web UI (Vite preview)..."));
    
    webProcess = spawn("npx", ["vite", "preview", "--port", port.toString(), "--host", host], {
      stdio: "inherit",
      cwd: webPackagePath,
      env: { ...process.env },
    });

    webProcess.on("error", (err) => {
      console.error(chalk.red("Failed to start Web UI:"), err.message);
      reject(err);
    });

    // Vite preview 启动需要一点时间
    setTimeout(() => {
      console.log(chalk.green("✓ Web UI started\n"));
      resolve();
    }, 3000);
  });
}

function cleanup(): void {
  console.log(chalk.yellow("\nShutting down all services..."));

  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }

  if (webProcess) {
    webProcess.kill();
    webProcess = null;
  }

  console.log(chalk.green("All services stopped"));
  process.exit(0);
}
