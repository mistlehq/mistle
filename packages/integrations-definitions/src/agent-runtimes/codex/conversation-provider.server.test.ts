import { describe, expect, it } from "vitest";

import {
  normalizeCodexThreadStatus,
  resolveCodexTurnStartParams,
} from "./conversation-provider.server.js";

describe("normalizeCodexThreadStatus", () => {
  it("keeps active threads active", () => {
    expect(normalizeCodexThreadStatus({ type: "active", activeFlags: [] })).toBe("active");
  });

  it("treats idle terminal thread statuses as idle", () => {
    expect(normalizeCodexThreadStatus({ type: "idle" })).toBe("idle");
  });

  it("keeps not-loaded threads distinct from idle loaded threads", () => {
    expect(normalizeCodexThreadStatus({ type: "notLoaded" })).toBe("not_loaded");
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

describe("resolveCodexTurnStartParams", () => {
  it("includes collaboration mode settings when provided", () => {
    expect(
      resolveCodexTurnStartParams({
        providerConversationId: "thread_123",
        inputText: "Handle the webhook payload.",
        collaborationModeSettings: {
          model: "gpt-5.2",
          reasoningEffort: "medium",
          developerInstructions: "Always include the automation marker.",
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      input: [
        {
          type: "text",
          text: "Handle the webhook payload.",
        },
      ],
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.2",
          reasoning_effort: "medium",
          developer_instructions: "Always include the automation marker.",
        },
      },
    });
  });

  it("omits collaboration mode settings when none are provided", () => {
    expect(
      resolveCodexTurnStartParams({
        providerConversationId: "thread_123",
        inputText: "Handle the webhook payload.",
      }),
    ).toEqual({
      threadId: "thread_123",
      input: [
        {
          type: "text",
          text: "Handle the webhook payload.",
        },
      ],
    });
  });
});
