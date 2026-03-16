import { describe, expect, it } from "vitest";

import { createOpenAiCodexConversationProvider } from "./agent.server.js";

describe("openai agent exports", () => {
  it("exports the codex conversation provider factory", () => {
    const provider = createOpenAiCodexConversationProvider();

    expect(typeof provider.connect).toBe("function");
    expect(typeof provider.inspectConversation).toBe("function");
    expect(typeof provider.createConversation).toBe("function");
    expect(typeof provider.resumeConversation).toBe("function");
    expect(typeof provider.startExecution).toBe("function");
    expect(typeof provider.steerExecution).toBe("function");
  });
});
