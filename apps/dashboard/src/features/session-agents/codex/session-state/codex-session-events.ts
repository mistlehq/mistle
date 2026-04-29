import { z } from "zod";

import type {
  CodexThreadLifecycleEvent,
  CodexThreadNameUpdate,
  CodexThreadTokenUsageSnapshot,
  CodexTurnDiffSnapshot,
  CodexTurnPlanSnapshot,
} from "./codex-session-types.js";

const TokenUsageBreakdownSchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
});

const ThreadTokenUsageNotificationParamsSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  tokenUsage: z.object({
    total: TokenUsageBreakdownSchema,
    last: TokenUsageBreakdownSchema,
    modelContextWindow: z.number().nullable(),
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveNotificationParams(notification: {
  params?: unknown;
}): Record<string, unknown> | null {
  return isRecord(notification.params) ? notification.params : null;
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
    if (!isRecord(entry)) {
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

  const params = ThreadTokenUsageNotificationParamsSchema.safeParse(notification.params);
  if (!params.success) {
    return null;
  }

  return {
    threadId: params.data.threadId,
    turnId: params.data.turnId,
    tokenUsage: params.data.tokenUsage,
  };
}

export function parseThreadNameUpdate(notification: {
  method: string;
  params?: unknown;
}): CodexThreadNameUpdate | null {
  if (notification.method !== "thread/name/updated") {
    return null;
  }

  const params = resolveNotificationParams(notification);
  if (params === null) {
    return null;
  }

  const threadId = resolveStringProperty(params, "threadId");
  const title = resolveStringProperty(params, "name");
  if (threadId === null || title === null) {
    return null;
  }

  return {
    threadId,
    title,
  };
}
