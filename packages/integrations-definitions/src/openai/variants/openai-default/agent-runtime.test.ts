import { describe, expect, it } from "vitest";

import {
  OpenAiDefaultAgentRuntimes,
  createCodexConversationProviderAdapter,
} from "./agent-runtime.js";

describe("openai-default agent runtime", () => {
  it("declares the codex app-server runtime registration", () => {
    expect(OpenAiDefaultAgentRuntimes).toEqual([
      {
        familyId: "openai",
        variantId: "openai-default",
        runtimeKey: "codex-app-server",
        capabilities: {
          conversation: {
            providerFamily: "codex",
            createAdapter: expect.any(Function),
          },
        },
      },
    ]);
  });

  it("creates a codex conversation adapter from the registration", () => {
    const runtime = OpenAiDefaultAgentRuntimes[0];
    expect(runtime).toBeDefined();
    if (runtime === undefined) {
      throw new Error("Expected the openai-default agent runtime to be registered.");
    }
    const adapter = runtime.capabilities.conversation?.createAdapter();

    expect(adapter?.providerFamily).toBe("codex");
    expect(adapter).toBeDefined();
    expect(typeof adapter?.connect).toBe("function");
    expect(typeof adapter?.inspectConversation).toBe("function");
    expect(typeof adapter?.createConversation).toBe("function");
    expect(typeof adapter?.resumeConversation).toBe("function");
    expect(typeof adapter?.startExecution).toBe("function");
    expect(typeof adapter?.steerExecution).toBe("function");

    const directAdapter = createCodexConversationProviderAdapter();
    expect(directAdapter.providerFamily).toBe("codex");
  });
});
