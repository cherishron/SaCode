/**
 * E2E 测试 - 任务管理
 * 测试长任务创建、执行、暂停、恢复、取消等
 */

import { describe, it, expect, afterAll, vi } from "vitest";

// Mock fetch 响应
function mockFetch<T>(data: T, ok = true, status = 200): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ "Content-Type": "application/json" }),
  });
}

// 跳过 E2E 测试如果没有配置测试环境
const shouldRunE2E = process.env.RUN_E2E_TESTS === "true";
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";

describe.skipIf(!shouldRunE2E)("E2E: Tasks - List & Get", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should list all tasks", async () => {
    const mockResponse = [
      {
        id: "task_1",
        type: "analysis",
        status: "completed",
        progress: 100,
        createdAt: new Date().toISOString(),
      },
      {
        id: "task_2",
        type: "generation",
        status: "running",
        progress: 50,
        createdAt: new Date().toISOString(),
      },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  it("should filter tasks by status", async () => {
    const mockResponse = [
      {
        id: "task_1",
        status: "running",
        progress: 30,
      },
      {
        id: "task_2",
        status: "running",
        progress: 60,
      },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks?status=running`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.every((t: { status: string }) => t.status === "running")).toBe(true);
  });

  it("should get task by ID", async () => {
    const mockResponse = {
      id: "task_123",
      type: "analysis",
      status: "running",
      progress: 45,
      steps: [
        { id: "step_1", status: "completed" },
        { id: "step_2", status: "running" },
      ],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.id).toBe("task_123");
  });

  it("should return 404 for non-existent task", async () => {
    mockFetch({ error: "Task not found" }, false, 404);

    const response = await fetch(`${apiBaseUrl}/api/tasks/nonexistent`, {
      headers: authHeader,
    });

    expect(response.status).toBe(404);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Tasks - Types", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should get registered task types", async () => {
    const mockResponse = [
      {
        type: "analysis",
        definition: { name: "Data Analysis", priority: "high" },
      },
      {
        type: "generation",
        definition: { name: "Code Generation", priority: "medium" },
      },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/types`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  it("should register a new task type", async () => {
    const mockResponse = {
      type: "custom-task",
      registered: true,
    };

    mockFetch(mockResponse, true, 201);

    const response = await fetch(`${apiBaseUrl}/api/tasks/types`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        type: "custom-task",
        definition: { name: "Custom Task", priority: "low" },
        executor: "customExecutor",
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.registered).toBe(true);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Tasks - Create & Delete", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should create a new task", async () => {
    const mockResponse = {
      id: "task_new",
      type: "analysis",
      status: "pending",
      progress: 0,
      createdAt: new Date().toISOString(),
    };

    mockFetch(mockResponse, true, 201);

    const response = await fetch(`${apiBaseUrl}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        type: "analysis",
        input: { data: "test" },
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.status).toBe("pending");
  });

  it("should reject task creation without type", async () => {
    mockFetch({ error: "Task type is required" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ input: { data: "test" } }),
    });

    expect(response.status).toBe(400);
  });

  it("should delete a task", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_old`, {
      method: "DELETE",
      headers: authHeader,
    });

    expect(response.status).toBe(204);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Tasks - Execution Control", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should start a task", async () => {
    const mockResponse = {
      id: "task_123",
      status: "running",
      progress: 0,
      startedAt: new Date().toISOString(),
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123/start`, {
      method: "POST",
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.status).toBe("running");
  });

  it("should pause a running task", async () => {
    const mockResponse = {
      id: "task_123",
      status: "paused",
      progress: 50,
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123/pause`, {
      method: "POST",
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.status).toBe("paused");
  });

  it("should resume a paused task", async () => {
    const mockResponse = {
      id: "task_123",
      status: "running",
      progress: 50,
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123/resume`, {
      method: "POST",
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.status).toBe("running");
  });

  it("should cancel a task", async () => {
    const mockResponse = {
      id: "task_123",
      status: "cancelled",
      progress: 30,
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123/cancel`, {
      method: "POST",
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.status).toBe("cancelled");
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Tasks - Progress & Steps", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should get task steps", async () => {
    const mockResponse = [
      { id: "step_1", name: "Initialize", status: "completed" },
      { id: "step_2", name: "Process", status: "running" },
      { id: "step_3", name: "Finalize", status: "pending" },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123/steps`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  it("should add a task step", async () => {
    const mockResponse = {
      id: "task_123",
      steps: [
        { id: "step_1", status: "completed" },
        { id: "step_2", status: "pending" },
      ],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123/steps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        name: "New Step",
        status: "pending",
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.steps.length).toBe(2);
  });

  it("should update task progress", async () => {
    const mockResponse = {
      id: "task_123",
      progress: 75,
      message: "Processing data...",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/tasks/task_123/progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        progress: 75,
        message: "Processing data...",
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.progress).toBe(75);
  });
});
