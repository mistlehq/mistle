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
        model: "gpt-5.3-codex",
        modelReasoningEffort: "high",
        collaborationModeSettings: {
          developerInstructions: "Always include the automation marker.",
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      model: "gpt-5.3-codex",
      effort: "high",
      input: [
        {
          type: "text",
          text: "Handle the webhook payload.",
        },
      ],
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
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
        model: "gpt-5.3-codex",
      }),
    ).toEqual({
      threadId: "thread_123",
      model: "gpt-5.3-codex",
      input: [
        {
          type: "text",
          text: "Handle the webhook payload.",
        },
      ],
    });
  });

  it("uses null collaboration mode reasoning effort when no model reasoning effort is provided", () => {
    expect(
      resolveCodexTurnStartParams({
        providerConversationId: "thread_123",
        inputText: "Handle the webhook payload.",
        model: "gpt-5.3-codex",
        collaborationModeSettings: {
          developerInstructions: null,
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      model: "gpt-5.3-codex",
      input: [
        {
          type: "text",
          text: "Handle the webhook payload.",
        },
      ],
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    });
  });
});
