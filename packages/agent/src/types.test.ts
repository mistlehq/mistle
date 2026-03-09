import { describe, expect, it } from "vitest";

import { AgentThreadStatuses, AgentTransportKinds, isAgentWebSocketTransport } from "./index.js";

describe("agent transport helpers", () => {
  it("identifies websocket transports", () => {
    const transport = {
      kind: AgentTransportKinds.WEBSOCKET,
      url: "ws://127.0.0.1:4500",
    };

    expect(isAgentWebSocketTransport(transport)).toBe(true);
  });
});

describe("agent thread statuses", () => {
  it("exposes stable thread status constants", () => {
    expect(AgentThreadStatuses).toEqual({
      ACTIVE: "active",
      ERROR: "error",
      IDLE: "idle",
    });
  });
});
