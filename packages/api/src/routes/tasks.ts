import { Hono } from "hono";
import {
  LongTaskManager,
  type LongTask,
  type TaskDefinition,
} from "@sacode/core";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

let taskManager: LongTaskManager | null = null;

function getTaskManager(): LongTaskManager {
  if (!taskManager) {
    taskManager = new LongTaskManager({
      persistTask: async (task: LongTask) => {
        console.log(`[TaskManager] Persisting task ${task.id}`);
      },
      loadTasks: async () => {
        return [];
      },
    });
  }
  return taskManager;
}

// GET /api/tasks
router.get("/", authMiddleware, async (c) => {
  try {
    const status = c.req.query("status");
    const manager = getTaskManager();

    let tasks: LongTask[];
    if (status) {
      tasks = manager.getTasksByStatus(status as LongTask["status"]);
    } else {
      tasks = manager.getAllTasks();
    }

    return c.json(tasks);
  } catch (error) {
    console.error("Get tasks error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/tasks/types
router.get("/types", authMiddleware, async (c) => {
  try {
    const manager = getTaskManager();
    const types = manager.getRegisteredTypes();

    return c.json(types);
  } catch (error) {
    console.error("Get task types error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/tasks/types
router.post("/types", authMiddleware, async (c) => {
  try {
    const { type, definition, executor } = await c.req.json() as {
      type: string;
      definition: TaskDefinition;
      executor: string;
    };

    if (!type || !definition || !executor) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const manager = getTaskManager();

    const executorFn = async () => {
      console.log(`Executing task type: ${type}`);
      return { result: "completed" };
    };

    manager.registerType(type, definition, executorFn);

    return c.json({ type, registered: true }, 201);
  } catch (error) {
    console.error("Register task type error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/tasks
router.post("/", authMiddleware, async (c) => {
  try {
    const { type, ...overrides } = await c.req.json();

    if (!type) {
      return c.json({ error: "Task type is required" }, 400);
    }

    const manager = getTaskManager();
    const task = await manager.createTask(type, overrides);

    return c.json(task, 201);
  } catch (error) {
    console.error("Create task error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/tasks/:id
router.get("/:id", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const manager = getTaskManager();
    const task = manager.getTask(id);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json(task);
  } catch (error) {
    console.error("Get task error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/tasks/:id/start
router.post("/:id/start", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const manager = getTaskManager();

    await manager.startTask(id);
    const task = manager.getTask(id);

    return c.json(task);
  } catch (error) {
    console.error("Start task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

// POST /api/tasks/:id/pause
router.post("/:id/pause", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const manager = getTaskManager();

    await manager.pauseTask(id);
    const task = manager.getTask(id);

    return c.json(task);
  } catch (error) {
    console.error("Pause task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

// POST /api/tasks/:id/resume
router.post("/:id/resume", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const manager = getTaskManager();

    await manager.resumeTask(id);
    const task = manager.getTask(id);

    return c.json(task);
  } catch (error) {
    console.error("Resume task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

// POST /api/tasks/:id/cancel
router.post("/:id/cancel", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const manager = getTaskManager();

    await manager.cancelTask(id);
    const task = manager.getTask(id);

    return c.json(task);
  } catch (error) {
    console.error("Cancel task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

// DELETE /api/tasks/:id
router.delete("/:id", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const manager = getTaskManager();

    manager.deleteTask(id);

    return c.body(null, 204);
  } catch (error) {
    console.error("Delete task error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/tasks/:id/steps
router.get("/:id/steps", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const manager = getTaskManager();
    const task = manager.getTask(id);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json(task.steps);
  } catch (error) {
    console.error("Get task steps error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/tasks/:id/steps
router.post("/:id/steps", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const step = await c.req.json();
    const manager = getTaskManager();

    await manager.addStep(id, step);
    const task = manager.getTask(id);

    return c.json(task);
  } catch (error) {
    console.error("Add task step error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/tasks/:id/progress
router.post("/:id/progress", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const { progress, message } = await c.req.json();
    const manager = getTaskManager();

    await manager.updateProgress(id, progress, message);
    const task = manager.getTask(id);

    return c.json(task);
  } catch (error) {
    console.error("Update progress error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default router;
