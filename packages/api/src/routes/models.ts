import { Hono } from "hono";
import {
  ModelManager,
  ModelTemplates,
  type ModelConfig,
  type ModelCapabilityRequirement,
} from "@sacode/core";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

let modelManager: ModelManager | null = null;

function getModelManager(): ModelManager {
  if (!modelManager) {
    modelManager = new ModelManager({
      selectionStrategy: "default",
    });
  }
  return modelManager;
}

// GET /api/models/templates
router.get("/templates", (c) => {
  const templates = Object.entries(ModelTemplates).map(([id, template]) => ({
    id,
    ...template,
  }));

  return c.json(templates);
});

// GET /api/models
router.get("/", authMiddleware, (c) => {
  const manager = getModelManager();
  const models = manager.getAllModels();

  const safeModels = models.map((m) => ({
    ...m,
    apiKey: m.apiKey ? "********" : undefined,
  }));

  return c.json(safeModels);
});

// GET /api/models/default
router.get("/default", authMiddleware, (c) => {
  const manager = getModelManager();
  const defaultModel = manager.getDefaultModel();

  if (!defaultModel) {
    return c.json({ error: "No default model configured" }, 404);
  }

  return c.json({
    ...defaultModel,
    apiKey: defaultModel.apiKey ? "********" : undefined,
  });
});

// GET /api/models/:id
router.get("/:id", authMiddleware, (c) => {
  const manager = getModelManager();
  const model = manager.getModel(c.req.param("id"));

  if (!model) {
    return c.json({ error: "Model not found" }, 404);
  }

  return c.json({
    ...model,
    apiKey: model.apiKey ? "********" : undefined,
  });
});

// POST /api/models
router.post("/", authMiddleware, (c) => {
  try {
    const manager = getModelManager();
    const body = c.req.json() as Promise<Partial<ModelConfig> & { id: string }>;
    return body.then((data) => {
      const model = manager.addModel(data);

      return c.json({
        ...model,
        apiKey: model.apiKey ? "********" : undefined,
      }, 201);
    });
  } catch (error) {
    console.error("Add model error:", error);
    return c.json({ error: "Invalid model configuration" }, 400);
  }
});

// POST /api/models/from-template
router.post("/from-template", authMiddleware, async (c) => {
  try {
    const { templateId, overrides } = await c.req.json();
    const manager = getModelManager();

    const model = manager.addModelFromTemplate(templateId, overrides);
    if (!model) {
      return c.json({ error: "Template not found" }, 404);
    }

    return c.json({
      ...model,
      apiKey: model.apiKey ? "********" : undefined,
    }, 201);
  } catch (error) {
    console.error("Add model from template error:", error);
    return c.json({ error: "Failed to add model from template" }, 400);
  }
});

// PATCH /api/models/:id
router.patch("/:id", authMiddleware, async (c) => {
  try {
    const manager = getModelManager();
    const body = await c.req.json();
    const model = manager.updateModel(c.req.param("id"), body);

    if (!model) {
      return c.json({ error: "Model not found" }, 404);
    }

    return c.json({
      ...model,
      apiKey: model.apiKey ? "********" : undefined,
    });
  } catch (error) {
    console.error("Update model error:", error);
    return c.json({ error: "Invalid model configuration" }, 400);
  }
});

// DELETE /api/models/:id
router.delete("/:id", authMiddleware, (c) => {
  const manager = getModelManager();
  const removed = manager.removeModel(c.req.param("id"));

  if (!removed) {
    return c.json({ error: "Model not found" }, 404);
  }

  return c.body(null, 204);
});

// POST /api/models/:id/set-default
router.post("/:id/set-default", authMiddleware, (c) => {
  const manager = getModelManager();
  const success = manager.setDefaultModel(c.req.param("id"));

  if (!success) {
    return c.json({ error: "Model not found" }, 404);
  }

  return c.json({ success: true, defaultModelId: c.req.param("id") });
});

// POST /api/models/select
router.post("/select", authMiddleware, async (c) => {
  const { requirements, sessionId } = await c.req.json() as {
    requirements?: ModelCapabilityRequirement;
    sessionId?: string;
  };

  const manager = getModelManager();
  const model = manager.selectModel(sessionId, requirements);

  if (!model) {
    return c.json({ error: "No suitable model found" }, 404);
  }

  return c.json({
    ...model,
    apiKey: model.apiKey ? "********" : undefined,
  });
});

// POST /api/models/switch
router.post("/switch", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { modelId, sessionId, reason } = await c.req.json();

    const manager = getModelManager();
    const model = manager.switchModel(modelId, sessionId, reason);

    if (!model) {
      return c.json({ error: "Model not found or disabled" }, 404);
    }

    if (sessionId) {
      const prisma = getPrismaClient();
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { modelId },
      });
    }

    return c.json({
      success: true,
      model: {
        ...model,
        apiKey: model.apiKey ? "********" : undefined,
      },
    });
  } catch (error) {
    console.error("Switch model error:", error);
    return c.json({ error: "Failed to switch model" }, 500);
  }
});

// GET /api/models/session/:sessionId
router.get("/session/:sessionId", authMiddleware, async (c) => {
  const sessionId = c.req.param("sessionId");
  const manager = getModelManager();

  const prisma = getPrismaClient();
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { modelId: true },
  });

  if (session?.modelId) {
    const model = manager.getModel(session.modelId);
    if (model) {
      return c.json({
        ...model,
        apiKey: model.apiKey ? "********" : undefined,
      });
    }
  }

  const sessionModel = manager.getSessionModel(sessionId);
  if (sessionModel) {
    return c.json({
      ...sessionModel,
      apiKey: sessionModel.apiKey ? "********" : undefined,
    });
  }

  const defaultModel = manager.getDefaultModel();
  if (defaultModel) {
    return c.json({
      ...defaultModel,
      apiKey: defaultModel.apiKey ? "********" : undefined,
    });
  }

  return c.json({ error: "No model available" }, 404);
});

// POST /api/models/config/import
router.post("/config/import", authMiddleware, async (c) => {
  try {
    const manager = getModelManager();
    const body = await c.req.json();
    manager.importConfig(body);
    return c.json({ success: true });
  } catch (error) {
    console.error("Import config error:", error);
    return c.json({ error: "Failed to import configuration" }, 400);
  }
});

// GET /api/models/config/export
router.get("/config/export", authMiddleware, (c) => {
  const manager = getModelManager();
  const config = manager.exportConfig();

  const safeConfig = {
    ...config,
    models: config.models.map((m) => ({
      ...m,
      apiKey: m.apiKey ? "********" : undefined,
    })),
  };

  return c.json(safeConfig);
});

export default router;
