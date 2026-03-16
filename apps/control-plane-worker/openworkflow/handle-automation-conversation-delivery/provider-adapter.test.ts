import { describe, expect, it } from "vitest";

import { getConversationProviderAdapter } from "./provider-adapter.js";

describe("conversation provider adapter registry", () => {
  it("returns the definitions-owned adapter for integration family openai", () => {
    const adapter = getConversationProviderAdapter("openai");
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.inspectAutomationConversation).toBe("function");
    expect(typeof adapter.createAutomationConversation).toBe("function");
    expect(typeof adapter.resumeAutomationConversation).toBe("function");
    expect(typeof adapter.startExecution).toBe("function");
    expect(typeof adapter.steerExecution).toBe("function");
  });

  it("throws for unsupported integration families", () => {
    expect(() => getConversationProviderAdapter("unsupported")).toThrow(
      "Unsupported conversation integration family 'unsupported'.",
    );
  });
});
