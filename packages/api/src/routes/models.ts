/**
 * 模型管理 API 路由
 *
 * 提供多模型配置、切换、能力查询等功能
 */

import { Router, type Request, type Response } from "express";
import {
  ModelManager,
  ModelTemplates,
  type ModelConfig,
  type ModelCapabilityRequirement,
} from "@saclaw/core";
import { getPrismaClient } from "@saclaw/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 全局模型管理器实例
let modelManager: ModelManager | null = null;

/**
 * 获取或初始化模型管理器
 */
function getModelManager(): ModelManager {
  if (!modelManager) {
    modelManager = new ModelManager({
      selectionStrategy: "default",
    });
  }
  return modelManager;
}

/**
 * GET /api/models/templates
 * 获取可用的模型模板
 */
router.get("/templates", (_req: Request, res: Response) => {
  const templates = Object.entries(ModelTemplates).map(([id, template]) => ({
    id,
    ...template,
  }));

  res.json(templates);
});

/**
 * GET /api/models
 * 获取所有已配置的模型
 */
router.get("/", authMiddleware, (_req: Request, res: Response) => {
  const manager = getModelManager();
  const models = manager.getAllModels();

  // 隐藏敏感信息
  const safeModels = models.map((m) => ({
    ...m,
    apiKey: m.apiKey ? "********" : undefined,
  }));

  res.json(safeModels);
});

/**
 * GET /api/models/default
 * 获取默认模型
 */
router.get("/default", authMiddleware, (_req: Request, res: Response) => {
  const manager = getModelManager();
  const defaultModel = manager.getDefaultModel();

  if (!defaultModel) {
    res.status(404).json({ error: "No default model configured" });
    return;
  }

  res.json({
    ...defaultModel,
    apiKey: defaultModel.apiKey ? "********" : undefined,
  });
});

/**
 * GET /api/models/:id
 * 获取指定模型配置
 */
router.get("/:id", authMiddleware, (req: Request, res: Response) => {
  const manager = getModelManager();
  const model = manager.getModel(req.params.id);

  if (!model) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  res.json({
    ...model,
    apiKey: model.apiKey ? "********" : undefined,
  });
});

/**
 * POST /api/models
 * 添加新模型
 */
router.post("/", authMiddleware, (req: Request, res: Response) => {
  try {
    const manager = getModelManager();
    const model = manager.addModel(req.body as Partial<ModelConfig> & { id: string });

    res.status(201).json({
      ...model,
      apiKey: model.apiKey ? "********" : undefined,
    });
  } catch (error) {
    console.error("Add model error:", error);
    res.status(400).json({ error: "Invalid model configuration" });
  }
});

/**
 * POST /api/models/from-template
 * 从模板添加模型
 */
router.post("/from-template", authMiddleware, (req: Request, res: Response) => {
  try {
    const { templateId, overrides } = req.body;
    const manager = getModelManager();

    const model = manager.addModelFromTemplate(templateId, overrides);
    if (!model) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    res.status(201).json({
      ...model,
      apiKey: model.apiKey ? "********" : undefined,
    });
  } catch (error) {
    console.error("Add model from template error:", error);
    res.status(400).json({ error: "Failed to add model from template" });
  }
});

/**
 * PATCH /api/models/:id
 * 更新模型配置
 */
router.patch("/:id", authMiddleware, (req: Request, res: Response) => {
  try {
    const manager = getModelManager();
    const model = manager.updateModel(req.params.id, req.body);

    if (!model) {
      res.status(404).json({ error: "Model not found" });
      return;
    }

    res.json({
      ...model,
      apiKey: model.apiKey ? "********" : undefined,
    });
  } catch (error) {
    console.error("Update model error:", error);
    res.status(400).json({ error: "Invalid model configuration" });
  }
});

/**
 * DELETE /api/models/:id
 * 删除模型
 */
router.delete("/:id", authMiddleware, (req: Request, res: Response) => {
  const manager = getModelManager();
  const removed = manager.removeModel(req.params.id);

  if (!removed) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  res.status(204).send();
});

/**
 * POST /api/models/:id/set-default
 * 设置默认模型
 */
router.post("/:id/set-default", authMiddleware, (req: Request, res: Response) => {
  const manager = getModelManager();
  const success = manager.setDefaultModel(req.params.id);

  if (!success) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  res.json({ success: true, defaultModelId: req.params.id });
});

/**
 * POST /api/models/select
 * 根据能力需求选择模型
 */
router.post("/select", authMiddleware, (req: Request, res: Response) => {
  const { requirements, sessionId } = req.body as {
    requirements?: ModelCapabilityRequirement;
    sessionId?: string;
  };

  const manager = getModelManager();
  const model = manager.selectModel(sessionId, requirements);

  if (!model) {
    res.status(404).json({ error: "No suitable model found" });
    return;
  }

  res.json({
    ...model,
    apiKey: model.apiKey ? "********" : undefined,
  });
});

/**
 * POST /api/models/switch
 * 切换会话模型
 */
router.post("/switch", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { modelId, sessionId, reason } = req.body;

    const manager = getModelManager();
    const model = manager.switchModel(modelId, sessionId, reason);

    if (!model) {
      res.status(404).json({ error: "Model not found or disabled" });
      return;
    }

    // 如果有会话 ID，更新数据库中的会话模型
    if (sessionId) {
      const prisma = getPrismaClient();
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { modelId },
      });
    }

    res.json({
      success: true,
      model: {
        ...model,
        apiKey: model.apiKey ? "********" : undefined,
      },
    });
  } catch (error) {
    console.error("Switch model error:", error);
    res.status(500).json({ error: "Failed to switch model" });
  }
});

/**
 * GET /api/models/session/:sessionId
 * 获取会话当前模型
 */
router.get("/session/:sessionId", authMiddleware, async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const manager = getModelManager();

  // 先检查数据库中的会话模型
  const prisma = getPrismaClient();
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { modelId: true },
  });

  if (session?.modelId) {
    const model = manager.getModel(session.modelId);
    if (model) {
      res.json({
        ...model,
        apiKey: model.apiKey ? "********" : undefined,
      });
      return;
    }
  }

  // 使用模型管理器的会话绑定
  const sessionModel = manager.getSessionModel(sessionId);
  if (sessionModel) {
    res.json({
      ...sessionModel,
      apiKey: sessionModel.apiKey ? "********" : undefined,
    });
    return;
  }

  // 返回默认模型
  const defaultModel = manager.getDefaultModel();
  if (defaultModel) {
    res.json({
      ...defaultModel,
      apiKey: defaultModel.apiKey ? "********" : undefined,
    });
    return;
  }

  res.status(404).json({ error: "No model available" });
});

/**
 * POST /api/models/config/import
 * 导入模型配置
 */
router.post("/config/import", authMiddleware, (req: Request, res: Response) => {
  try {
    const manager = getModelManager();
    manager.importConfig(req.body);
    res.json({ success: true });
  } catch (error) {
    console.error("Import config error:", error);
    res.status(400).json({ error: "Failed to import configuration" });
  }
});

/**
 * GET /api/models/config/export
 * 导出模型配置
 */
router.get("/config/export", authMiddleware, (_req: Request, res: Response) => {
  const manager = getModelManager();
  const config = manager.exportConfig();

  // 隐藏敏感信息
  const safeConfig = {
    ...config,
    models: config.models.map((m) => ({
      ...m,
      apiKey: m.apiKey ? "********" : undefined,
    })),
  };

  res.json(safeConfig);
});

export default router;
