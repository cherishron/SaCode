/**
 * Stdio 传输层实现
 *
 * 通过标准输入/输出与子进程通信
 */

import { spawn, type ChildProcess } from "child_process";
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

/**
 * Stdio 传输层
 *
 * 通过标准输入/输出与子进程进行 MCP 通信
 *
 * @example
 * ```typescript
 * const transport = new StdioTransport({
 *   command: "node",
 *   args: ["mcp-server.js"],
 * });
 *
 * await transport.connect();
 * const response = await transport.sendRequest({
 *   jsonrpc: "2.0",
 *   id: 1,
 *   method: "tools/list",
 * });
 * ```
 */
export class StdioTransport
  extends EventEmitter<TransportEvents>
  implements MCPTransport
{
  private config: StdioTransportConfig;
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private pendingRequests: Map<
    string | number,
    {
      resolve: (response: JsonRpcResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
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

  /**
   * 连接到子进程
   */
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
        // 启动子进程
        this.process = spawn(this.config.command, this.config.args, {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        if (!this.process.pid) {
          throw new Error("Failed to start process");
        }

        // 记录进程信息
        this.processInfo = {
          pid: this.process.pid,
          command: this.config.command,
          args: this.config.args,
          startedAt: new Date(),
        };

        // 设置数据处理
        this.process.stdout?.on("data", (data: Buffer) => {
          this.handleData(data);
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          // stderr 用于日志输出，不影响协议
          console.error(`[MCP Server stderr] ${data.toString()}`);
        });

        this.process.on("error", (error: Error) => {
          clearTimeout(timeout);
          this.setState("error");
          this.emit("error", error);
          reject(error);
        });

        this.process.on("exit", (code, signal) => {
          clearTimeout(timeout);
          this.setState("disconnected");
          if (code !== 0 && code !== null) {
            const error = new Error(`Process exited with code ${code}, signal ${signal}`);
            this.emit("error", error);
          }
        });

        // 连接成功
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

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.process) {
      // 拒绝所有待处理的请求
      for (const [id, { reject, timeout }] of this.pendingRequests) {
        clearTimeout(timeout);
        reject(new Error("Transport disconnected"));
      }
      this.pendingRequests.clear();

      // 终止进程
      this.process.kill();
      this.process = null;
      this.processInfo = null;
    }

    this.setState("disconnected");
  }

  /**
   * 发送请求
   */
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

      // 发送请求（每个消息以换行符结尾）
      const message = JSON.stringify(request) + "\n";
      this.process?.stdin?.write(message, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(request.id);
          reject(error);
        }
      });
    });
  }

  /**
   * 发送通知
   */
  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    if (this.state !== "connected" || !this.process?.stdin) {
      throw new Error("Transport not connected");
    }

    return new Promise((resolve, reject) => {
      const message = JSON.stringify(notification) + "\n";
      this.process?.stdin?.write(message, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 获取传输层状态
   */
  getState(): TransportState {
    return this.state;
  }

  /**
   * 获取进程信息
   */
  getProcessInfo(): ProcessInfo | null {
    return this.processInfo;
  }

  /**
   * 处理接收到的数据
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // 按换行符分割消息
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? ""; // 保留最后一个不完整的行

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

  /**
   * 处理消息
   */
  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    // 检查是否为响应
    if ("id" in message) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.resolve(message as JsonRpcResponse);
      }
    } else {
      // 通知消息
      this.emit("message", message);
    }
  }

  /**
   * 设置状态
   */
  private setState(state: TransportState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit("stateChange", state);
    }
  }

  /**
   * 清理资源
   */
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

/**
 * 创建 Stdio 传输层实例
 */
export function createStdioTransport(
  config: Partial<StdioTransportConfig> & { command: string }
): StdioTransport {
  return new StdioTransport(config);
}
