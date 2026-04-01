/**
 * SACODEClient Agentic 功能测试
 * 测试 Agentic 规划、编排、复杂度评估等功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SACODEClient } from "../index";
import { SACODEError } from "../../types";

// Mock Provider
vi.mock("../provider", async () => {
  const actual = await vi.importActual("../provider");
  return {
    ...(actual as object),
    createProvider: vi.fn().mockImplementation(() => ({
      type: "openai",
      model: "gpt-4o",
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "Hello" };
        yield { type: "done" as const, stopReason: "end_turn" };
      }),
      registerTool: vi.fn(),
    })),
  };
});

// Mock ToolBridge
vi.mock("../tools", async () => {
  const actual = await vi.importActual("../tools");
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
    })),
  };
});

// Mock Agent 模块
vi.mock("../agent", async () => {
  const actual = await vi.importActual("../agent");
  return {
    ...(actual as object),
    createAgentRegistry: vi.fn().mockImplementation(() => ({
      getStats: vi.fn().mockReturnValue({ total: 3 }),
      on: vi.fn(),
    })),
    createPlanner: vi.fn().mockImplementation(() => ({
      assessComplexity: vi.fn().mockReturnValue({
        level: "complex",
        score: 0.8,
        taskCategory: "development" as const,
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
        goal: "Test goal",
        steps: [
          { id: "step-1", name: "Step 1", status: "pending" as const },
          { id: "step-2", name: "Step 2", status: "pending" as const },
        ],
        metadata: {},
      }),
      on: vi.fn(),
    })),
    createOrchestrator: vi.fn().mockImplementation(() => ({
      executePlan: vi.fn().mockResolvedValue({
        success: true,
        output: "Plan completed successfully",
        steps: [],
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
      vi.mocked(await import("../agent")).createPlanner = vi.fn().mockImplementation(() => ({
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
        generatePlan: vi.fn(),
        on: vi.fn(),
      }));

      const simpleClient = new SACODEClient(config);
      await simpleClient.connect();

      const stream = simpleClient.agenticChat("What's the weather?");
      const chunks: any[] = [];
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该为复杂任务生成计划", async () => {
      const stream = client.agenticChat("Build a full-stack web application");
      
      const chunks: any[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // 应该包含计划类型的数据
      const planChunk = chunks.find(c => c.type === "plan");
      expect(planChunk).toBeDefined();
    });

    it("应该执行计划并返回结果", async () => {
      const stream = client.agenticChat("Analyze this codebase");
      
      const chunks: any[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // 应该包含输出结果
      expect(chunks.some(c => c.content || c.chunk?.text)).toBe(true);
    });

    it("应该处理执行失败", async () => {
      vi.mocked(await import("../agent")).createOrchestrator = vi.fn().mockImplementation(() => ({
        executePlan: vi.fn().mockResolvedValue({
          success: false,
          error: "Execution failed",
          steps: [],
        }),
        on: vi.fn(),
      }));

      const failClient = new SACODEClient(config);
      await failClient.connect();

      const stream = failClient.agenticChat("Impossible task");
      const chunks: any[] = [];
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // 应该包含错误消息
      expect(chunks.some(c => c.role === "system" || c.type === "error")).toBe(true);
    });

    it("应该在未启用 Agentic 时使用普通聊天", async () => {
      const noAgenticClient = new SACODEClient({
        ...config,
        enableAgenticPlanning: false,
      });
      
      await noAgenticClient.connect();

      const stream = noAgenticClient.agenticChat("Hello");
      const chunks: any[] = [];
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该发射 plan_created 事件", async () => {
      const planListener = vi.fn();
      client.on("plan_created", planListener);

      const stream = client.agenticChat("Build something");
      for await (const chunk of stream) {
        // 消费流
      }

      expect(planListener).toHaveBeenCalled();
    });

    it("应该发射 plan_completed 事件", async () => {
      const completeListener = vi.fn();
      client.on("plan_completed", completeListener);

      const stream = client.agenticChat("Build something");
      for await (const chunk of stream) {
        // 消费流
      }

      expect(completeListener).toHaveBeenCalled();
    });

    it("应该发射 complexity_assessed 事件", async () => {
      const assessListener = vi.fn();
      client.on("complexity_assessed", assessListener);

      const stream = client.agenticChat("Build something");
      for await (const chunk of stream) {
        // 消费流
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

      await expect(noAgenticClient.executePlan({ id: "test", goal: "test", steps: [], metadata: {} })).rejects.toThrow(SACODEError);
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
