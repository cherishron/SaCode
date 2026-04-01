/**
 * SaClaw API - 容器路由
 *
 * 容器管理 API 端点
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Logger } from "@saclaw/core";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Validation Schemas
// ============================================================================

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
  filters: z.string().optional(), // JSON string
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

// ============================================================================
// Router Factory
// ============================================================================

export function createContainerRoutes(options: {
  logger: Logger;
  dockerHost?: string;
}): Router {
  const { logger } = options;
  const router = Router();

  // -------------------------------------------------------------------------
  // List Containers
  // -------------------------------------------------------------------------
  router.get("/", async (req: Request, res: Response) => {
    try {
      const query = ListContainersQuerySchema.parse(req.query);

      // TODO: 实际调用 Docker API
      // const containers = await docker.listContainers({ all: query.all });

      // 模拟响应
      const containers: ContainerInfo[] = [
        {
          id: "abc123def456",
          name: "saclaw-agent-1",
          image: "saclaw/agent:latest",
          status: "running",
          created: new Date().toISOString(),
          ports: [],
          labels: { "saclaw.type": "agent" },
        },
      ];

      res.json({
        success: true,
        data: containers.slice(0, query.limit),
        total: containers.length,
      });
    } catch (error) {
      logger.error("Failed to list containers:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors });
      } else {
        res.status(500).json({ success: false, error: "Internal server error" });
      }
    }
  });

  // -------------------------------------------------------------------------
  // Create Container
  // -------------------------------------------------------------------------
  router.post("/", async (req: Request, res: Response) => {
    try {
      const body = CreateContainerSchema.parse(req.body);

      logger.info("Creating container", { name: body.name, image: body.image });

      // TODO: 实际调用 Docker API
      // const container = await docker.createContainer({
      //   name: body.name,
      //   Image: body.image,
      //   Cmd: body.cmd,
      //   Env: Object.entries(body.env ?? {}).map(([k, v]) => `${k}=${v}`),
      //   WorkingDir: body.workdir,
      //   ...
      // });

      const containerId = `container_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      res.status(201).json({
        success: true,
        data: {
          id: containerId,
          name: body.name ?? `container_${containerId.slice(0, 8)}`,
          image: body.image,
          status: "created",
          warnings: [],
        },
      });
    } catch (error) {
      logger.error("Failed to create container:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors });
      } else {
        res.status(500).json({ success: false, error: "Internal server error" });
      }
    }
  });

  // -------------------------------------------------------------------------
  // Get Container
  // -------------------------------------------------------------------------
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // const info = await container.inspect();

      res.json({
        success: true,
        data: {
          id,
          name: `container_${id.slice(0, 8)}`,
          image: "saclaw/agent:latest",
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
      logger.error("Failed to get container:", error);
      res.status(404).json({ success: false, error: "Container not found" });
    }
  });

  // -------------------------------------------------------------------------
  // Start Container
  // -------------------------------------------------------------------------
  router.post("/:id/start", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      logger.info(`Starting container: ${id}`);

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // await container.start();

      res.json({
        success: true,
        data: { id, status: "running" },
      });
    } catch (error) {
      logger.error("Failed to start container:", error);
      res.status(500).json({ success: false, error: "Failed to start container" });
    }
  });

  // -------------------------------------------------------------------------
  // Stop Container
  // -------------------------------------------------------------------------
  router.post("/:id/stop", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { t } = req.body; // timeout in seconds

      logger.info(`Stopping container: ${id}`);

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // await container.stop({ t: t ?? 10 });

      res.json({
        success: true,
        data: { id, status: "exited" },
      });
    } catch (error) {
      logger.error("Failed to stop container:", error);
      res.status(500).json({ success: false, error: "Failed to stop container" });
    }
  });

  // -------------------------------------------------------------------------
  // Restart Container
  // -------------------------------------------------------------------------
  router.post("/:id/restart", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { t } = req.body; // timeout in seconds

      logger.info(`Restarting container: ${id}`);

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // await container.restart({ t: t ?? 10 });

      res.json({
        success: true,
        data: { id, status: "running" },
      });
    } catch (error) {
      logger.error("Failed to restart container:", error);
      res.status(500).json({ success: false, error: "Failed to restart container" });
    }
  });

  // -------------------------------------------------------------------------
  // Pause/Unpause Container
  // -------------------------------------------------------------------------
  router.post("/:id/pause", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      logger.info(`Pausing container: ${id}`);

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // await container.pause();

      res.json({
        success: true,
        data: { id, status: "paused" },
      });
    } catch (error) {
      logger.error("Failed to pause container:", error);
      res.status(500).json({ success: false, error: "Failed to pause container" });
    }
  });

  router.post("/:id/unpause", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      logger.info(`Unpausing container: ${id}`);

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // await container.unpause();

      res.json({
        success: true,
        data: { id, status: "running" },
      });
    } catch (error) {
      logger.error("Failed to unpause container:", error);
      res.status(500).json({ success: false, error: "Failed to unpause container" });
    }
  });

  // -------------------------------------------------------------------------
  // Remove Container
  // -------------------------------------------------------------------------
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { force, v } = req.query; // force remove, remove volumes

      logger.info(`Removing container: ${id}`, { force, v });

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // await container.remove({ force: force === 'true', v: v === 'true' });

      res.json({
        success: true,
        data: { id, removed: true },
      });
    } catch (error) {
      logger.error("Failed to remove container:", error);
      res.status(500).json({ success: false, error: "Failed to remove container" });
    }
  });

  // -------------------------------------------------------------------------
  // Get Container Stats
  // -------------------------------------------------------------------------
  router.get("/:id/stats", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { stream } = req.query;

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // const stats = await container.stats({ stream: stream === 'true' });

      const stats: ContainerStats = {
        id,
        cpuPercent: 2.5,
        memoryUsage: 128 * 1024 * 1024, // 128MB
        memoryLimit: 512 * 1024 * 1024, // 512MB
        memoryPercent: 25.0,
        networkRx: 1024 * 1024, // 1MB
        networkTx: 512 * 1024, // 512KB
        blockRead: 2 * 1024 * 1024, // 2MB
        blockWrite: 1 * 1024 * 1024, // 1MB
        pids: 5,
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("Failed to get container stats:", error);
      res.status(500).json({ success: false, error: "Failed to get container stats" });
    }
  });

  // -------------------------------------------------------------------------
  // Get Container Logs
  // -------------------------------------------------------------------------
  router.get("/:id/logs", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const query = GetLogsQuerySchema.parse(req.query);

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // const logs = await container.logs({
      //   follow: query.follow,
      //   stdout: query.stdout,
      //   stderr: query.stderr,
      //   since: query.since,
      //   until: query.until,
      //   timestamps: query.timestamps,
      //   tail: query.tail,
      // });

      if (query.follow) {
        // 流式响应
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");

        // 模拟流式日志
        const interval = setInterval(() => {
          res.write(`[${new Date().toISOString()}] Log line from container ${id}\n`);
        }, 1000);

        req.on("close", () => {
          clearInterval(interval);
        });

        return;
      }

      res.json({
        success: true,
        data: {
          id,
          logs: `[${new Date().toISOString()}] Container started\n[${new Date().toISOString()}] Ready\n`,
        },
      });
    } catch (error) {
      logger.error("Failed to get container logs:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors });
      } else {
        res.status(500).json({ success: false, error: "Failed to get container logs" });
      }
    }
  });

  // -------------------------------------------------------------------------
  // Execute Command in Container
  // -------------------------------------------------------------------------
  router.post("/:id/exec", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const body = ExecContainerSchema.parse(req.body);

      logger.info(`Executing command in container: ${id}`, { cmd: body.cmd });

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // const exec = await container.exec({
      //   Cmd: body.cmd,
      //   Env: Object.entries(body.env ?? {}).map(([k, v]) => `${k}=${v}`),
      //   WorkingDir: body.workdir,
      //   User: body.user,
      //   AttachStdout: true,
      //   AttachStderr: true,
      // });
      // const stream = await exec.start();

      const execId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const result: ContainerExecResult = {
        exitCode: 0,
        stdout: `Executed: ${body.cmd.join(" ")}\n`,
        stderr: "",
      };

      res.json({
        success: true,
        data: {
          execId,
          containerId: id,
          ...result,
        },
      });
    } catch (error) {
      logger.error("Failed to execute in container:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors });
      } else {
        res.status(500).json({ success: false, error: "Failed to execute command" });
      }
    }
  });

  // -------------------------------------------------------------------------
  // List Files in Container
  // -------------------------------------------------------------------------
  router.get("/:id/files", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { path } = req.query;

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // 通过 exec 执行 ls 命令

      res.json({
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
      logger.error("Failed to list files:", error);
      res.status(500).json({ success: false, error: "Failed to list files" });
    }
  });

  // -------------------------------------------------------------------------
  // Get File from Container
  // -------------------------------------------------------------------------
  router.get("/:id/files/*", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const filePath = req.params[0];

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // const archive = await container.getArchive({ path: filePath });

      res.json({
        success: true,
        data: {
          id,
          path: filePath,
          content: "file content here",
        },
      });
    } catch (error) {
      logger.error("Failed to get file:", error);
      res.status(500).json({ success: false, error: "Failed to get file" });
    }
  });

  // -------------------------------------------------------------------------
  // Copy Files to Container
  // -------------------------------------------------------------------------
  router.post("/:id/files", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { path, content } = req.body;

      if (!path || content === undefined) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: path, content",
        });
        return;
      }

      logger.info(`Copying file to container: ${id}`, { path });

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // await container.putArchive(archive, { path: dirname(path) });

      res.json({
        success: true,
        data: { id, path, copied: true },
      });
    } catch (error) {
      logger.error("Failed to copy file:", error);
      res.status(500).json({ success: false, error: "Failed to copy file" });
    }
  });

  // -------------------------------------------------------------------------
  // Export Container
  // -------------------------------------------------------------------------
  router.get("/:id/export", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      res.setHeader("Content-Type", "application/x-tar");
      res.setHeader("Content-Disposition", `attachment; filename="container_${id}.tar"`);

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // const stream = await container.export();
      // stream.pipe(res);

      res.status(501).json({
        success: false,
        error: "Export not implemented",
      });
    } catch (error) {
      logger.error("Failed to export container:", error);
      res.status(500).json({ success: false, error: "Failed to export container" });
    }
  });

  // -------------------------------------------------------------------------
  // Create Image from Container
  // -------------------------------------------------------------------------
  router.post("/:id/commit", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { repo, tag, message, author, changes } = req.body;

      if (!repo) {
        res.status(400).json({
          success: false,
          error: "Missing required field: repo",
        });
        return;
      }

      logger.info(`Committing container: ${id}`, { repo, tag });

      // TODO: 实际调用 Docker API
      // const container = docker.getContainer(id);
      // const image = await container.commit({
      //   repo,
      //   tag: tag ?? 'latest',
      //   comment: message,
      //   author,
      //   changes,
      // });

      res.json({
        success: true,
        data: {
          id,
          imageId: `sha256:${Math.random().toString(16).slice(2, 66)}`,
          repo,
          tag: tag ?? "latest",
        },
      });
    } catch (error) {
      logger.error("Failed to commit container:", error);
      res.status(500).json({ success: false, error: "Failed to commit container" });
    }
  });

  return router;
}

// ============================================================================
// Default Export
// ============================================================================

export default createContainerRoutes;
