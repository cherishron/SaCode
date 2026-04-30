import chalk from "chalk";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface StartOptions {
  port: string;
  host: string;
  api?: boolean;
  web?: boolean;
}

type BunSubprocess = ReturnType<typeof Bun.spawn>;

let apiProcess: BunSubprocess | null = null;
let webProcess: BunSubprocess | null = null;

export async function startServer(options: StartOptions): Promise<void> {
  const { port, host } = options;

  console.log(chalk.cyan("\n[SACODE] Starting Server\n"));
  console.log(`  Host: ${chalk.green(host)}`);
  console.log(`  Port: ${chalk.green(port)}`);
  console.log();

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
    console.log(chalk.green(`[NET] API Server:  http://${host}:${port}`));
  }
  if (startWeb) {
    console.log(chalk.green(`[NET] Web UI:      http://${host}:5173`));
  }
  console.log(chalk.cyan("═══════════════════════════════════════"));
  console.log(chalk.gray("\nPress Ctrl+C to stop all services\n"));

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function startApiServer(host: string, port: string): Promise<void> {
  const apiPackagePath = path.join(__dirname, "../../api");

  console.log(chalk.gray("Starting API server..."));

  apiProcess = Bun.spawn({
    cmd: ["bun", "run", "src/server.ts"],
    cwd: apiPackagePath,
    env: { ...process.env, PORT: port, HOST: host },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  await new Promise<void>((resolve, reject) => {
    apiProcess!.exited.then((code) => {
      if (code !== 0) {
        reject(new Error(`API server exited with code ${code}`));
      }
    }).catch(reject);

    setTimeout(() => {
      console.log(chalk.green("+ API server started\n"));
      resolve();
    }, 2000);
  });
}

async function startWebServer(host: string, port: number): Promise<void> {
  const webPackagePath = path.join(__dirname, "../../web");

  console.log(chalk.gray("Starting Web UI (Vite preview)..."));

  webProcess = Bun.spawn({
    cmd: ["bun", "run", "vite", "preview", "--port", port.toString(), "--host", host],
    cwd: webPackagePath,
    env: { ...process.env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      console.log(chalk.green("+ Web UI started\n"));
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
