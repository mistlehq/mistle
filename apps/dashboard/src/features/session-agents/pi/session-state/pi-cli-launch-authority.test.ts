import { describe, expect, it } from "vitest";

import {
  isPiSessionActivelyWorking,
  resolvePiCliLaunchTarget,
  resolveStablePiCliLaunchTarget,
} from "./pi-cli-launch-authority.js";

describe("isPiSessionActivelyWorking", () => {
  it("reports a Pi session as actively working while streaming", () => {
    expect(
      isPiSessionActivelyWorking({
        isCompacting: false,
        isStreaming: true,
        pendingMessageCount: 0,
      }),
    ).toBe(true);
  });

  it("reports a Pi session as actively working while compacting", () => {
    expect(
      isPiSessionActivelyWorking({
        isCompacting: true,
        isStreaming: false,
        pendingMessageCount: 0,
      }),
    ).toBe(true);
  });

  it("reports a Pi session as actively working while follow-up messages are pending", () => {
    expect(
      isPiSessionActivelyWorking({
        isCompacting: false,
        isStreaming: false,
        pendingMessageCount: 1,
      }),
    ).toBe(true);
  });

  it("reports a Pi session as idle when no runtime work is active", () => {
    expect(
      isPiSessionActivelyWorking({
        isCompacting: false,
        isStreaming: false,
        pendingMessageCount: 0,
      }),
    ).toBe(false);
  });
});

describe("resolvePiCliLaunchTarget", () => {
  it("resumes a materialized Pi conversation by session file", () => {
    expect(
      resolvePiCliLaunchTarget({
        activeSessionFile: "/root/.pi/agent/sessions/current.jsonl",
        hasActiveWork: false,
        messageCount: 1,
      }),
    ).toEqual({
      type: "resume",
      threadId: "/root/.pi/agent/sessions/current.jsonl",
    });
  });

  it("starts a new CLI session and clears active authority for an empty Pi conversation", () => {
    expect(
      resolvePiCliLaunchTarget({
        activeSessionFile: "/root/.pi/agent/sessions/empty.jsonl",
        hasActiveWork: false,
        messageCount: 0,
      }),
    ).toEqual({
      type: "start_new",
      shouldClearActiveThreadId: true,
    });
  });

  it("starts a new CLI session without clearing authority when no Pi conversation is active", () => {
    expect(
      resolvePiCliLaunchTarget({
        activeSessionFile: null,
        hasActiveWork: false,
        messageCount: null,
      }),
    ).toEqual({
      type: "start_new",
      shouldClearActiveThreadId: false,
    });
  });

  it("resumes a Pi conversation with active work before messages are persisted", () => {
    expect(
      resolvePiCliLaunchTarget({
        activeSessionFile: "/root/.pi/agent/sessions/streaming.jsonl",
        hasActiveWork: true,
        messageCount: 0,
      }),
    ).toEqual({
      type: "resume",
      threadId: "/root/.pi/agent/sessions/streaming.jsonl",
    });
  });
});

describe("resolveStablePiCliLaunchTarget", () => {
  it("keeps a launch target when the active Pi session file is unchanged", () => {
    expect(
      resolveStablePiCliLaunchTarget({
        activeSessionFile: "/root/.pi/agent/sessions/current.jsonl",
        currentActiveSessionFile: "/root/.pi/agent/sessions/current.jsonl",
        hasActiveWork: false,
        messageCount: 1,
      }),
    ).toEqual({
      type: "resume",
      threadId: "/root/.pi/agent/sessions/current.jsonl",
    });
  });

  it("drops the launch target when another Pi conversation becomes active during preparation", () => {
    expect(
      resolveStablePiCliLaunchTarget({
        activeSessionFile: "/root/.pi/agent/sessions/previous.jsonl",
        currentActiveSessionFile: "/root/.pi/agent/sessions/current.jsonl",
        hasActiveWork: false,
        messageCount: 1,
      }),
    ).toBeNull();
  });
});
