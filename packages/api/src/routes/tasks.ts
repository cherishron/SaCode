import { Router, type Request, type Response } from "express";
import {
  LongTaskManager,
  type LongTask,
  type TaskDefinition,
  type LongTaskEvent,
} from "@saclaw/core";
import { getPrismaClient } from "@saclaw/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 任务管理器实例
let taskManager: LongTaskManager | null = null;

function getTaskManager(): LongTaskManager {
  if (!taskManager) {
    taskManager = new LongTaskManager({
      persistTask: async (task: LongTask) => {
        // 可选：持久化到数据库
        console.log(`[TaskManager] Persisting task ${task.id}`);
      },
      loadTasks: async () => {
        // 可选：从数据库加载任务
        return [];
      },
    });
  }
  return taskManager;
}

// GET /api/tasks - 获取任务列表
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const manager = getTaskManager();

    let tasks: LongTask[];
    if (status) {
      tasks = manager.getTasksByStatus(status as LongTask["status"]);
    } else {
      tasks = manager.getAllTasks();
    }

    res.json(tasks);
  } catch (error) {
    console.error("Get tasks error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tasks/types - 获取可用任务类型
router.get("/types", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const manager = getTaskManager();
    const types = manager.getRegisteredTypes();

    res.json(types);
  } catch (error) {
    console.error("Get task types error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tasks/types - 注册任务类型
router.post("/types", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type, definition, executor } = req.body as {
      type: string;
      definition: TaskDefinition;
      executor: string;
    };

    if (!type || !definition || !executor) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const manager = getTaskManager();

    // 创建执行器函数（简化版）
    const executorFn = async () => {
      console.log(`Executing task type: ${type}`);
      return { result: "completed" };
    };

    manager.registerType(type, definition, executorFn);

    res.status(201).json({ type, registered: true });
  } catch (error) {
    console.error("Register task type error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tasks - 创建任务
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type, ...overrides } = req.body;

    if (!type) {
      res.status(400).json({ error: "Task type is required" });
      return;
    }

    const manager = getTaskManager();
    const task = await manager.createTask(type, overrides);

    res.status(201).json(task);
  } catch (error) {
    console.error("Create task error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tasks/:id - 获取任务详情
router.get("/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const manager = getTaskManager();
    const task = manager.getTask(id);

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(task);
  } catch (error) {
    console.error("Get task error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tasks/:id/start - 启动任务
router.post("/:id/start", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const manager = getTaskManager();

    await manager.startTask(id);
    const task = manager.getTask(id);

    res.json(task);
  } catch (error) {
    console.error("Start task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// POST /api/tasks/:id/pause - 暂停任务
router.post("/:id/pause", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const manager = getTaskManager();

    await manager.pauseTask(id);
    const task = manager.getTask(id);

    res.json(task);
  } catch (error) {
    console.error("Pause task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// POST /api/tasks/:id/resume - 恢复任务
router.post("/:id/resume", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const manager = getTaskManager();

    await manager.resumeTask(id);
    const task = manager.getTask(id);

    res.json(task);
  } catch (error) {
    console.error("Resume task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// POST /api/tasks/:id/cancel - 取消任务
router.post("/:id/cancel", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const manager = getTaskManager();

    await manager.cancelTask(id);
    const task = manager.getTask(id);

    res.json(task);
  } catch (error) {
    console.error("Cancel task error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// DELETE /api/tasks/:id - 删除任务
router.delete("/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const manager = getTaskManager();

    manager.deleteTask(id);

    res.status(204).send();
  } catch (error) {
    console.error("Delete task error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tasks/:id/steps - 获取任务步骤
router.get("/:id/steps", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const manager = getTaskManager();
    const task = manager.getTask(id);

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(task.steps);
  } catch (error) {
    console.error("Get task steps error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tasks/:id/steps - 添加任务步骤
router.post("/:id/steps", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const step = req.body;
    const manager = getTaskManager();

    await manager.addStep(id, step);
    const task = manager.getTask(id);

    res.json(task);
  } catch (error) {
    console.error("Add task step error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tasks/:id/progress - 更新进度
router.post("/:id/progress", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { progress, message } = req.body;
    const manager = getTaskManager();

    await manager.updateProgress(id, progress, message);
    const task = manager.getTask(id);

    res.json(task);
  } catch (error) {
    console.error("Update progress error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
