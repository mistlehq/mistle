import { describe, expect, it } from "vitest";

import { createSessionConfigDialogViewModel } from "./session-config-dialog-view-model.js";

describe("createSessionConfigDialogViewModel", () => {
  it("marks thread details as unavailable when no thread is selected", () => {
    expect(
      createSessionConfigDialogViewModel({
        sandboxInstanceId: "sbi_test",
        agentConnectionState: "ready",
        connectedSession: {
          sandboxInstanceId: "sbi_test",
          connectedAtIso: "2026-03-07T12:00:00.000Z",
          expiresAtIso: "2026-03-07T12:30:00.000Z",
          connectionUrl: "wss://example.test/codex",
          threadId: null,
        },
      }).sessionMetadata,
    ).toContainEqual({
      label: "Thread state",
      value: "Unavailable",
    });
  });

  it("keeps selected thread details when session metadata is complete", () => {
    expect(
      createSessionConfigDialogViewModel({
        sandboxInstanceId: "sbi_test",
        agentConnectionState: "ready",
        connectedSession: {
          sandboxInstanceId: "sbi_test",
          connectedAtIso: "2026-03-07T12:00:00.000Z",
          expiresAtIso: "2026-03-07T12:30:00.000Z",
          connectionUrl: "wss://example.test/codex",
          threadId: "thread_test",
        },
      }).sessionMetadata,
    ).toContainEqual({
      label: "Thread id",
      value: "thread_test",
      monospace: true,
    });
  });
});
