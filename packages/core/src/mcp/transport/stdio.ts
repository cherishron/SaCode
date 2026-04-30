import EventEmitter from "eventemitter3";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  MCPTransport,
} from "../protocol";
import type {
  TransportState,
  TransportEvents,
  StdioTransportConfig,
  ProcessInfo,
} from "./types";
import { DEFAULT_TRANSPORT_CONFIG } from "./types";

type BunSubprocess = ReturnType<typeof Bun.spawn>;

export class StdioTransport
  extends EventEmitter<TransportEvents>
  implements MCPTransport
{
  private config: StdioTransportConfig;
  private process: BunSubprocess | null = null;
  private buffer: string = "";
  private pendingRequests: Map<
    string | number,
    {
      resolve: (response: JsonRpcResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private state: TransportState = "disconnected";
  private processInfo: ProcessInfo | null = null;

  constructor(config: Partial<StdioTransportConfig> & { command: string }) {
    super();
    this.config = {
      ...DEFAULT_TRANSPORT_CONFIG,
      args: [],
      ...config,
    } as StdioTransportConfig;
  }

  async connect(): Promise<void> {
    if (this.state === "connected") {
      return;
    }

    this.setState("connecting");

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.config.connectTimeout}ms`));
        this.cleanup();
      }, this.config.connectTimeout);

      try {
        this.process = Bun.spawn({
          cmd: [this.config.command, ...this.config.args],
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });

        if (!this.process.pid) {
          throw new Error("Failed to start process");
        }

        this.processInfo = {
          pid: this.process.pid,
          command: this.config.command,
          args: this.config.args,
          startedAt: new Date(),
        };

        this.readStdout();
        this.readStderr();

        this.process.exited.then((code) => {
          clearTimeout(timeout);
          this.setState("disconnected");
          if (code !== 0 && code !== null) {
            const error = new Error(`Process exited with code ${code}`);
            this.emit("error", error);
          }
        }).catch(() => {
          clearTimeout(timeout);
          this.setState("disconnected");
        });

        clearTimeout(timeout);
        this.setState("connected");
        resolve();
      } catch (error) {
        clearTimeout(timeout);
        this.setState("error");
        reject(error);
      }
    });
  }

  private readStdout(): void {
    if (!this.process?.stdout) return;

    const reader = (this.process.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    const readLoop = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.handleData(decoder.decode(value, { stream: true }));
        }
      } catch {
        // 流关闭
      }
    };

    readLoop();
  }

  private readStderr(): void {
    if (!this.process?.stderr) return;

    const reader = (this.process.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    const readLoop = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          console.error(`[MCP Server stderr] ${decoder.decode(value, { stream: true })}`);
        }
      } catch {
        // 流关闭
      }
    };

    readLoop();
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      for (const [id, { reject, timeout }] of this.pendingRequests) {
        clearTimeout(timeout);
        reject(new Error("Transport disconnected"));
      }
      this.pendingRequests.clear();

      this.process.kill();
      this.process = null;
      this.processInfo = null;
    }

    this.setState("disconnected");
  }

  async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.state !== "connected" || !this.process?.stdin) {
      throw new Error("Transport not connected");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout after ${this.config.requestTimeout}ms`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + "\n";
      const writer = (this.process!.stdin as unknown as WritableStream).getWriter();
      writer.write(new TextEncoder().encode(message)).then(() => {
        writer.releaseLock();
      }).catch((error: Error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.id);
        writer.releaseLock();
        reject(error);
      });
    });
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    if (this.state !== "connected" || !this.process?.stdin) {
      throw new Error("Transport not connected");
    }

    const message = JSON.stringify(notification) + "\n";
    const writer = (this.process.stdin as unknown as WritableStream).getWriter();
    try {
      await writer.write(new TextEncoder().encode(message));
    } finally {
      writer.releaseLock();
    }
  }

  getState(): TransportState {
    return this.state;
  }

  getProcessInfo(): ProcessInfo | null {
    return this.processInfo;
  }

  private handleData(data: string): void {
    this.buffer += data;

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
        this.handleMessage(message);
      } catch (error) {
        console.error(`Failed to parse message: ${line}`, error);
      }
    }
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    if ("id" in message) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.resolve(message as JsonRpcResponse);
      }
    } else {
      this.emit("message", message);
    }
  }

  private setState(state: TransportState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit("stateChange", state);
    }
  }

  private cleanup(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.processInfo = null;
    this.buffer = "";
    this.pendingRequests.clear();
    this.setState("disconnected");
  }
}

export function createStdioTransport(
  config: Partial<StdioTransportConfig> & { command: string }
): StdioTransport {
  return new StdioTransport(config);
}
