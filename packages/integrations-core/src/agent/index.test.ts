import { describe, expect, it } from "vitest";

import { AgentConversationStatuses } from "./index.js";

describe("agent contracts", () => {
  it("exports normalized conversation statuses", () => {
    expect(AgentConversationStatuses).toEqual({
      IDLE: "idle",
      NOT_LOADED: "not_loaded",
      ACTIVE: "active",
      ERROR: "error",
    });
  });
});
