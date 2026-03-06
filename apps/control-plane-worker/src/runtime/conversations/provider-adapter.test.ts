import { ConversationProviderFamilies } from "@mistle/db/control-plane";
import { describe, expect, it } from "vitest";

import { getConversationProviderAdapter } from "./provider-adapter.js";

describe("conversation provider adapter registry", () => {
  it("returns the codex adapter for provider_family=codex", () => {
    const adapter = getConversationProviderAdapter(ConversationProviderFamilies.CODEX);

    expect(adapter.providerFamily).toBe(ConversationProviderFamilies.CODEX);
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.inspectConversation).toBe("function");
    expect(typeof adapter.createConversation).toBe("function");
    expect(typeof adapter.resumeConversation).toBe("function");
    expect(typeof adapter.startExecution).toBe("function");
    expect(typeof adapter.steerExecution).toBe("function");
  });
});
