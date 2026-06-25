import type { ClaudeCodePermissionRequest } from "@mistle/integrations-definitions/agent-runtimes/claude-code/client";

import type { ServerRequestEntry, ToolRequestUserInputEntry } from "../../server-requests/index.js";

export type ClaudeCodePermissionServerRequestResponse = {
  answers?: readonly {
    id: string;
    value: string;
  }[];
  decision?: "once" | "reject";
  message?: string;
};

const CancelledClaudeCodeInputRequestMessage = "User cancelled this Claude Code input request.";

function stringifyClaudeCodeToolInput(toolInput: unknown): string {
  if (toolInput === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(toolInput, null, 2);
  } catch {
    if (
      typeof toolInput === "string" ||
      typeof toolInput === "number" ||
      typeof toolInput === "boolean" ||
      typeof toolInput === "bigint" ||
      typeof toolInput === "symbol"
    ) {
      return toolInput.toString();
    }
    return "Unserializable tool input";
  }
}

export function mapClaudeCodePermissionsToServerRequests(
  pendingPermissions: readonly ClaudeCodePermissionRequest[],
): readonly ServerRequestEntry[] {
  return pendingPermissions.map((permission) => {
    const userInputEntry = mapClaudeCodeAskUserQuestionToServerRequest(permission);
    if (userInputEntry !== null) {
      return userInputEntry;
    }
    return {
      requestId: permission.id,
      method: "claude-code/permission/requestApproval",
      kind: "claude-code-permission",
      sessionId: permission.sessionId,
      toolName: permission.toolName,
      toolInputJson: stringifyClaudeCodeToolInput(permission.toolInput),
      availableDecisions: ["once", "reject"],
      status: "pending",
      responseErrorMessage: null,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapClaudeCodeAskUserQuestionToServerRequest(
  permission: ClaudeCodePermissionRequest,
): ToolRequestUserInputEntry | null {
  if (permission.toolName !== "AskUserQuestion" || !isRecord(permission.toolInput)) {
    return null;
  }
  const questions = permission.toolInput["questions"];
  if (!Array.isArray(questions)) {
    return null;
  }
  return {
    requestId: permission.id,
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: questions.map((question, index) => {
      if (!isRecord(question)) {
        return {
          id: String(index),
          header: null,
          question: "Claude Code requested input.",
          options: [],
        };
      }
      const rawOptions = question["options"];
      const options = Array.isArray(rawOptions)
        ? rawOptions.flatMap((option) => {
            if (!isRecord(option)) {
              return [];
            }
            const label = readString(option["label"]);
            if (label === null) {
              return [];
            }
            return [
              {
                label,
                isOther: false,
              },
            ];
          })
        : [];
      return {
        id: String(index),
        header: readString(question["header"]),
        question: readString(question["question"]) ?? "Claude Code requested input.",
        options: [
          ...options,
          {
            label: "Other",
            isOther: true,
          },
        ],
      };
    }),
    status: "pending",
    responseErrorMessage: null,
  };
}

export function resolveClaudeCodePermissionResponse(
  result: unknown,
): ClaudeCodePermissionServerRequestResponse {
  if (
    typeof result === "object" &&
    result !== null &&
    "answers" in result &&
    Array.isArray(result.answers)
  ) {
    return {
      answers: result.answers.map((answer) => {
        if (
          typeof answer !== "object" ||
          answer === null ||
          !("id" in answer) ||
          typeof answer.id !== "string" ||
          !("value" in answer) ||
          typeof answer.value !== "string"
        ) {
          throw new Error("Claude Code user input response included an invalid answer.");
        }
        return {
          id: answer.id,
          value: answer.value,
        };
      }),
    };
  }

  if (typeof result !== "object" || result === null || !("decision" in result)) {
    throw new Error("Claude Code permission response is missing a decision.");
  }

  const decision = result.decision;
  if (decision === "cancel") {
    return {
      decision: "reject",
      message: CancelledClaudeCodeInputRequestMessage,
    };
  }
  if (decision === "once" || decision === "reject") {
    return { decision };
  }

  throw new Error("Claude Code permission response has an unsupported decision.");
}
