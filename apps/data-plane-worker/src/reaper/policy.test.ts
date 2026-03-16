import { describe, expect, it } from "vitest";

import {
  evaluateWebhookSandboxStopReason,
  WebhookSandboxStopReasons,
  type WebhookSandboxIdlePolicy,
} from "./policy.js";

const DefaultPolicy: WebhookSandboxIdlePolicy = {
  webhookIdleTimeoutMs: 300_000,
  executionLeaseFreshnessMs: 30_000,
  tunnelDisconnectGraceMs: 60_000,
};

describe("evaluateWebhookSandboxStopReason", () => {
  it("stops sandboxes that have never reported an execution lease after the idle timeout", () => {
    expect(
      evaluateWebhookSandboxStopReason({
        nowMs: Date.parse("2026-03-16T00:10:00.000Z"),
        policy: DefaultPolicy,
        sandboxInstanceId: "sbi_idle",
        state: {
          startedAt: "2026-03-16T00:00:00.000Z",
          latestExecutionLeaseSeenAt: null,
          tunnelDisconnectedAt: null,
        },
      }),
    ).toBe(WebhookSandboxStopReasons.IDLE);
  });

  it("keeps sandboxes alive while the newest execution lease is still fresh", () => {
    expect(
      evaluateWebhookSandboxStopReason({
        nowMs: Date.parse("2026-03-16T00:10:00.000Z"),
        policy: DefaultPolicy,
        sandboxInstanceId: "sbi_busy",
        state: {
          startedAt: "2026-03-16T00:00:00.000Z",
          latestExecutionLeaseSeenAt: "2026-03-16T00:09:45.000Z",
          tunnelDisconnectedAt: null,
        },
      }),
    ).toBeNull();
  });

  it("waits for the idle timeout after the last execution lease renewal before stopping", () => {
    expect(
      evaluateWebhookSandboxStopReason({
        nowMs: Date.parse("2026-03-16T00:10:00.000Z"),
        policy: DefaultPolicy,
        sandboxInstanceId: "sbi_recently_idle",
        state: {
          startedAt: "2026-03-16T00:00:00.000Z",
          latestExecutionLeaseSeenAt: "2026-03-16T00:08:00.000Z",
          tunnelDisconnectedAt: null,
        },
      }),
    ).toBeNull();
  });

  it("stops sandboxes whose tunnel has been disconnected beyond the grace window", () => {
    expect(
      evaluateWebhookSandboxStopReason({
        nowMs: Date.parse("2026-03-16T00:10:00.000Z"),
        policy: DefaultPolicy,
        sandboxInstanceId: "sbi_disconnected",
        state: {
          startedAt: "2026-03-16T00:00:00.000Z",
          latestExecutionLeaseSeenAt: "2026-03-16T00:09:45.000Z",
          tunnelDisconnectedAt: "2026-03-16T00:08:30.000Z",
        },
      }),
    ).toBe(WebhookSandboxStopReasons.DISCONNECTED);
  });
});
