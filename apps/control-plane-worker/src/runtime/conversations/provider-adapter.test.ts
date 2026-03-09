import { describe, expect, it } from "vitest";

import { getConversationProviderAdapter } from "./provider-adapter.js";

describe("conversation provider adapter registry", () => {
  it("returns the codex adapter for integration family openai", () => {
    const adapter = getConversationProviderAdapter("openai");
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.inspectConversation).toBe("function");
    expect(typeof adapter.createConversation).toBe("function");
    expect(typeof adapter.resumeConversation).toBe("function");
    expect(typeof adapter.startExecution).toBe("function");
    expect(typeof adapter.steerExecution).toBe("function");
  });
});
