import { describe, expect, it } from "vitest";

import { resolveThreadTitlePatchInput } from "./thread-title-updates.js";

describe("resolveThreadTitlePatchInput", () => {
  it("returns a patch input when the renamed thread matches the provider thread", () => {
    expect(
      resolveThreadTitlePatchInput({
        sessionSnapshot: {
          sandboxInstanceId: "sbi_123",
          connectedAtIso: "2026-04-07T00:00:00.000Z",
          providerThreadId: "thread_123",
          activeThreadId: "thread_123",
        },
        threadNameUpdate: {
          threadId: "thread_123",
          title: "Renamed by Codex",
        },
      }),
    ).toEqual({
      sandboxInstanceId: "sbi_123",
      title: "Renamed by Codex",
    });
  });

  it("ignores updates for non-provider threads", () => {
    expect(
      resolveThreadTitlePatchInput({
        sessionSnapshot: {
          sandboxInstanceId: "sbi_123",
          connectedAtIso: "2026-04-07T00:00:00.000Z",
          providerThreadId: "thread_123",
          activeThreadId: "thread_456",
        },
        threadNameUpdate: {
          threadId: "thread_456",
          title: "Local thread rename",
        },
      }),
    ).toBeNull();
  });

  it("ignores updates when there is no linked provider thread", () => {
    expect(
      resolveThreadTitlePatchInput({
        sessionSnapshot: {
          sandboxInstanceId: "sbi_123",
          connectedAtIso: "2026-04-07T00:00:00.000Z",
          providerThreadId: null,
          activeThreadId: "thread_123",
        },
        threadNameUpdate: {
          threadId: "thread_123",
          title: "Should be ignored",
        },
      }),
    ).toBeNull();
  });
});
