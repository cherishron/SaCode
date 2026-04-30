import { Hono } from "hono";
import {
  SmartRouter,
  type RoutingRule,
  type RoutingAction,
} from "@sacode/core";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

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

// GET /api/routing/rules
router.get("/rules", authMiddleware, async (c) => {
  try {
    const router_ = getSmartRouter();
    const rules = router_.getRules();

    return c.json(rules);
  } catch (error) {
    console.error("Get rules error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/routing/rules/:id
router.get("/rules/:id", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const router_ = getSmartRouter();
    const rule = router_.getRule(id);

    if (!rule) {
      return c.json({ error: "Rule not found" }, 404);
    }

    return c.json(rule);
  } catch (error) {
    console.error("Get rule error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/routing/rules
router.post("/rules", authMiddleware, async (c) => {
  try {
    const rule = await c.req.json() as Omit<RoutingRule, "id" | "createdAt" | "updatedAt">;

    if (!rule.name || !rule.conditions || !rule.actions) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const router_ = getSmartRouter();
    const newRule = router_.addRule(rule);

    return c.json(newRule, 201);
  } catch (error) {
    console.error("Create rule error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /api/routing/rules/:id
router.put("/rules/:id", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const updates = await c.req.json() as Partial<RoutingRule>;

    const router_ = getSmartRouter();
    const rule = router_.updateRule(id, updates);

    if (!rule) {
      return c.json({ error: "Rule not found" }, 404);
    }

    return c.json(rule);
  } catch (error) {
    console.error("Update rule error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /api/routing/rules/:id
router.delete("/rules/:id", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const router_ = getSmartRouter();

    const removed = router_.removeRule(id);

    if (!removed) {
      return c.json({ error: "Rule not found" }, 404);
    }

    return c.body(null, 204);
  } catch (error) {
    console.error("Delete rule error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/routing/rules/:id/enable
router.post("/rules/:id/enable", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const router_ = getSmartRouter();

    const rule = router_.updateRule(id, { enabled: true });

    if (!rule) {
      return c.json({ error: "Rule not found" }, 404);
    }

    return c.json(rule);
  } catch (error) {
    console.error("Enable rule error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/routing/rules/:id/disable
router.post("/rules/:id/disable", authMiddleware, async (c) => {
  try {
    const id = c.req.param("id");
    const router_ = getSmartRouter();

    const rule = router_.updateRule(id, { enabled: false });

    if (!rule) {
      return c.json({ error: "Rule not found" }, 404);
    }

    return c.json(rule);
  } catch (error) {
    console.error("Disable rule error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/routing/rules/reorder
router.post("/rules/reorder", authMiddleware, async (c) => {
  try {
    const { ruleIds } = await c.req.json() as { ruleIds: string[] };

    if (!Array.isArray(ruleIds)) {
      return c.json({ error: "ruleIds must be an array" }, 400);
    }

    const router_ = getSmartRouter();
    router_.reorderRules(ruleIds);

    return c.json(router_.getRules());
  } catch (error) {
    console.error("Reorder rules error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/routing/evaluate
router.post("/evaluate", authMiddleware, async (c) => {
  try {
    const { message, session } = await c.req.json();

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    const router_ = getSmartRouter();
    const result = await router_.evaluate(message, session);

    return c.json(result);
  } catch (error) {
    console.error("Evaluate error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/routing/templates
router.get("/templates", authMiddleware, async (c) => {
  try {
    const router_ = getSmartRouter();
    const templates = router_.getRuleTemplates();

    return c.json(templates);
  } catch (error) {
    console.error("Get templates error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/routing/templates/:name/apply
router.post("/templates/:name/apply", authMiddleware, async (c) => {
  try {
    const name = c.req.param("name");
    const overrides = await c.req.json();

    const router_ = getSmartRouter();
    const rule = router_.applyTemplate(name, overrides);

    if (!rule) {
      return c.json({ error: "Template not found" }, 404);
    }

    return c.json(rule, 201);
  } catch (error) {
    console.error("Apply template error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/routing/stats
router.get("/stats", authMiddleware, async (c) => {
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

    return c.json(stats);
  } catch (error) {
    console.error("Get routing stats error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default router;
