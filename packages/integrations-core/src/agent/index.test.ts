import { describe, expect, it } from "vitest";

import {
  AgentConversationStatuses,
  AgentExecutionLeaseKinds,
  AgentExecutionObservationTypes,
  AgentExecutionStates,
} from "./index.js";

describe("agent contracts", () => {
  it("exports normalized conversation statuses", () => {
    expect(AgentConversationStatuses).toEqual({
      IDLE: "idle",
      ACTIVE: "active",
      ERROR: "error",
    });
  });

  it("exports normalized execution observation types and states", () => {
    expect(AgentExecutionObservationTypes).toEqual({
      NONE: "none",
      ACTIVE: "active",
    });
    expect(AgentExecutionStates).toEqual({
      ACTIVE: "active",
      TERMINAL: "terminal",
      MISSING: "missing",
    });
  });

  it("exports the generic execution lease kind", () => {
    expect(AgentExecutionLeaseKinds).toEqual({
      AGENT_EXECUTION: "agent_execution",
    });
  });
});
