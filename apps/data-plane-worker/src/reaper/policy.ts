export const WebhookSandboxStopReasons = {
  DISCONNECTED: "disconnected",
  IDLE: "idle",
} as const;

export type WebhookSandboxStopReason =
  (typeof WebhookSandboxStopReasons)[keyof typeof WebhookSandboxStopReasons];

export type WebhookSandboxIdlePolicy = {
  webhookIdleTimeoutMs: number;
  executionLeaseFreshnessMs: number;
  tunnelDisconnectGraceMs: number;
};

export type WebhookSandboxStopCandidateState = {
  startedAt: string;
  latestExecutionLeaseSeenAt: string | null;
  tunnelDisconnectedAt: string | null;
};

function parseTimestampToMs(input: {
  value: string;
  fieldName: string;
  sandboxInstanceId: string;
}): number {
  const timestampMs = Date.parse(input.value);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(
      `Expected ${input.fieldName} for sandbox '${input.sandboxInstanceId}' to be a valid ISO-8601 timestamp.`,
    );
  }

  return timestampMs;
}

function requirePositiveDuration(input: { fieldName: string; value: number }): void {
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new Error(`Expected ${input.fieldName} to be a positive number of milliseconds.`);
  }
}

export function evaluateWebhookSandboxStopReason(input: {
  nowMs: number;
  policy: WebhookSandboxIdlePolicy;
  sandboxInstanceId: string;
  state: WebhookSandboxStopCandidateState;
}): WebhookSandboxStopReason | null {
  requirePositiveDuration({
    fieldName: "webhookIdleTimeoutMs",
    value: input.policy.webhookIdleTimeoutMs,
  });
  requirePositiveDuration({
    fieldName: "executionLeaseFreshnessMs",
    value: input.policy.executionLeaseFreshnessMs,
  });
  requirePositiveDuration({
    fieldName: "tunnelDisconnectGraceMs",
    value: input.policy.tunnelDisconnectGraceMs,
  });

  const startedAtMs = parseTimestampToMs({
    value: input.state.startedAt,
    fieldName: "startedAt",
    sandboxInstanceId: input.sandboxInstanceId,
  });

  if (input.state.tunnelDisconnectedAt !== null) {
    const disconnectedAtMs = parseTimestampToMs({
      value: input.state.tunnelDisconnectedAt,
      fieldName: "tunnelDisconnectedAt",
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (input.nowMs - disconnectedAtMs >= input.policy.tunnelDisconnectGraceMs) {
      return WebhookSandboxStopReasons.DISCONNECTED;
    }
  }

  const latestActivityAtMs =
    input.state.latestExecutionLeaseSeenAt === null
      ? startedAtMs
      : parseTimestampToMs({
          value: input.state.latestExecutionLeaseSeenAt,
          fieldName: "latestExecutionLeaseSeenAt",
          sandboxInstanceId: input.sandboxInstanceId,
        });

  if (
    input.state.latestExecutionLeaseSeenAt !== null &&
    input.nowMs - latestActivityAtMs < input.policy.executionLeaseFreshnessMs
  ) {
    return null;
  }

  if (input.nowMs - latestActivityAtMs >= input.policy.webhookIdleTimeoutMs) {
    return WebhookSandboxStopReasons.IDLE;
  }

  return null;
}
