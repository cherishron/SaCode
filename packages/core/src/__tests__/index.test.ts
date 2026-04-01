import { describe, it, expect } from "vitest";
import { SaClawClient, SessionManager, SessionMapper, MessageRouter } from "../index";

describe("SaClawClient", () => {
  it("should create client with config", () => {
    const client = new SaClawClient({
      acpUrl: "ws://localhost:8090/acp",
      autoStart: false,
      timeout: 60000,
    });

    expect(client).toBeDefined();
  });

  it("should have connect and disconnect methods", () => {
    const client = new SaClawClient({
      acpUrl: "ws://localhost:8090/acp",
      autoStart: false,
      timeout: 60000,
    });

    expect(client.connect).toBeDefined();
    expect(client.disconnect).toBeDefined();
    expect(client.chat).toBeDefined();
  });
});

describe("SessionManager", () => {
  it("should create and manage sessions", () => {
    const manager = new SessionManager();

    const session = manager.create({
      channelId: "test-channel",
      platform: "wechat",
    });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(manager.get(session.id)).toBeDefined();
  });

  it("should delete sessions", () => {
    const manager = new SessionManager();

    const session = manager.create({
      channelId: "test-channel",
      platform: "wechat",
    });

    manager.delete(session.id);
    expect(manager.get(session.id)).toBeUndefined();
  });
});

describe("SessionMapper", () => {
  it("should create and find mappings", () => {
    const mapper = new SessionMapper({ enablePersistence: false });

    const sessionId = mapper.createMapping("telegram", "123456789");
    expect(sessionId).toBeDefined();

    const entry = mapper.findByChannel("telegram", "123456789");
    expect(entry).toBeDefined();
    expect(entry?.sessionId).toBe(sessionId);

    mapper.destroy();
  });

  it("should get or create mapping", () => {
    const mapper = new SessionMapper({ enablePersistence: false });

    const result1 = mapper.getOrCreate("wechat", "user_abc");
    expect(result1.isNew).toBe(true);

    const result2 = mapper.getOrCreate("wechat", "user_abc");
    expect(result2.isNew).toBe(false);
    expect(result2.sessionId).toBe(result1.sessionId);

    mapper.destroy();
  });

  it("should delete mappings", () => {
    const mapper = new SessionMapper({ enablePersistence: false });

    mapper.createMapping("discord", "channel_xyz");
    const deleted = mapper.deleteByChannel("discord", "channel_xyz");
    expect(deleted).toBe(true);

    const entry = mapper.findByChannel("discord", "channel_xyz");
    expect(entry).toBeUndefined();

    mapper.destroy();
  });
});

describe("MessageRouter", () => {
  it("should route messages to handlers", () => {
    const router = new MessageRouter();
    let received = false;

    router.on("routed", () => {
      received = true;
    });

    const session = {
      id: "test-session",
      channelId: "test-channel",
      platform: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0,
      status: "active" as const,
      metadata: undefined,
    };

    const message = {
      id: "test-msg",
      role: "user" as const,
      content: "test",
      timestamp: new Date(),
      channelId: "test-channel",
    };

    router.route(message, session).then(() => {
      expect(received).toBe(true);
    });
  });
});
