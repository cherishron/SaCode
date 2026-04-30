import { describe, it, expect, beforeEach, vi } from "vitest";
import { SACODEClient } from "../index";
import { SACODEError } from "../../types";
import { createProvider } from "../../provider";
import { createToolBridge } from "../../tools";
import { createAgentRegistry, createPlanner, createOrchestrator } from "../../agent";

vi.mock("../../provider", async () => {
  const actual = await vi.importActual("../../provider");
  return {
    ...(actual as object),
    createProvider: vi.fn().mockImplementation(() => ({
      type: "openai",
      model: "gpt-4o",
      isInitialized: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Hello" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
      registerTool: vi.fn(),
      executeToolCall: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    })),
    createProviderFromEnv: vi.fn().mockImplementation(() => ({
      type: "openai",
      model: "gpt-4o",
      isInitialized: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Response" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
      registerTool: vi.fn(),
    })),
  };
});

vi.mock("../../tools", async () => {
  const actual = await vi.importActual("../../tools");
  return {
    ...(actual as object),
    createToolBridge: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      getToolCount: vi.fn().mockReturnValue(5),
      getToolNames: vi.fn().mockReturnValue(["think", "plan", "calculate"]),
      getAllTools: vi.fn().mockReturnValue([]),
      getProviderToolDefinitions: vi.fn().mockReturnValue([]),
      registerTool: vi.fn(),
      executeToolCall: vi.fn().mockResolvedValue({ success: true, content: "result", toolCallId: "call_1", name: "test" }),
      executeToolCalls: vi.fn().mockResolvedValue([]),
      on: vi.fn(),
    })),
    ToolBridge: vi.fn(),
  };
});

vi.mock("../../agent", async () => {
  const actual = await vi.importActual("../../agent");
  return {
    ...(actual as object),
    createAgentRegistry: vi.fn().mockImplementation(() => ({
      getStats: vi.fn().mockReturnValue({ total: 3 }),
      on: vi.fn(),
    })),
    createPlanner: vi.fn().mockImplementation(() => ({
      assessComplexity: vi.fn().mockReturnValue({
        level: "complex",
        score: 80,
        taskCategory: "deep" as const,
        factors: {
          techStackCount: 2,
          toolCount: 3,
          estimatedSteps: 5,
          requiresExternalResources: true,
          requiresUserInteraction: false,
        },
      }),
      generatePlan: vi.fn().mockResolvedValue({
        id: "plan-1",
        description: "Test plan",
        goal: "Test goal",
        steps: [
          { id: "step-1", description: "Step 1", status: "pending" as const },
          { id: "step-2", description: "Step 2", status: "pending" as const },
        ],
        status: "draft" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      on: vi.fn(),
    })),
    createOrchestrator: vi.fn().mockImplementation(() => ({
      executePlan: vi.fn().mockResolvedValue({
        planId: "plan-1",
        success: true,
        output: "Plan completed successfully",
        completedSteps: 2,
        totalSteps: 2,
        duration: 100,
      }),
      on: vi.fn(),
    })),
  };
});

describe("SACODEClient Agentic", () => {
  let client: SACODEClient;

  const config = {
    provider: {
      type: "openai" as const,
      apiKey: "sk-test-key",
      model: "gpt-4o",
    },
    enableAgenticPlanning: true,
    debug: false,
  };

  beforeEach(async () => {
    vi.mocked(createProvider).mockImplementation(() => ({
      type: "openai",
      model: "gpt-4o",
      isInitialized: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Hello" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
      registerTool: vi.fn(),
      executeToolCall: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    }));
    vi.mocked(createToolBridge).mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      getToolCount: vi.fn().mockReturnValue(5),
      getToolNames: vi.fn().mockReturnValue(["think", "plan", "calculate"]),
      getAllTools: vi.fn().mockReturnValue([]),
      getProviderToolDefinitions: vi.fn().mockReturnValue([]),
      registerTool: vi.fn(),
      executeToolCall: vi.fn().mockResolvedValue({ success: true, content: "result", toolCallId: "call_1", name: "test" }),
      executeToolCalls: vi.fn().mockResolvedValue([]),
      on: vi.fn(),
    }));
    vi.mocked(createAgentRegistry).mockImplementation(() => ({
      getStats: vi.fn().mockReturnValue({ total: 3 }),
      on: vi.fn(),
    }));
    vi.mocked(createPlanner).mockImplementation(() => ({
      assessComplexity: vi.fn().mockReturnValue({
        level: "complex",
        score: 80,
        taskCategory: "deep" as const,
        factors: {
          techStackCount: 2,
          toolCount: 3,
          estimatedSteps: 5,
          requiresExternalResources: true,
          requiresUserInteraction: false,
        },
      }),
      generatePlan: vi.fn().mockResolvedValue({
        id: "plan-1",
        description: "Test plan",
        goal: "Test goal",
        steps: [
          { id: "step-1", description: "Step 1", status: "pending" as const },
          { id: "step-2", description: "Step 2", status: "pending" as const },
        ],
        status: "draft" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      on: vi.fn(),
    }));
    vi.mocked(createOrchestrator).mockImplementation(() => ({
      executePlan: vi.fn().mockResolvedValue({
        planId: "plan-1",
        success: true,
        output: "Plan completed successfully",
        completedSteps: 2,
        totalSteps: 2,
        duration: 100,
      }),
      on: vi.fn(),
    }));
    client = new SACODEClient(config);
    await client.connect();
  });

  describe("Agentic 聊天", () => {
    it("应该评估任务复杂度", async () => {
      const assessment = client.assessComplexity("Build a web application");

      expect(assessment).toBeDefined();
      expect(assessment.level).toBe("complex");
      expect(assessment.score).toBeGreaterThan(0);
    });

    it("应该为简单任务直接执行", async () => {
      vi.mocked(createPlanner).mockImplementationOnce(() => ({
        assessComplexity: vi.fn().mockReturnValue({
          level: "simple" as const,
          score: 0.2,
          taskCategory: "quick" as const,
          factors: {
            techStackCount: 0,
            toolCount: 1,
            estimatedSteps: 1,
            requiresExternalResources: false,
            requiresUserInteraction: false,
          },
        }),
        generatePlan: vi.fn().mockResolvedValue({
          id: "plan-simple",
          description: "Simple plan",
          goal: "Simple goal",
          steps: [],
          status: "draft" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        on: vi.fn(),
      }));

      const simpleClient = new SACODEClient(config);
      await simpleClient.connect();

      const stream = simpleClient.agenticChat("What's the weather?");
      const chunks: unknown[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该为复杂任务生成计划", async () => {
      const stream = client.agenticChat("Build a full-stack web application");

      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const planChunk = chunks.find((c: any) => c.type === "plan");
      expect(planChunk).toBeDefined();
    });

    it("应该执行计划并返回结果", async () => {
      const stream = client.agenticChat("Analyze this codebase");

      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some((c: any) => c.content || c.chunk?.text)).toBe(true);
    });

    it("应该处理执行失败", async () => {
      vi.mocked(createOrchestrator).mockImplementationOnce(() => ({
        executePlan: vi.fn().mockResolvedValue({
          planId: "plan-fail",
          success: false,
          error: "Execution failed",
          completedSteps: 0,
          totalSteps: 2,
          duration: 50,
        }),
        on: vi.fn(),
      }));

      const failClient = new SACODEClient(config);
      await failClient.connect();

      const stream = failClient.agenticChat("Impossible task");
      const chunks: unknown[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.some((c: any) => c.role === "system" || c.type === "error")).toBe(true);
    });

    it("应该在未启用 Agentic 时使用普通聊天", async () => {
      const noAgenticClient = new SACODEClient({
        ...config,
        enableAgenticPlanning: false,
      });

      await noAgenticClient.connect();

      const stream = noAgenticClient.agenticChat("Hello");
      const chunks: unknown[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该发射 plan_created 事件", async () => {
      const planListener = vi.fn();
      client.on("plan_created", planListener);

      const stream = client.agenticChat("Build something");
      for await (const _ of stream) {
        void _;
      }

      expect(planListener).toHaveBeenCalled();
    });

    it("应该发射 plan_completed 事件", async () => {
      const completeListener = vi.fn();
      client.on("plan_completed", completeListener);

      const stream = client.agenticChat("Build something");
      for await (const _ of stream) {
        void _;
      }

      expect(completeListener).toHaveBeenCalled();
    });

    it("应该发射 complexity_assessed 事件", async () => {
      const assessListener = vi.fn();
      client.on("complexity_assessed", assessListener);

      const stream = client.agenticChat("Build something");
      for await (const _ of stream) {
        void _;
      }

      expect(assessListener).toHaveBeenCalled();
    });
  });

  describe("生成计划", () => {
    it("应该生成执行计划", async () => {
      const plan = await client.generatePlan("Build a REST API");

      expect(plan).toBeDefined();
      expect(plan.id).toBeDefined();
      expect(plan.goal).toBe("Test goal");
      expect(plan.steps).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("应该在未启用 Agentic 时抛出错误", async () => {
      const noAgenticClient = new SACODEClient({
        ...config,
        enableAgenticPlanning: false,
      });

      await noAgenticClient.connect();

      await expect(noAgenticClient.generatePlan("Test")).rejects.toThrow(SACODEError);
    });
  });

  describe("执行计划", () => {
    it("应该执行计划", async () => {
      const plan = await client.generatePlan("Test plan");
      const result = await client.executePlan(plan);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it("应该在未启用 Agentic 时抛出错误", async () => {
      const noAgenticClient = new SACODEClient({
        ...config,
        enableAgenticPlanning: false,
      });

      await noAgenticClient.connect();

      await expect(noAgenticClient.executePlan({
        id: "test",
        description: "test",
        goal: "test",
        steps: [],
        status: "draft" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      })).rejects.toThrow(SACODEError);
    });
  });

  describe("获取 Agent 组件", () => {
    it("应该获取 AgentRegistry", () => {
      const registry = client.getAgentRegistry();
      expect(registry).not.toBeNull();
    });

    it("应该获取 Planner", () => {
      const planner = client.getPlanner();
      expect(planner).not.toBeNull();
    });

    it("应该获取 Orchestrator", () => {
      const orchestrator = client.getOrchestrator();
      expect(orchestrator).not.toBeNull();
    });

    it("应该检查 Agentic 是否启用", () => {
      expect(client.isAgenticEnabled()).toBe(true);
    });
  });

  describe("Agentic 禁用情况", () => {
    it("应该在不启用 Agentic 时返回 null 组件", async () => {
      const noAgenticClient = new SACODEClient({
        ...config,
        enableAgenticPlanning: false,
      });

      await noAgenticClient.connect();

      expect(noAgenticClient.getAgentRegistry()).toBeNull();
      expect(noAgenticClient.getPlanner()).toBeNull();
      expect(noAgenticClient.getOrchestrator()).toBeNull();
      expect(noAgenticClient.isAgenticEnabled()).toBe(false);
    });
  });

  describe("调试模式", () => {
    it("应该在调试模式下输出复杂度日志", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const debugClient = new SACODEClient({
        ...config,
        debug: true,
      });

      await debugClient.connect();
      debugClient.assessComplexity("Test task");

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
