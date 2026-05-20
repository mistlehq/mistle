import type {
  CodexJsonRpcNotification,
  CodexThreadGoal,
  CodexThreadGoalStatus,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";

const MaxGoalObjectiveChars = 4_000;

export type CodexGoalCommand =
  | { kind: "show" }
  | { kind: "clear" }
  | { kind: "edit" }
  | { kind: "setObjective"; objective: string }
  | { kind: "setStatus"; status: Extract<CodexThreadGoalStatus, "active" | "paused"> };

export type CodexGoalCommandParseResult =
  | { status: "notGoalCommand" }
  | { status: "invalid"; message: string }
  | { status: "valid"; command: CodexGoalCommand };

export type CodexGoalPanel =
  | {
      kind: "replaceConfirmation";
      threadId: string;
      objective: string;
    }
  | {
      kind: "edit";
      goal: CodexThreadGoal;
    };

export type CodexGoalStatusViewModel = {
  label: string;
  title: string;
};

export function parseCodexGoalCommand(input: string): CodexGoalCommandParseResult {
  const trimmedInput = input.trim();
  if (!trimmedInput.startsWith("/goal")) {
    return { status: "notGoalCommand" };
  }

  const goalPrefixLength = "/goal".length;
  if (trimmedInput.length > goalPrefixLength && !/\s/.test(trimmedInput.charAt(goalPrefixLength))) {
    return { status: "notGoalCommand" };
  }

  const rest = trimmedInput.slice(goalPrefixLength).trim();
  if (rest.length === 0) {
    return {
      status: "valid",
      command: { kind: "show" },
    };
  }

  switch (rest.toLowerCase()) {
    case "clear":
      return {
        status: "valid",
        command: { kind: "clear" },
      };
    case "edit":
      return {
        status: "valid",
        command: { kind: "edit" },
      };
    case "pause":
      return {
        status: "valid",
        command: {
          kind: "setStatus",
          status: "paused",
        },
      };
    case "resume":
      return {
        status: "valid",
        command: {
          kind: "setStatus",
          status: "active",
        },
      };
    default:
      break;
  }

  const objectiveLength = Array.from(rest).length;
  if (objectiveLength > MaxGoalObjectiveChars) {
    return {
      status: "invalid",
      message: `Goal objective is too long: ${formatInteger(objectiveLength)} characters. Limit: ${formatInteger(MaxGoalObjectiveChars)} characters. Put longer instructions in a file and refer to that file in the goal, for example: /goal follow the instructions in docs/goal.md.`,
    };
  }

  return {
    status: "valid",
    command: {
      kind: "setObjective",
      objective: rest,
    },
  };
}

export function parseThreadGoalUpdatedNotification(
  notification: CodexJsonRpcNotification,
): CodexThreadGoal | null {
  if (notification.method !== "thread/goal/updated" || !isRecord(notification.params)) {
    return null;
  }

  const goal = notification.params.goal;
  return isThreadGoal(goal) ? goal : null;
}

export function parseThreadGoalClearedNotification(
  notification: CodexJsonRpcNotification,
): string | null {
  if (notification.method !== "thread/goal/cleared" || !isRecord(notification.params)) {
    return null;
  }

  const threadId = notification.params.threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}

export function formatCodexGoalStatus(goal: CodexThreadGoal): CodexGoalStatusViewModel {
  return {
    label: formatGoalStatusLabel(goal),
    title: formatGoalTitle(goal),
  };
}

export function editedGoalStatus(status: CodexThreadGoalStatus): CodexThreadGoalStatus {
  switch (status) {
    case "active":
    case "paused":
    case "blocked":
    case "usageLimited":
      return status;
    case "budgetLimited":
    case "complete":
      return "active";
  }
}

function formatGoalStatusLabel(goal: CodexThreadGoal): string {
  switch (goal.status) {
    case "active": {
      const usage = formatActiveGoalUsage(goal);
      return `Pursuing goal (${usage})`;
    }
    case "paused":
      return "Goal paused (/goal resume)";
    case "blocked":
      return "Goal blocked (/goal resume)";
    case "usageLimited":
      return "Goal hit usage limits (/goal resume)";
    case "budgetLimited": {
      const usage = formatStoppedGoalBudgetUsage(goal);
      return usage === null ? "Goal abandoned" : `Goal unmet (${usage})`;
    }
    case "complete":
      return `Goal achieved (${formatCompletedGoalUsage(goal)})`;
  }
}

function formatActiveGoalUsage(goal: CodexThreadGoal): string {
  if (goal.tokenBudget !== null) {
    return `${formatCompactTokens(goal.tokensUsed)} / ${formatCompactTokens(goal.tokenBudget)}`;
  }

  return formatElapsedSeconds(goal.timeUsedSeconds);
}

function formatStoppedGoalBudgetUsage(goal: CodexThreadGoal): string | null {
  if (goal.tokenBudget === null) {
    return null;
  }

  return `${formatCompactTokens(goal.tokensUsed)} / ${formatCompactTokens(goal.tokenBudget)} tokens`;
}

function formatCompletedGoalUsage(goal: CodexThreadGoal): string {
  if (goal.tokenBudget !== null) {
    return `${formatCompactTokens(goal.tokensUsed)} tokens`;
  }

  return formatElapsedSeconds(goal.timeUsedSeconds);
}

function formatGoalTitle(goal: CodexThreadGoal): string {
  const parts = [`Objective: ${goal.objective}`];
  if (goal.timeUsedSeconds > 0) {
    parts.push(`Time: ${formatElapsedSeconds(goal.timeUsedSeconds)}.`);
  }
  if (goal.tokenBudget !== null) {
    parts.push(
      `Tokens: ${formatCompactTokens(goal.tokensUsed)}/${formatCompactTokens(goal.tokenBudget)}.`,
    );
  }
  return parts.join(" ");
}

function formatElapsedSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${String(days)}d ${String(remainingHours)}h ${String(remainingMinutes)}m`;
  }

  if (remainingMinutes === 0) {
    return `${String(hours)}h`;
  }

  return `${String(hours)}h ${String(remainingMinutes)}m`;
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${formatCompactDecimal(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${formatCompactDecimal(value / 1_000)}K`;
  }

  return String(value);
}

function formatCompactDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function isThreadGoal(value: unknown): value is CodexThreadGoal {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.threadId === "string" &&
    typeof value.objective === "string" &&
    isThreadGoalStatus(value.status) &&
    (typeof value.tokenBudget === "number" || value.tokenBudget === null) &&
    typeof value.tokensUsed === "number" &&
    typeof value.timeUsedSeconds === "number" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function isThreadGoalStatus(value: unknown): value is CodexThreadGoalStatus {
  return (
    value === "active" ||
    value === "paused" ||
    value === "blocked" ||
    value === "usageLimited" ||
    value === "budgetLimited" ||
    value === "complete"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
