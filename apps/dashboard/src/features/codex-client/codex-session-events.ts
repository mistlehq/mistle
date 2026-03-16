import type {
  CodexThreadLifecycleEvent,
  CodexThreadTokenUsageSnapshot,
  CodexTurnDiffSnapshot,
  CodexTurnPlanSnapshot,
} from "./codex-session-types.js";

type CodexNotificationParams = {
  [key: string]: unknown;
};

function isCodexNotificationParams(value: unknown): value is CodexNotificationParams {
  return typeof value === "object" && value !== null;
}

function resolveStringProperty(record: CodexNotificationParams, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveNotificationParams(notification: {
  params?: unknown;
}): CodexNotificationParams | null {
  return isCodexNotificationParams(notification.params) ? notification.params : null;
}

export function parseThreadLifecycleEvent(notification: {
  method: string;
  params?: unknown;
}): CodexThreadLifecycleEvent | null {
  if (
    notification.method !== "thread/status/changed" &&
    notification.method !== "thread/closed" &&
    notification.method !== "thread/archived" &&
    notification.method !== "thread/unarchived"
  ) {
    return null;
  }

  const params = resolveNotificationParams(notification);
  if (params === null) {
    return null;
  }

  const threadId = resolveStringProperty(params, "threadId");
  if (threadId === null) {
    return null;
  }

  const statusValue = params.status;
  return {
    method: notification.method,
    threadId,
    statusJson: statusValue === undefined ? null : JSON.stringify(statusValue),
  };
}

export function parseTurnDiffSnapshot(notification: {
  method: string;
  params?: unknown;
}): CodexTurnDiffSnapshot | null {
  if (notification.method !== "turn/diff/updated") {
    return null;
  }

  const params = resolveNotificationParams(notification);
  if (params === null) {
    return null;
  }

  const turnId = resolveStringProperty(params, "turnId");
  const diff = resolveStringProperty(params, "diff");
  if (turnId === null || diff === null) {
    return null;
  }

  return {
    threadId: resolveStringProperty(params, "threadId"),
    turnId,
    diff,
  };
}

export function parseTurnPlanSnapshot(notification: {
  method: string;
  params?: unknown;
}): CodexTurnPlanSnapshot | null {
  if (notification.method !== "turn/plan/updated") {
    return null;
  }

  const params = resolveNotificationParams(notification);
  if (params === null) {
    return null;
  }

  const turnId = resolveStringProperty(params, "turnId");
  const planValue = params.plan;
  if (turnId === null || !Array.isArray(planValue)) {
    return null;
  }

  const steps = planValue.flatMap((entry) => {
    if (!isCodexNotificationParams(entry)) {
      return [];
    }

    const step = resolveStringProperty(entry, "step");
    const status = resolveStringProperty(entry, "status");
    if (step === null || status === null) {
      return [];
    }

    return [{ step, status }];
  });

  return {
    turnId,
    explanation: resolveStringProperty(params, "explanation"),
    steps,
  };
}

export function parseThreadTokenUsageSnapshot(notification: {
  method: string;
  params?: unknown;
}): CodexThreadTokenUsageSnapshot | null {
  if (notification.method !== "thread/tokenUsage/updated") {
    return null;
  }

  const params = resolveNotificationParams(notification);
  if (params === null) {
    return null;
  }

  const threadId = resolveStringProperty(params, "threadId");
  if (threadId === null) {
    return null;
  }

  return {
    threadId,
    usageJson: JSON.stringify(params),
  };
}
