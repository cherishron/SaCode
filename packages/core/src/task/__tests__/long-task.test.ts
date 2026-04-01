import { describe, it, expect, beforeEach, vi } from "vitest";
import { LongTaskManager } from "../long-task";
import type { LongTaskExecutor, TaskContext } from "../long-task";

describe("LongTaskManager", () => {
  let manager: LongTaskManager;

  beforeEach(() => {
    manager = new LongTaskManager({
      persistence: {
        save: async () => {},
        load: async () => null,
        loadAll: async () => [],
        delete: async () => {},
      },
    });
  });

  describe("Type Registration", () => {
    it("should register a task type", () => {
      const executor: LongTaskExecutor = async () => ({ success: true });

      manager.registerTaskType(
        "Test Task",
        { name: "Test Task", priority: "medium", totalSteps: 1, tags: [] },
        executor
      );

      // Should not throw
      expect(true).toBe(true);
    });

    it("should allow registering multiple types", () => {
      manager.registerTaskType(
        "Type 1",
        { name: "Type 1", priority: "low", totalSteps: 1, tags: [] },
        async () => ({})
      );
      manager.registerTaskType(
        "Type 2",
        { name: "Type 2", priority: "high", totalSteps: 2, tags: [] },
        async () => ({})
      );

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("Task Creation", () => {
    it("should create a task", async () => {
      manager.registerTaskType(
        "Create Test",
        { name: "Create Test", priority: "medium", totalSteps: 3, tags: [] },
        async () => ({})
      );

      const task = await manager.createTask("Create Test");

      expect(task.id).toBeDefined();
      expect(task.name).toBe("Create Test");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe("medium");
      expect(task.totalSteps).toBe(3);
    });

    it("should create a task with overrides", async () => {
      manager.registerTaskType(
        "Override Test",
        { name: "Override Test", priority: "medium", totalSteps: 3, tags: [] },
        async () => ({})
      );

      // Note: overriding name will break startTask since it uses name to lookup registry
      const task = await manager.createTask("Override Test", {
        priority: "high",
        totalSteps: 5,
      });

      expect(task.name).toBe("Override Test");
      expect(task.priority).toBe("high");
      expect(task.totalSteps).toBe(5);
    });

    it("should throw error for unknown type", async () => {
      await expect(manager.createTask("Unknown Type")).rejects.toThrow();
    });
  });

  describe("Task Management", () => {
    it("should get a task by id", async () => {
      manager.registerTaskType(
        "Management Test",
        { name: "Management Test", priority: "medium", totalSteps: 1, tags: [] },
        async () => ({ result: "done" })
      );

      const created = await manager.createTask("Management Test");
      const retrieved = manager.getTask(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it("should return undefined for non-existent task", () => {
      const task = manager.getTask("non-existent-id");
      expect(task).toBeUndefined();
    });

    it("should get all tasks", async () => {
      manager.registerTaskType(
        "List Test",
        { name: "List Test", priority: "medium", totalSteps: 1, tags: [] },
        async () => ({})
      );

      await manager.createTask("List Test");
      await manager.createTask("List Test");

      const tasks = manager.getAllTasks();
      expect(tasks).toHaveLength(2);
    });

    it("should get running tasks", async () => {
      manager.registerTaskType(
        "Running Test",
        { name: "Running Test", priority: "medium", totalSteps: 1, tags: [] },
        async () => {
          await new Promise((r) => setTimeout(r, 100));
          return {};
        }
      );

      const running = manager.getRunningTasks();
      expect(running).toHaveLength(0);
    });
  });

  describe("Task Execution", () => {
    it("should start and complete a task", async () => {
      manager.registerTaskType(
        "Exec Test",
        { name: "Exec Test", priority: "medium", totalSteps: 1, tags: [] },
        async () => ({ result: "completed" })
      );

      const task = await manager.createTask("Exec Test");
      await manager.startTask(task.id);

      const updated = manager.getTask(task.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.result).toEqual({ result: "completed" });
    });

    it("should not start a non-existent task", async () => {
      await expect(manager.startTask("non-existent")).rejects.toThrow();
    });

    it("should cancel a pending task", async () => {
      manager.registerTaskType(
        "Cancel Test",
        { name: "Cancel Test", priority: "medium", totalSteps: 1, tags: [] },
        async () => {
          await new Promise((r) => setTimeout(r, 1000));
          return {};
        }
      );

      const task = await manager.createTask("Cancel Test");
      await manager.cancelTask(task.id);

      const cancelled = manager.getTask(task.id);
      expect(cancelled?.status).toBe("cancelled");
    });
  });

  describe("Progress via Context", () => {
    it("should allow progress reporting via context", async () => {
      let capturedContext: TaskContext | null = null;

      manager.registerTaskType(
        "Progress Test",
        { name: "Progress Test", priority: "medium", totalSteps: 1, tags: [] },
        async (task, context) => {
          capturedContext = context;
          await context.reportProgress(50, "Half way");
          await new Promise((r) => setTimeout(r, 10));
          await context.reportProgress(100, "Done");
          return { success: true };
        }
      );

      const task = await manager.createTask("Progress Test");
      await manager.startTask(task.id);

      // Wait for task to complete
      await new Promise((r) => setTimeout(r, 50));

      const updated = manager.getTask(task.id);
      expect(updated?.progress).toBe(100);
      expect(updated?.status).toBe("completed");
      expect(capturedContext).not.toBeNull();
    });
  });

  describe("Events", () => {
    it("should emit event on task creation", async () => {
      const handler = vi.fn();
      manager.on("event", handler);

      manager.registerTaskType(
        "Event Test",
        { name: "Event Test", priority: "medium", totalSteps: 1, tags: [] },
        async () => ({})
      );

      await manager.createTask("Event Test");

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0]?.[0];
      expect(event?.type).toBe("created");
    });

    it("should emit event on task start", async () => {
      const handler = vi.fn();
      manager.on("event", handler);

      manager.registerTaskType(
        "Start Event",
        { name: "Start Event", priority: "medium", totalSteps: 1, tags: [] },
        async () => ({})
      );

      const task = await manager.createTask("Start Event");
      await manager.startTask(task.id);

      // Should have called with started event
      const startedCall = handler.mock.calls.find(
        (call) => call[0]?.type === "started"
      );
      expect(startedCall).toBeDefined();
    });

    it("should emit event on task completion", async () => {
      const handler = vi.fn();
      manager.on("event", handler);

      manager.registerTaskType(
        "Complete Event",
        { name: "Complete Event", priority: "medium", totalSteps: 1, tags: [] },
        async () => ({})
      );

      const task = await manager.createTask("Complete Event");
      await manager.startTask(task.id);

      // Wait for task to complete
      await new Promise((r) => setTimeout(r, 50));

      // Should have called with completed event
      const completedCall = handler.mock.calls.find(
        (call) => call[0]?.type === "completed"
      );
      expect(completedCall).toBeDefined();
    });
  });

  describe("Concurrent Tasks", () => {
    it("should handle multiple tasks", async () => {
      manager.registerTaskType(
        "Concurrent Test",
        { name: "Concurrent Test", priority: "medium", totalSteps: 1, tags: [] },
        async () => {
          await new Promise((r) => setTimeout(r, 50));
          return { done: true };
        }
      );

      const task1 = await manager.createTask("Concurrent Test");
      const task2 = await manager.createTask("Concurrent Test");

      await Promise.all([manager.startTask(task1.id), manager.startTask(task2.id)]);

      // Wait for tasks to complete
      await new Promise((r) => setTimeout(r, 100));

      expect(manager.getTask(task1.id)?.status).toBe("completed");
      expect(manager.getTask(task2.id)?.status).toBe("completed");
    });
  });
});