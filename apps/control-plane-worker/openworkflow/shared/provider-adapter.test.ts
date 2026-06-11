import { describe, expect, it } from "vitest";

import { getConversationProviderAdapter } from "./provider-adapter.js";

describe("conversation provider adapter registry", () => {
  it("throws for unsupported runtimes", () => {
    expect(() => getConversationProviderAdapter("unsupported")).toThrow(
      "Agent runtime 'unsupported' was not found.",
    );
  });

  it("exposes Codex associated-resource delivery submission through the provider adapter", () => {
    expect(getConversationProviderAdapter("codex").submitAssociatedResourceDelivery).toBeTypeOf(
      "function",
    );
  });
});
