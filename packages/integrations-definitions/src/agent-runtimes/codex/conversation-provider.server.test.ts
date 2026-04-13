import { describe, expect, it } from "vitest";

import { normalizeCodexThreadStatus } from "./conversation-provider.server.js";

describe("normalizeCodexThreadStatus", () => {
  it("keeps active threads active", () => {
    expect(normalizeCodexThreadStatus({ type: "active", activeFlags: [] })).toBe("active");
  });

  it("treats idle terminal thread statuses as idle", () => {
    expect(normalizeCodexThreadStatus({ type: "idle" })).toBe("idle");
    expect(normalizeCodexThreadStatus({ type: "notLoaded" })).toBe("idle");
  });

  it("treats systemError threads as startable for a new turn", () => {
    expect(normalizeCodexThreadStatus({ type: "systemError" })).toBe("idle");
  });

  it("rejects unsupported thread status payloads", () => {
    expect(() => normalizeCodexThreadStatus({ type: "unknown" })).toThrow(
      "Codex inspect returned unsupported thread status type 'unknown'.",
    );
  });
});
