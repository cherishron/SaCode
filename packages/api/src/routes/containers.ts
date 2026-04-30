import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  created: string;
  ports: string[];
  labels: Record<string, string>;
}

interface ContainerStats {
  id: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}

interface ContainerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const CreateContainerSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  image: z.string().min(1),
  cmd: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  workdir: z.string().optional(),
  ports: z
    .array(
      z.object({
        containerPort: z.number().int().min(1).max(65535),
        hostPort: z.number().int().min(1).max(65535).optional(),
        protocol: z.enum(["tcp", "udp"]).default("tcp"),
      })
    )
    .optional(),
  volumes: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        readOnly: z.boolean().default(false),
      })
    )
    .optional(),
  sandbox: z
    .object({
      level: z.enum(["strict", "moderate", "permissive", "custom"]).default("moderate"),
      memory: z.string().optional(),
      cpuQuota: z.number().optional(),
      networkMode: z.enum(["none", "bridge", "host"]).optional(),
    })
    .optional(),
  autoRemove: z.boolean().default(false),
});

const ExecContainerSchema = z.object({
  cmd: z.array(z.string()).min(1),
  env: z.record(z.string()).optional(),
  workdir: z.string().optional(),
  user: z.string().optional(),
  timeout: z.number().min(1000).max(300000).default(30000),
  detach: z.boolean().default(false),
});

const ListContainersQuerySchema = z.object({
  all: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  filters: z.string().optional(),
});

const GetLogsQuerySchema = z.object({
  follow: z.coerce.boolean().default(false),
  stdout: z.coerce.boolean().default(true),
  stderr: z.coerce.boolean().default(true),
  since: z.coerce.number().int().optional(),
  until: z.coerce.number().int().optional(),
  timestamps: z.coerce.boolean().default(false),
  tail: z.string().default("all"),
});

const router = new Hono<{ Variables: Variables }>();

// GET /api/containers
router.get("/", authMiddleware, async (c) => {
  try {
    const query = ListContainersQuerySchema.parse(c.req.query());

    const containers: ContainerInfo[] = [
      {
        id: "abc123def456",
        name: "SACODE-agent-1",
        image: "SACODE/agent:latest",
        status: "running",
        created: new Date().toISOString(),
        ports: [],
        labels: { "SACODE.type": "agent" },
      },
    ];

    return c.json({
      success: true,
      data: containers.slice(0, query.limit),
      total: containers.length,
    });
  } catch (error) {
    console.error("Failed to list containers:", error);
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: error.errors }, 400);
    }
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

// POST /api/containers
router.post("/", authMiddleware, async (c) => {
  try {
    const body = CreateContainerSchema.parse(await c.req.json());

    console.info("Creating container", { name: body.name, image: body.image });

    const containerId = `container_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    return c.json(
      {
        success: true,
        data: {
          id: containerId,
          name: body.name ?? `container_${containerId.slice(0, 8)}`,
          image: body.image,
          status: "created",
          warnings: [],
        },
      },
      201
    );
  } catch (error) {
    console.error("Failed to create container:", error);
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: error.errors }, 400);
    }
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

// GET /api/containers/:id
router.get("/:id", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");

    return c.json({
      success: true,
      data: {
        id,
        name: `container_${id.slice(0, 8)}`,
        image: "SACODE/agent:latest",
        status: "running",
        created: new Date().toISOString(),
        state: {
          Status: "running",
          Running: true,
          Paused: false,
          Restarting: false,
          Pid: 12345,
          ExitCode: 0,
          StartedAt: new Date().toISOString(),
        },
        config: {
          Cmd: ["/bin/bash"],
          Env: ["PATH=/usr/local/bin:/usr/bin:/bin"],
          WorkingDir: "/workspace",
        },
        networkSettings: {
          IPAddress: "172.17.0.2",
          Ports: {},
        },
      },
    });
  } catch (error) {
    console.error("Failed to get container:", error);
    return c.json({ success: false, error: "Container not found" }, 404);
  }
});

// POST /api/containers/:id/start
router.post("/:id/start", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");

    console.info(`Starting container: ${id}`);

    return c.json({
      success: true,
      data: { id, status: "running" },
    });
  } catch (error) {
    console.error("Failed to start container:", error);
    return c.json({ success: false, error: "Failed to start container" }, 500);
  }
});

// POST /api/containers/:id/stop
router.post("/:id/stop", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const t = body.t as number | undefined;

    console.info(`Stopping container: ${id}`);

    return c.json({
      success: true,
      data: { id, status: "exited" },
    });
  } catch (error) {
    console.error("Failed to stop container:", error);
    return c.json({ success: false, error: "Failed to stop container" }, 500);
  }
});

// POST /api/containers/:id/restart
router.post("/:id/restart", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const t = body.t as number | undefined;

    console.info(`Restarting container: ${id}`);

    return c.json({
      success: true,
      data: { id, status: "running" },
    });
  } catch (error) {
    console.error("Failed to restart container:", error);
    return c.json({ success: false, error: "Failed to restart container" }, 500);
  }
});

// POST /api/containers/:id/pause
router.post("/:id/pause", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");

    console.info(`Pausing container: ${id}`);

    return c.json({
      success: true,
      data: { id, status: "paused" },
    });
  } catch (error) {
    console.error("Failed to pause container:", error);
    return c.json({ success: false, error: "Failed to pause container" }, 500);
  }
});

// POST /api/containers/:id/unpause
router.post("/:id/unpause", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");

    console.info(`Unpausing container: ${id}`);

    return c.json({
      success: true,
      data: { id, status: "running" },
    });
  } catch (error) {
    console.error("Failed to unpause container:", error);
    return c.json({ success: false, error: "Failed to unpause container" }, 500);
  }
});

// DELETE /api/containers/:id
router.delete("/:id", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const force = c.req.query("force");
    const v = c.req.query("v");

    console.info(`Removing container: ${id}`, { force, v });

    return c.json({
      success: true,
      data: { id, removed: true },
    });
  } catch (error) {
    console.error("Failed to remove container:", error);
    return c.json({ success: false, error: "Failed to remove container" }, 500);
  }
});

// GET /api/containers/:id/stats
router.get("/:id/stats", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const streamParam = c.req.query("stream");

    const stats: ContainerStats = {
      id,
      cpuPercent: 2.5,
      memoryUsage: 128 * 1024 * 1024,
      memoryLimit: 512 * 1024 * 1024,
      memoryPercent: 25.0,
      networkRx: 1024 * 1024,
      networkTx: 512 * 1024,
      blockRead: 2 * 1024 * 1024,
      blockWrite: 1 * 1024 * 1024,
      pids: 5,
    };

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Failed to get container stats:", error);
    return c.json({ success: false, error: "Failed to get container stats" }, 500);
  }
});

// GET /api/containers/:id/logs
router.get("/:id/logs", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const query = GetLogsQuerySchema.parse(c.req.query());

    if (query.follow) {
      return stream(c, async (s) => {
        s.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        });

        const interval = setInterval(() => {
          s.write(`[${new Date().toISOString()}] Log line from container ${id}\n`);
        }, 1000);

        await new Promise<void>((resolve) => {
          const cleanup = () => {
            clearInterval(interval);
            resolve();
          };
          c.req.raw.signal.addEventListener("abort", cleanup, { once: true });
          setTimeout(cleanup, 60000);
        });
      });
    }

    return c.json({
      success: true,
      data: {
        id,
        logs: `[${new Date().toISOString()}] Container started\n[${new Date().toISOString()}] Ready\n`,
      },
    });
  } catch (error) {
    console.error("Failed to get container logs:", error);
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: error.errors }, 400);
    }
    return c.json({ success: false, error: "Failed to get container logs" }, 500);
  }
});

// POST /api/containers/:id/exec
router.post("/:id/exec", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const body = ExecContainerSchema.parse(await c.req.json());

    console.info(`Executing command in container: ${id}`, { cmd: body.cmd });

    const execId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const result: ContainerExecResult = {
      exitCode: 0,
      stdout: `Executed: ${body.cmd.join(" ")}\n`,
      stderr: "",
    };

    return c.json({
      success: true,
      data: {
        execId,
        containerId: id,
        ...result,
      },
    });
  } catch (error) {
    console.error("Failed to execute in container:", error);
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: error.errors }, 400);
    }
    return c.json({ success: false, error: "Failed to execute command" }, 500);
  }
});

// GET /api/containers/:id/files
router.get("/:id/files", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const path = c.req.query("path");

    return c.json({
      success: true,
      data: {
        id,
        path: path ?? "/",
        files: [
          { name: "workspace", type: "directory", size: 0 },
          { name: "app", type: "directory", size: 0 },
          { name: "config.json", type: "file", size: 1024 },
        ],
      },
    });
  } catch (error) {
    console.error("Failed to list files:", error);
    return c.json({ success: false, error: "Failed to list files" }, 500);
  }
});

// GET /api/containers/:id/files/:path{.+}
router.get("/:id/files/:path{.+}", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const filePath = c.req.param("path");

    return c.json({
      success: true,
      data: {
        id,
        path: filePath,
        content: "file content here",
      },
    });
  } catch (error) {
    console.error("Failed to get file:", error);
    return c.json({ success: false, error: "Failed to get file" }, 500);
  }
});

// POST /api/containers/:id/files
router.post("/:id/files", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const { path, content } = await c.req.json();

    if (!path || content === undefined) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: path, content",
        },
        400
      );
    }

    console.info(`Copying file to container: ${id}`, { path });

    return c.json({
      success: true,
      data: { id, path, copied: true },
    });
  } catch (error) {
    console.error("Failed to copy file:", error);
    return c.json({ success: false, error: "Failed to copy file" }, 500);
  }
});

// GET /api/containers/:id/export
router.get("/:id/export", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");

    return c.json(
      {
        success: false,
        error: "Export not implemented",
      },
      501
    );
  } catch (error) {
    console.error("Failed to export container:", error);
    return c.json({ success: false, error: "Failed to export container" }, 500);
  }
});

// POST /api/containers/:id/commit
router.post("/:id/commit", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const { repo, tag, message, author, changes } = await c.req.json();

    if (!repo) {
      return c.json(
        {
          success: false,
          error: "Missing required field: repo",
        },
        400
      );
    }

    console.info(`Committing container: ${id}`, { repo, tag });

    const imageId = `sha256:${Math.random().toString(16).slice(2, 66)}`;

    return c.json({
      success: true,
      data: {
        id: imageId,
        repo,
        tag: tag ?? "latest",
      },
    });
  } catch (error) {
    console.error("Failed to commit container:", error);
    return c.json({ success: false, error: "Failed to commit container" }, 500);
  }
});

// POST /api/containers/:id/rename
router.post("/:id/rename", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const { name } = await c.req.json();

    if (!name) {
      return c.json(
        {
          success: false,
          error: "Missing required field: name",
        },
        400
      );
    }

    console.info(`Renaming container: ${id} -> ${name}`);

    return c.json({
      success: true,
      data: { id, name },
    });
  } catch (error) {
    console.error("Failed to rename container:", error);
    return c.json({ success: false, error: "Failed to rename container" }, 500);
  }
});

// POST /api/containers/prune
router.post("/prune", authMiddleware, async (c) => {
  try {
    console.info("Pruning stopped containers");

    return c.json({
      success: true,
      data: {
        containersDeleted: 0,
        spaceReclaimed: 0,
      },
    });
  } catch (error) {
    console.error("Failed to prune containers:", error);
    return c.json({ success: false, error: "Failed to prune containers" }, 500);
  }
});

export default router;
