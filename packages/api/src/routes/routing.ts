import { Router, type Request, type Response } from "express";
import {
  SmartRouter,
  type RoutingRule,
  type RoutingCondition,
  type RoutingAction,
} from "@sacode/core";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 智能路由器实例
let smartRouter: SmartRouter | null = null;

function getSmartRouter(): SmartRouter {
  if (!smartRouter) {
    smartRouter = new SmartRouter({
      rules: [],
      onAction: async (action: RoutingAction, context: unknown) => {
        console.log(`[SmartRouter] Executing action: ${action.type}`);
      },
    });
  }
  return smartRouter;
}

// GET /api/routing/rules - 获取路由规则列表
router.get("/rules", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const router_ = getSmartRouter();
    const rules = router_.getRules();

    res.json(rules);
  } catch (error) {
    console.error("Get rules error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/routing/rules/:id - 获取单个规则
router.get("/rules/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const router_ = getSmartRouter();
    const rule = router_.getRule(id);

    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    res.json(rule);
  } catch (error) {
    console.error("Get rule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/routing/rules - 创建路由规则
router.post("/rules", authMiddleware, async (req: Request, res: Response) => {
  try {
    const rule = req.body as Omit<RoutingRule, "id" | "createdAt" | "updatedAt">;

    if (!rule.name || !rule.conditions || !rule.actions) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const router_ = getSmartRouter();
    const newRule = router_.addRule(rule);

    res.status(201).json(newRule);
  } catch (error) {
    console.error("Create rule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/routing/rules/:id - 更新路由规则
router.put("/rules/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body as Partial<RoutingRule>;

    const router_ = getSmartRouter();
    const rule = router_.updateRule(id, updates);

    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    res.json(rule);
  } catch (error) {
    console.error("Update rule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/routing/rules/:id - 删除路由规则
router.delete("/rules/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const router_ = getSmartRouter();

    const removed = router_.removeRule(id);

    if (!removed) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error("Delete rule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/routing/rules/:id/enable - 启用规则
router.post("/rules/:id/enable", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const router_ = getSmartRouter();

    const rule = router_.updateRule(id, { enabled: true });

    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    res.json(rule);
  } catch (error) {
    console.error("Enable rule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/routing/rules/:id/disable - 禁用规则
router.post("/rules/:id/disable", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const router_ = getSmartRouter();

    const rule = router_.updateRule(id, { enabled: false });

    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    res.json(rule);
  } catch (error) {
    console.error("Disable rule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/routing/rules/reorder - 重新排序规则
router.post("/rules/reorder", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { ruleIds } = req.body as { ruleIds: string[] };

    if (!Array.isArray(ruleIds)) {
      res.status(400).json({ error: "ruleIds must be an array" });
      return;
    }

    const router_ = getSmartRouter();
    router_.reorderRules(ruleIds);

    res.json(router_.getRules());
  } catch (error) {
    console.error("Reorder rules error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/routing/evaluate - 评估消息（测试路由）
router.post("/evaluate", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { message, session } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const router_ = getSmartRouter();
    const result = await router_.evaluate(message, session);

    res.json(result);
  } catch (error) {
    console.error("Evaluate error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/routing/templates - 获取规则模板
router.get("/templates", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const router_ = getSmartRouter();
    const templates = router_.getRuleTemplates();

    res.json(templates);
  } catch (error) {
    console.error("Get templates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/routing/templates/:name/apply - 应用规则模板
router.post(
  "/templates/:name/apply",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const overrides = req.body;

      const router_ = getSmartRouter();
      const rule = router_.applyTemplate(name, overrides);

      if (!rule) {
        res.status(404).json({ error: "Template not found" });
        return;
      }

      res.status(201).json(rule);
    } catch (error) {
      console.error("Apply template error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/routing/stats - 获取路由统计
router.get("/stats", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const router_ = getSmartRouter();
    const rules = router_.getRules();

    const stats = {
      totalRules: rules.length,
      enabledRules: rules.filter((r) => r.enabled).length,
      disabledRules: rules.filter((r) => !r.enabled).length,
      byPriority: {
        critical: rules.filter((r) => r.priority === "critical").length,
        high: rules.filter((r) => r.priority === "high").length,
        medium: rules.filter((r) => r.priority === "medium").length,
        low: rules.filter((r) => r.priority === "low").length,
      },
    };

    res.json(stats);
  } catch (error) {
    console.error("Get routing stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
