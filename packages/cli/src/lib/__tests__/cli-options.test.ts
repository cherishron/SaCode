import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRootPrompt, parseToolParams } from "../cli-options";

describe("CLI options", () => {
  it("normalizes root prompt into print chat options", () => {
    expect(normalizeRootPrompt(["hello", "world"], {})).toEqual({
      message: "hello world",
      print: true,
      json: undefined,
      streamJson: undefined,
    });
  });

  it("preserves json and stream-json root prompt flags", () => {
    expect(normalizeRootPrompt(["hello"], { json: true })).toMatchObject({
      message: "hello",
      print: true,
      json: true,
    });
    expect(normalizeRootPrompt(["hello"], { streamJson: true })).toMatchObject({
      message: "hello",
      print: true,
      streamJson: true,
    });
  });

  it("returns null for empty root prompt", () => {
    expect(normalizeRootPrompt([], {})).toBeNull();
    expect(normalizeRootPrompt(["   "], {})).toBeNull();
  });

  it("parses tool params using key=value format", () => {
    const cwd = "/tmp/sacode";
    expect(parseToolParams([
      "path=package.json",
      "limit=3",
      "enabled=true",
      "name=hello=world",
      "payload={\"a\":1}",
    ], cwd)).toEqual({
      path: path.resolve(cwd, "package.json"),
      limit: 3,
      enabled: true,
      name: "hello=world",
      payload: { a: 1 },
    });
  });

  it("keeps absolute path and ignores malformed empty keys", () => {
    expect(parseToolParams(["path=/tmp/file.txt", "=ignored", "text=hello"], "/workspace")).toEqual({
      path: "/tmp/file.txt",
      text: "hello",
    });
  });
});
