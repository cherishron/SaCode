import { describe, it, expect, beforeEach } from "vitest";

// Mock message data
interface SearchableMessage {
  id: string;
  sessionId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

// Simple in-memory search implementation
class MockSearchEngine {
  private messages: SearchableMessage[] = [];

  index(messages: SearchableMessage[]): void {
    this.messages = messages;
  }

  search(query: string, options?: {
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    highlight?: boolean;
  }): {
    results: Array<{
      message: SearchableMessage;
      score: number;
      highlight?: { content: string };
    }>;
    total: number;
  } {
    let results = this.messages.filter((msg) => {
      // Filter by user
      if (options?.userId && msg.userId !== options.userId) {
        return false;
      }

      // Filter by date range
      if (options?.startDate && msg.createdAt < options.startDate) {
        return false;
      }
      if (options?.endDate && msg.createdAt > options.endDate) {
        return false;
      }

      // Simple text matching (case-insensitive)
      return msg.content.toLowerCase().includes(query.toLowerCase());
    });

    // Calculate relevance score
    const scoredResults = results.map((msg) => {
      const lowerContent = msg.content.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const occurrences = (lowerContent.match(new RegExp(lowerQuery, "g")) || []).length;
      const score = occurrences * 10;

      return {
        message: msg,
        score,
        highlight: options?.highlight
          ? {
              content: msg.content.replace(
                new RegExp(query, "gi"),
                "<mark>$&</mark>"
              ),
            }
          : undefined,
      };
    });

    // Sort by score descending
    scoredResults.sort((a, b) => b.score - a.score);

    return {
      results: scoredResults,
      total: scoredResults.length,
    };
  }

  getSuggestions(prefix: string, limit: number = 5): Array<{
    text: string;
    count: number;
  }> {
    const words = new Map<string, number>();

    this.messages.forEach((msg) => {
      const tokens = msg.content.toLowerCase().split(/\s+/);
      tokens.forEach((token) => {
        if (token.startsWith(prefix.toLowerCase())) {
          words.set(token, (words.get(token) || 0) + 1);
        }
      });
    });

    return Array.from(words.entries())
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getFacets(messages: SearchableMessage[]): {
    byRole: Record<string, number>;
    byDate: Record<string, number>;
  } {
    const byRole: Record<string, number> = {};
    const byDate: Record<string, number> = {};

    messages.forEach((msg) => {
      byRole[msg.role] = (byRole[msg.role] || 0) + 1;
      const dateKey = msg.createdAt.toISOString().split("T")[0]!;
      byDate[dateKey] = (byDate[dateKey] || 0) + 1;
    });

    return { byRole, byDate };
  }
}

describe("Search API", () => {
  let searchEngine: MockSearchEngine;
  const testUserId = "user_test123";
  const otherUserId = "user_other456";

  // Sample messages
  const sampleMessages: SearchableMessage[] = [
    {
      id: "msg_1",
      sessionId: "sess_1",
      userId: testUserId,
      role: "user",
      content: "How do I use TypeScript generics effectively?",
      createdAt: new Date("2026-03-20T10:00:00Z"),
    },
    {
      id: "msg_2",
      sessionId: "sess_1",
      userId: testUserId,
      role: "assistant",
      content: "TypeScript generics allow you to write flexible, reusable code. Here's how to use them effectively...",
      createdAt: new Date("2026-03-20T10:01:00Z"),
    },
    {
      id: "msg_3",
      sessionId: "sess_2",
      userId: testUserId,
      role: "user",
      content: "What are the best practices for REST API design?",
      createdAt: new Date("2026-03-19T14:00:00Z"),
    },
    {
      id: "msg_4",
      sessionId: "sess_2",
      userId: testUserId,
      role: "assistant",
      content: "Here are some REST API best practices: use proper HTTP methods, version your API...",
      createdAt: new Date("2026-03-19T14:01:00Z"),
    },
    {
      id: "msg_5",
      sessionId: "sess_3",
      userId: otherUserId,
      role: "user",
      content: "TypeScript is a great language for large projects.",
      createdAt: new Date("2026-03-18T09:00:00Z"),
    },
  ];

  beforeEach(() => {
    searchEngine = new MockSearchEngine();
    searchEngine.index(sampleMessages);
  });

  describe("Basic Search", () => {
    it("should find messages by keyword", () => {
      const result = searchEngine.search("TypeScript", { userId: testUserId });

      expect(result.total).toBe(2);
      expect(result.results[0]?.message.content).toContain("TypeScript");
    });

    it("should be case-insensitive", () => {
      const result1 = searchEngine.search("typescript", { userId: testUserId });
      const result2 = searchEngine.search("TYPESCRIPT", { userId: testUserId });

      expect(result1.total).toBe(result2.total);
      expect(result1.total).toBe(2);
    });

    it("should return empty results for no matches", () => {
      const result = searchEngine.search("nonexistentkeyword", {
        userId: testUserId,
      });

      expect(result.total).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it("should filter by user ID", () => {
      const result = searchEngine.search("TypeScript"); // No user filter

      expect(result.total).toBe(3); // Includes other user's message

      const userResult = searchEngine.search("TypeScript", {
        userId: testUserId,
      });
      expect(userResult.total).toBe(2); // Only user's messages
    });
  });

  describe("Time Range Filter", () => {
    it("should filter by start date", () => {
      const result = searchEngine.search("TypeScript", {
        userId: testUserId,
        startDate: new Date("2026-03-20T00:00:00Z"),
      });

      expect(result.total).toBe(2); // Only messages from March 20
    });

    it("should filter by end date", () => {
      const result = searchEngine.search("API", {
        userId: testUserId,
        endDate: new Date("2026-03-19T23:59:59Z"),
      });

      expect(result.total).toBe(2); // Only messages up to March 19
    });

    it("should filter by date range", () => {
      const result = searchEngine.search("TypeScript", {
        userId: testUserId,
        startDate: new Date("2026-03-19T00:00:00Z"),
        endDate: new Date("2026-03-19T23:59:59Z"),
      });

      expect(result.total).toBe(0); // No TypeScript messages on March 19 for test user
    });
  });

  describe("Highlight", () => {
    it("should highlight matched keywords", () => {
      const result = searchEngine.search("TypeScript", {
        userId: testUserId,
        highlight: true,
      });

      expect(result.results[0]?.highlight?.content).toContain("<mark>TypeScript</mark>");
    });

    it("should not highlight when disabled", () => {
      const result = searchEngine.search("TypeScript", {
        userId: testUserId,
        highlight: false,
      });

      expect(result.results[0]?.highlight).toBeUndefined();
    });
  });

  describe("Facets", () => {
    it("should generate facets by role", () => {
      const result = searchEngine.search("TypeScript", { userId: testUserId });
      const facets = searchEngine.getFacets(
        result.results.map((r) => r.message)
      );

      expect(facets.byRole.user).toBe(1);
      expect(facets.byRole.assistant).toBe(1);
    });

    it("should generate facets by date", () => {
      const result = searchEngine.search("TypeScript", { userId: testUserId });
      const facets = searchEngine.getFacets(
        result.results.map((r) => r.message)
      );

      expect(facets.byDate["2026-03-20"]).toBe(2);
    });
  });

  describe("Relevance Scoring", () => {
    it("should rank by occurrence count", () => {
      // Add a message with more occurrences
      const messagesWithMoreOccurrences: SearchableMessage[] = [
        ...sampleMessages,
        {
          id: "msg_6",
          sessionId: "sess_4",
          userId: testUserId,
          role: "assistant",
          content: "TypeScript TypeScript TypeScript - multiple TypeScript mentions",
          createdAt: new Date("2026-03-21T10:00:00Z"),
        },
      ];
      searchEngine.index(messagesWithMoreOccurrences);

      const result = searchEngine.search("TypeScript", { userId: testUserId });

      // Message with most occurrences should be first
      expect(result.results[0]?.message.id).toBe("msg_6");
      expect(result.results[0]?.score).toBeGreaterThan(
        result.results[1]?.score || 0
      );
    });
  });

  describe("Suggestions", () => {
    it("should return word suggestions", () => {
      const suggestions = searchEngine.getSuggestions("Type", 5);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.text === "typescript")).toBe(true);
    });

    it("should limit suggestions count", () => {
      const suggestions = searchEngine.getSuggestions("t", 2);
      expect(suggestions.length).toBeLessThanOrEqual(2);
    });

    it("should sort by frequency", () => {
      const suggestions = searchEngine.getSuggestions("Type", 5);

      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i - 1]!.count).toBeGreaterThanOrEqual(
          suggestions[i]!.count
        );
      }
    });

    it("should return empty for no matches", () => {
      const suggestions = searchEngine.getSuggestions("zzzzz", 5);
      expect(suggestions).toHaveLength(0);
    });
  });

  describe("Search Syntax", () => {
    it("should handle exact phrase search", () => {
      // Simplified: exact phrase would require more complex matching
      const result = searchEngine.search("REST API", { userId: testUserId });

      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0]?.message.content).toContain("REST API");
    });

    it("should handle special characters", () => {
      // Add message with special characters
      const specialMessages: SearchableMessage[] = [
        ...sampleMessages,
        {
          id: "msg_special",
          sessionId: "sess_special",
          userId: testUserId,
          role: "user",
          content: "Check out https://example.com and email@test.com",
          createdAt: new Date(),
        },
      ];
      searchEngine.index(specialMessages);

      const result = searchEngine.search("https://example.com", {
        userId: testUserId,
      });

      expect(result.total).toBe(1);
    });
  });

  describe("Performance", () => {
    it("should handle large result sets", () => {
      // Generate many messages
      const manyMessages: SearchableMessage[] = [];
      for (let i = 0; i < 1000; i++) {
        manyMessages.push({
          id: `msg_large_${i}`,
          sessionId: `sess_${i % 10}`,
          userId: testUserId,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i} with TypeScript content`,
          createdAt: new Date(),
        });
      }
      searchEngine.index(manyMessages);

      const start = Date.now();
      const result = searchEngine.search("TypeScript", { userId: testUserId });
      const duration = Date.now() - start;

      expect(result.total).toBe(1000);
      expect(duration).toBeLessThan(100); // Should be fast
    });
  });
});
