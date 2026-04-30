import { Hono } from "hono";
import { CapabilitiesManager, defaultCapabilitiesConfig } from "@sacode/capabilities";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

let capabilitiesManager: CapabilitiesManager | null = null;

function getCapabilitiesManager(): CapabilitiesManager {
  if (!capabilitiesManager) {
    capabilitiesManager = new CapabilitiesManager(defaultCapabilitiesConfig);
  }
  return capabilitiesManager;
}

// GET /api/capabilities
router.get("/", authMiddleware, (c) => {
  try {
    const manager = getCapabilitiesManager();
    const tools = manager.getRegistry().list();

    return c.json(
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      }))
    );
  } catch (error) {
    console.error("Get capabilities error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/capabilities/:name/execute
router.post("/:name/execute", authMiddleware, async (c) => {
  try {
    const { name } = c.req.param();
    const { input } = await c.req.json();

    const manager = getCapabilitiesManager();
    const result = await manager.getRegistry().execute(name, input);

    return c.json({ success: true, result });
  } catch (error) {
    console.error("Execute capability error:", error);
    return c.json({
      error: error instanceof Error ? error.message : "Internal server error",
    }, 500);
  }
});

export default router;
