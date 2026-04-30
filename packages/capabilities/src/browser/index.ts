import { chromium, type Browser, type Page } from "playwright";
import type {
  ToolDefinition,
  BrowserNavigateInput,
  BrowserClickInput,
  BrowserTypeInput,
  BrowserScreenshotInput,
  BrowserExtractInput,
  BrowserCapabilityConfig,
} from "../types";

export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: BrowserCapabilityConfig;

  constructor(config: BrowserCapabilityConfig) {
    this.config = config;
  }

  async launch(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error("Browser capability is disabled");
    }

    this.browser = await chromium.launch({
      headless: this.config.headless,
    });

    const context = await this.browser.newContext();
    this.page = await context.newPage();
    this.page.setDefaultTimeout(this.config.timeout);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error("Browser not launched");
    }
    return this.page;
  }

  isLaunched(): boolean {
    return this.browser !== null;
  }
}

function mapWaitUntil(waitUntil?: string): "load" | "domcontentloaded" | "networkidle" | undefined {
  if (!waitUntil) return undefined;
  if (waitUntil === "networkidle0") return "networkidle";
  return waitUntil as "load" | "domcontentloaded" | "networkidle";
}

export function createBrowserTools(
  config: BrowserCapabilityConfig,
  getManager: () => BrowserManager
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  tools.push({
    name: "browser_navigate",
    description: "导航到指定 URL",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "url" in input) {
          return input as BrowserNavigateInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Browser capability is disabled");
      }

      const { url, waitUntil } = input as BrowserNavigateInput;
      const manager = getManager();
      if (!manager.isLaunched()) {
        await manager.launch();
      }

      const page = manager.getPage();
      await page.goto(url, { waitUntil: mapWaitUntil(waitUntil) || "load" });

      return { url, title: await page.title() };
    },
  });

  tools.push({
    name: "browser_click",
    description: "点击页面元素",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "selector" in input) {
          return input as BrowserClickInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Browser capability is disabled");
      }

      const { selector, timeout } = input as BrowserClickInput;
      const manager = getManager();
      const page = manager.getPage();

      if (timeout) {
        await page.waitForSelector(selector, { timeout });
      }
      await page.click(selector);

      return { success: true, selector };
    },
  });

  tools.push({
    name: "browser_type",
    description: "在输入框中输入文本",
    inputSchema: {
      parse: (input: unknown) => {
        if (
          typeof input === "object" &&
          input !== null &&
          "selector" in input &&
          "text" in input
        ) {
          return input as BrowserTypeInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Browser capability is disabled");
      }

      const { selector, text, delay } = input as BrowserTypeInput;
      const manager = getManager();
      const page = manager.getPage();

      await page.fill(selector, text);
      if (delay && delay > 0) {
        await page.type(selector, "", { delay });
      }

      return { success: true, selector, text };
    },
  });

  tools.push({
    name: "browser_screenshot",
    description: "截取页面截图",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null) {
          return input as BrowserScreenshotInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Browser capability is disabled");
      }

      const { selector, fullPage } = input as BrowserScreenshotInput;
      const manager = getManager();
      const page = manager.getPage();

      let screenshot: Buffer;

      if (selector) {
        const element = await page.$(selector);
        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }
        screenshot = (await element.screenshot()) as Buffer;
      } else {
        screenshot = (await page.screenshot({ fullPage: fullPage ?? false })) as Buffer;
      }

      return {
        success: true,
        data: screenshot.toString("base64"),
        mimeType: "image/png",
      };
    },
  });

  tools.push({
    name: "browser_extract",
    description: "提取页面元素内容",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "selector" in input) {
          return input as BrowserExtractInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown) => {
      if (!config.enabled) {
        throw new Error("Browser capability is disabled");
      }

      const { selector, attribute } = input as BrowserExtractInput;
      const manager = getManager();
      const page = manager.getPage();

      if (attribute) {
        const value = await page.$eval(
          selector,
          (el, attr) => el.getAttribute(attr),
          attribute
        );
        return { value };
      } else {
        const text = await page.$eval(selector, (el) => el.textContent);
        return { text };
      }
    },
  });

  return tools;
}
