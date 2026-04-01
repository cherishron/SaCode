import { describe, it, expect, beforeEach } from "vitest";
import { SmartRouter, RuleTemplates } from "../smart-router";
import type { RoutingRule, RoutingCondition, RoutingAction, Message, Session } from "../smart-router";

// Helper to create a test message
function createMessage(content: string, overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-" + Date.now(),
    role: "user",
    content,
    timestamp: new Date(),
    channelId: "test-channel",
    ...overrides,
  };
}

// Helper to create a test session
function createSession(): Session {
  return {
    id: "session-1",
    channelId: "test-channel",
    platform: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
    messageCount: 0,
    status: "active",
  };
}

// Helper to create a routing rule
function createRule(overrides: Partial<RoutingRule> = {}): RoutingRule {
  return {
    id: "rule-" + Date.now() + Math.random(),
    name: "Test Rule",
    enabled: true,
    priority: 100,
    conditions: [],
    conditionLogic: "and",
    actions: [],
    ...overrides,
  };
}

describe("SmartRouter", () => {
  let router: SmartRouter;

  beforeEach(() => {
    router = new SmartRouter();
  });

  describe("Rule Management", () => {
    it("should add a rule", async () => {
      const rule = createRule({
        name: "Test Rule",
        conditions: [{ field: "content", operator: "contains", value: "hello" }],
        actions: [{ type: "reply", config: { message: "Hi there!" } }],
      });

      await router.addRule(rule);
      const rules = router.getRules();

      expect(rules).toHaveLength(1);
      expect(rules[0]?.name).toBe("Test Rule");
    });

    it("should get rule by id", async () => {
      const rule = createRule({ name: "Test Rule" });
      await router.addRule(rule);

      const retrieved = router.getRule(rule.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Rule");
    });

    it("should update a rule", async () => {
      const rule = createRule({ name: "Original Name" });
      await router.addRule(rule);

      const updatedRule = { ...rule, name: "Updated Name" };
      await router.updateRule(updatedRule);

      const retrieved = router.getRule(rule.id);
      expect(retrieved?.name).toBe("Updated Name");
    });

    it("should delete a rule", async () => {
      const rule = createRule({ name: "Test Rule" });
      await router.addRule(rule);

      await router.deleteRule(rule.id);
      const rules = router.getRules();

      expect(rules).toHaveLength(0);
    });

    it("should get all rules", async () => {
      await router.addRule(createRule({ name: "Rule 1" }));
      await router.addRule(createRule({ name: "Rule 2" }));

      const rules = router.getRules();
      expect(rules).toHaveLength(2);
    });
  });

  describe("Condition Evaluation", () => {
    it("should match equals condition", async () => {
      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "equals", value: "hello" }],
          actions: [{ type: "reply", config: { message: "Hi!" } }],
        })
      );

      const message = createMessage("hello");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.matched).toBe(true);
    });

    it("should match contains condition", async () => {
      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "contains", value: "help" }],
          actions: [{ type: "reply", config: { message: "How can I help?" } }],
        })
      );

      const message = createMessage("I need some help please");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.some((r) => r.matched)).toBe(true);
    });

    it("should match starts_with condition", async () => {
      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "starts_with", value: "/command" }],
          actions: [{ type: "reply", config: { message: "Command received" } }],
        })
      );

      const message = createMessage("/command arg1 arg2");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.some((r) => r.matched)).toBe(true);
    });

    it("should match ends_with condition", async () => {
      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "ends_with", value: "!!!" }],
          actions: [{ type: "reply", config: { message: "Excited!" } }],
        })
      );

      const message = createMessage("Hello World!!!");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.some((r) => r.matched)).toBe(true);
    });

    it("should match regex with matches condition", async () => {
      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "matches", value: "^\\d{4}$" }],
          actions: [{ type: "reply", config: { message: "Got a 4-digit number" } }],
        })
      );

      const message = createMessage("1234");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.some((r) => r.matched)).toBe(true);
    });

    it("should not match when conditions fail", async () => {
      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "equals", value: "exact" }],
          actions: [{ type: "reply", config: { message: "Match!" } }],
        })
      );

      const message = createMessage("not exact");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.every((r) => !r.matched)).toBe(true);
    });

    it("should not match disabled rules", async () => {
      await router.addRule(
        createRule({
          enabled: false,
          conditions: [{ field: "content", operator: "contains", value: "test" }],
          actions: [{ type: "reply", config: { message: "Test" } }],
        })
      );

      const message = createMessage("test message");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.every((r) => !r.matched)).toBe(true);
    });

    it("should match multiple conditions with AND logic", async () => {
      await router.addRule(
        createRule({
          conditions: [
            { field: "content", operator: "contains", value: "hello" },
            { field: "role", operator: "equals", value: "user" },
          ],
          conditionLogic: "and",
          actions: [{ type: "reply", config: { message: "Hello user!" } }],
        })
      );

      const message = createMessage("hello there");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.some((r) => r.matched)).toBe(true);
    });

    it("should match conditions with OR logic", async () => {
      await router.addRule(
        createRule({
          conditions: [
            { field: "content", operator: "contains", value: "hello" },
            { field: "content", operator: "contains", value: "hi" },
          ],
          conditionLogic: "or",
          actions: [{ type: "reply", config: { message: "Greeting!" } }],
        })
      );

      const message = createMessage("hi there");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results.some((r) => r.matched)).toBe(true);
    });
  });

  describe("Priority Handling", () => {
    it("should process higher priority rules first", async () => {
      await router.addRule(
        createRule({
          name: "Low Priority",
          priority: 10,
          conditions: [{ field: "content", operator: "contains", value: "test" }],
          actions: [{ type: "reply", config: { message: "Low" } }],
        })
      );

      await router.addRule(
        createRule({
          name: "High Priority",
          priority: 100,
          conditions: [{ field: "content", operator: "contains", value: "test" }],
          actions: [{ type: "reply", config: { message: "High" } }],
        })
      );

      const message = createMessage("test message");
      const session = createSession();
      const results = await router.route(message, session);

      // First result should be from high priority rule
      expect(results[0]?.rule?.name).toBe("High Priority");
    });
  });

  describe("Actions", () => {
    it("should include actions in result", async () => {
      const action: RoutingAction = { type: "reply", config: { message: "Test reply" } };
      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "equals", value: "hi" }],
          actions: [action],
        })
      );

      const message = createMessage("hi");
      const session = createSession();
      const results = await router.route(message, session);

      expect(results[0]?.actions).toContainEqual(action);
    });
  });

  describe("Events", () => {
    it("should emit events on rule execution", async () => {
      const eventHandler = vi.fn();
      router.on("event", eventHandler);

      await router.addRule(
        createRule({
          conditions: [{ field: "content", operator: "equals", value: "test" }],
          actions: [{ type: "reply", config: { message: "Test" } }],
        })
      );

      const message = createMessage("test");
      const session = createSession();
      await router.route(message, session);

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe("Rule Templates", () => {
    it("should have predefined templates", () => {
      expect(RuleTemplates).toBeDefined();
      expect(Object.keys(RuleTemplates).length).toBeGreaterThan(0);
    });
  });
});