/**
 * SACODE Container Module - 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ContainerManager,
  Container,
  DockerRunner,
  ContainerError,
  ContainerNotFoundError,
  ContainerRuntimeError,
  ContainerTimeoutError,
  createContainerManager,
  ContainerConfigSchema,
  ContainerStateSchema,
} from "../index";

// ============================================================================
// Mocks
// ============================================================================

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock execa
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// ============================================================================
// Schema Tests
// ============================================================================

describe("ContainerConfigSchema", () => {
  it("should parse valid config", () => {
    const config = ContainerConfigSchema.parse({
      name: "test-container",
      image: "node:22-alpine",
      workingDir: "/app",
    });

    expect(config.name).toBe("test-container");
    expect(config.image).toBe("node:22-alpine");
    expect(config.autoRemove).toBe(true); // default
  });

  it("should apply defaults", () => {
    const config = ContainerConfigSchema.parse({});
    expect(config.image).toBe("node:22-alpine");
    expect(config.workingDir).toBe("/app");
    expect(config.autoRemove).toBe(true);
    expect(config.timeout).toBe(300000);
  });

  it("should validate env as record", () => {
    const config = ContainerConfigSchema.parse({
      env: { NODE_ENV: "production", DEBUG: "true" },
    });
    expect(config.env).toEqual({ NODE_ENV: "production", DEBUG: "true" });
  });

  it("should reject invalid config", () => {
    expect(() => ContainerConfigSchema.parse({ memory: 123 })).toThrow();
  });
});

describe("ContainerStateSchema", () => {
  it("should accept valid states", () => {
    const states = ["created", "running", "paused", "exited", "dead"];
    for (const state of states) {
      expect(ContainerStateSchema.parse(state)).toBe(state);
    }
  });

  it("should reject invalid states", () => {
    expect(() => ContainerStateSchema.parse("invalid")).toThrow();
  });
});

// ============================================================================
// Error Classes Tests
// ============================================================================

describe("ContainerError", () => {
  it("should create error with code and details", () => {
    const error = new ContainerError("Test error", "TEST_CODE", { foo: "bar" });
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_CODE");
    expect(error.details).toEqual({ foo: "bar" });
    expect(error.name).toBe("ContainerError");
  });
});

describe("ContainerNotFoundError", () => {
  it("should create error with container id", () => {
    const error = new ContainerNotFoundError("container-123");
    expect(error.message).toBe("容器 container-123 未找到");
    expect(error.code).toBe("CONTAINER_NOT_FOUND");
    expect(error.details).toEqual({ containerId: "container-123" });
  });
});

describe("ContainerRuntimeError", () => {
  it("should create runtime error", () => {
    const error = new ContainerRuntimeError("Runtime failed", { stderr: "error" });
    expect(error.message).toBe("Runtime failed");
    expect(error.code).toBe("RUNTIME_ERROR");
  });
});

describe("ContainerTimeoutError", () => {
  it("should create timeout error", () => {
    const error = new ContainerTimeoutError("container-123", 30000);
    expect(error.message).toContain("执行超时");
    expect(error.code).toBe("TIMEOUT");
    expect(error.details).toEqual({ containerId: "container-123", timeout: 30000 });
  });
});

// ============================================================================
// DockerRunner Tests
// ============================================================================

describe("DockerRunner", () => {
  let runner: DockerRunner;
  let execaMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    runner = new DockerRunner({ logger: mockLogger });
    const { execa } = await import("execa");
    execaMock = execa as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("isAvailable", () => {
    it("should return true when docker is available", async () => {
      execaMock.mockResolvedValue({ exitCode: 0 });
      const result = await runner.isAvailable();
      expect(result).toBe(true);
    });

    it("should return false when docker is not available", async () => {
      execaMock.mockRejectedValue(new Error("Docker not found"));
      const result = await runner.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("pullImage", () => {
    it("should pull image successfully", async () => {
      execaMock.mockResolvedValue({ exitCode: 0 });
      await runner.pullImage("node:22-alpine");
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        ["pull", "node:22-alpine"],
        expect.any(Object)
      );
    });

    it("should throw error on pull failure", async () => {
      execaMock.mockResolvedValue({ exitCode: 1, stderr: "pull error" });
      await expect(runner.pullImage("invalid:image")).rejects.toThrow(ContainerRuntimeError);
    });
  });

  describe("createContainer", () => {
    it("should create container with basic config", async () => {
      execaMock.mockResolvedValue({ exitCode: 0, stdout: "container-123" });
      const id = await runner.createContainer({
        image: "node:22-alpine",
        name: "test-container",
      });
      expect(id).toBe("container-123");
    });

    it("should create container with env and ports", async () => {
      execaMock.mockResolvedValue({ exitCode: 0, stdout: "container-456" });
      const id = await runner.createContainer({
        image: "nginx",
        env: { NODE_ENV: "production" },
        ports: ["8080:80"],
      });
      expect(id).toBe("container-456");
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["-e", "NODE_ENV=production", "-p", "8080:80"]),
        expect.any(Object)
      );
    });
  });

  describe("startContainer", () => {
    it("should start container", async () => {
      execaMock.mockResolvedValue({ exitCode: 0 });
      await runner.startContainer("container-123");
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        ["start", "container-123"],
        expect.any(Object)
      );
    });
  });

  describe("stopContainer", () => {
    it("should stop container with default timeout", async () => {
      execaMock.mockResolvedValue({ exitCode: 0 });
      await runner.stopContainer("container-123");
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        ["stop", "-t", "10", "container-123"],
        expect.any(Object)
      );
    });

    it("should stop container with custom timeout", async () => {
      execaMock.mockResolvedValue({ exitCode: 0 });
      await runner.stopContainer("container-123", 30);
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        ["stop", "-t", "30", "container-123"],
        expect.any(Object)
      );
    });
  });

  describe("removeContainer", () => {
    it("should remove container", async () => {
      execaMock.mockResolvedValue({ exitCode: 0 });
      await runner.removeContainer("container-123");
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        ["rm", "container-123"],
        expect.any(Object)
      );
    });

    it("should force remove container", async () => {
      execaMock.mockResolvedValue({ exitCode: 0 });
      await runner.removeContainer("container-123", true);
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        ["rm", "-f", "container-123"],
        expect.any(Object)
      );
    });
  });

  describe("getContainer", () => {
    it("should get container info", async () => {
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: "abc123|/test-container|node:22|running|2024-01-01|true||",
      });
      const info = await runner.getContainer("abc123");
      expect(info.name).toBe("test-container");
      expect(info.state).toBe("running");
    });

    it("should throw ContainerNotFoundError for non-existent container", async () => {
      execaMock.mockResolvedValue({
        exitCode: 1,
        stderr: "No such container: xyz",
      });
      await expect(runner.getContainer("xyz")).rejects.toThrow(ContainerNotFoundError);
    });
  });

  describe("exec", () => {
    it("should execute command in container", async () => {
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: "command output",
        stderr: "",
      });
      const result = await runner.exec("container-123", ["ls", "-la"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("command output");
    });

    it("should execute with options", async () => {
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      await runner.exec("container-123", ["npm", "test"], {
        cwd: "/app",
        env: { NODE_ENV: "test" },
        timeout: 60000,
      });
      expect(execaMock).toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["-w", "/app", "-e", "NODE_ENV=test", "container-123", "npm", "test"]),
        expect.any(Object)
      );
    });
  });

  describe("getLogs", () => {
    it("should get container logs", async () => {
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: "2024-01-01 stdout Log message 1\n2024-01-01 stderr Error message",
      });
      const logs = await runner.getLogs("container-123");
      expect(logs).toHaveLength(2);
      expect(logs[0]?.stream).toBe("stdout");
      expect(logs[1]?.stream).toBe("stderr");
    });
  });

  describe("listContainers", () => {
    it("should list all containers", async () => {
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: "abc123|container-1|node:22|running|2024-01-01\ndef456|container-2|nginx|exited|2024-01-02",
      });
      const containers = await runner.listContainers(true);
      expect(containers).toHaveLength(2);
      expect(containers[0]?.name).toBe("container-1");
    });
  });
});

// ============================================================================
// Container Tests
// ============================================================================

describe("Container", () => {
  let container: Container;
  let mockRunner: DockerRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunner = {
      getContainer: vi.fn(),
      startContainer: vi.fn(),
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      exec: vi.fn(),
      getLogs: vi.fn(),
    } as unknown as DockerRunner;

    container = new Container(
      "container-123",
      { image: "node:22-alpine", timeout: 30000 },
      mockRunner,
      mockLogger
    );
  });

  describe("info", () => {
    it("should get container info", async () => {
      (mockRunner.getContainer as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "container-123",
        name: "test",
        state: "running",
      });
      const info = await container.info();
      expect(info.id).toBe("container-123");
    });
  });

  describe("isRunning", () => {
    it("should return true when running", async () => {
      (mockRunner.getContainer as ReturnType<typeof vi.fn>).mockResolvedValue({
        state: "running",
      });
      const running = await container.isRunning();
      expect(running).toBe(true);
    });

    it("should return false when not running", async () => {
      (mockRunner.getContainer as ReturnType<typeof vi.fn>).mockResolvedValue({
        state: "exited",
      });
      const running = await container.isRunning();
      expect(running).toBe(false);
    });

    it("should return false on error", async () => {
      (mockRunner.getContainer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("error"));
      const running = await container.isRunning();
      expect(running).toBe(false);
    });
  });

  describe("start/stop/remove", () => {
    it("should start container", async () => {
      await container.start();
      expect(mockRunner.startContainer).toHaveBeenCalledWith("container-123");
    });

    it("should stop container", async () => {
      await container.stop(20);
      expect(mockRunner.stopContainer).toHaveBeenCalledWith("container-123", 20);
    });

    it("should remove container", async () => {
      await container.remove(true);
      expect(mockRunner.removeContainer).toHaveBeenCalledWith("container-123", true);
    });
  });

  describe("exec", () => {
    it("should execute command", async () => {
      (mockRunner.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stdout: "output",
        stderr: "",
        duration: 100,
      });
      const result = await container.exec(["ls"]);
      expect(result.exitCode).toBe(0);
      expect(mockRunner.exec).toHaveBeenCalledWith(
        "container-123",
        ["ls"],
        { timeout: 30000 }
      );
    });

    it("should execute shell command", async () => {
      (mockRunner.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
      });
      await container.execShell("npm test", { cwd: "/app" });
      expect(mockRunner.exec).toHaveBeenCalledWith(
        "container-123",
        ["sh", "-c", "npm test"],
        { cwd: "/app", timeout: 30000 }
      );
    });
  });

  describe("logs", () => {
    it("should get logs", async () => {
      (mockRunner.getLogs as ReturnType<typeof vi.fn>).mockResolvedValue([
        { timestamp: "2024-01-01", stream: "stdout", message: "log" },
      ]);
      const logs = await container.logs({ tail: 100 });
      expect(logs).toHaveLength(1);
      expect(mockRunner.getLogs).toHaveBeenCalledWith("container-123", { tail: 100 });
    });
  });
});

// ============================================================================
// ContainerManager Tests
// ============================================================================

describe("ContainerManager", () => {
  let manager: ContainerManager;
  let execaMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    manager = new ContainerManager({ logger: mockLogger });
    const { execa } = await import("execa");
    execaMock = execa as ReturnType<typeof vi.fn>;
  });

  describe("create", () => {
    it("should create container", async () => {
      execaMock
        .mockResolvedValueOnce({ exitCode: 0 }) // pull
        .mockResolvedValueOnce({ exitCode: 0, stdout: "container-123" }); // run

      const container = await manager.create({ image: "node:22-alpine" });
      expect(container.id).toBe("container-123");
    });

    it("should use default config", async () => {
      execaMock
        .mockResolvedValueOnce({ exitCode: 0 })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "container-456" });

      const container = await manager.create({});
      expect(container.config.autoRemove).toBe(true);
    });
  });

  describe("get", () => {
    it("should get existing container from cache", async () => {
      execaMock
        .mockResolvedValueOnce({ exitCode: 0 })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "container-123" });

      const created = await manager.create({ image: "node:22-alpine" });
      const retrieved = await manager.get(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("should get container from docker if not cached", async () => {
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: "abc123|/test-container|node:22|running|2024-01-01|true||",
      });

      const container = await manager.get("abc123");
      expect(container.id).toBe("abc123");
    });
  });

  describe("list", () => {
    it("should list containers", async () => {
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: "abc123|container-1|node:22|running|2024-01-01",
      });

      const containers = await manager.list(true);
      expect(containers).toHaveLength(1);
    });
  });

  describe("run", () => {
    it("should run command and cleanup", async () => {
      execaMock
        .mockResolvedValueOnce({ exitCode: 0 }) // pull
        .mockResolvedValueOnce({ exitCode: 0, stdout: "container-123" }) // create
        .mockResolvedValueOnce({ exitCode: 0, stdout: "output", stderr: "" }) // exec
        .mockResolvedValueOnce({ exitCode: 0 }); // remove

      const result = await manager.run({ image: "node:22-alpine" }, ["echo", "hello"]);
      expect(result.stdout).toBe("output");
    });
  });

  describe("createPersistent", () => {
    it("should create container without auto-remove", async () => {
      execaMock
        .mockResolvedValueOnce({ exitCode: 0 })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "container-123" });

      const container = await manager.createPersistent({ image: "nginx" });
      expect(container.config.autoRemove).toBe(false);
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createContainerManager", () => {
  it("should create manager with defaults", () => {
    const manager = createContainerManager();
    expect(manager).toBeInstanceOf(ContainerManager);
  });

  it("should create manager with options", () => {
    const manager = createContainerManager({
      runtime: "podman",
      defaultImage: "python:3.12",
      logger: mockLogger,
    });
    expect(manager).toBeInstanceOf(ContainerManager);
  });
});
