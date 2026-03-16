import { describe, expect, it } from "vitest";

import { getConversationProviderAdapter } from "./provider-adapter.js";

describe("conversation provider adapter registry", () => {
  it("throws for unsupported integration families", () => {
    expect(() => getConversationProviderAdapter("unsupported")).toThrow(
      "Unsupported conversation integration family 'unsupported'.",
    );
  });
});
