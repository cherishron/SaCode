import { Router, type Request, type Response } from "express";
import { CapabilitiesManager, defaultCapabilitiesConfig } from "@sacode/capabilities";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// Capabilities manager instance
let capabilitiesManager: CapabilitiesManager | null = null;

function getCapabilitiesManager(): CapabilitiesManager {
  if (!capabilitiesManager) {
    capabilitiesManager = new CapabilitiesManager(defaultCapabilitiesConfig);
  }
  return capabilitiesManager;
}

// GET /api/capabilities - 获取能力列表
router.get("/", authMiddleware, (req: Request, res: Response) => {
  try {
    const manager = getCapabilitiesManager();
    const tools = manager.getRegistry().list();

    res.json(
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      }))
    );
  } catch (error) {
    console.error("Get capabilities error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/capabilities/:name/execute - 执行能力
router.post("/:name/execute", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { input } = req.body;

    const manager = getCapabilitiesManager();
    const result = await manager.getRegistry().execute(name, input);

    res.json({ success: true, result });
  } catch (error) {
    console.error("Execute capability error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
