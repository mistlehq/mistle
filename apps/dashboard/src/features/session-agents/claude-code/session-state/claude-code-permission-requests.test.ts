import { describe, expect, it } from "vitest";

import {
  mapClaudeCodePermissionsToServerRequests,
  resolveClaudeCodePermissionResponse,
} from "./claude-code-permission-requests.js";

describe("Claude Code permission request presentation", () => {
  it("maps Claude Code permission requests to actionable server requests", () => {
    expect(
      mapClaudeCodePermissionsToServerRequests([
        {
          id: "perm_test",
          sessionId: "session_test",
          toolName: "Bash",
          toolInput: {
            command: "pnpm test",
          },
        },
      ]),
    ).toEqual([
      {
        requestId: "perm_test",
        method: "claude-code/permission/requestApproval",
        kind: "claude-code-permission",
        sessionId: "session_test",
        toolName: "Bash",
        toolInputJson: '{\n  "command": "pnpm test"\n}',
        availableDecisions: ["once", "reject"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("does not expose persistent approvals without the suggested permission scope", () => {
    expect(
      mapClaudeCodePermissionsToServerRequests([
        {
          id: "perm_test",
          sessionId: "session_test",
          toolName: "Write",
          toolInput: undefined,
        },
      ]),
    ).toEqual([
      {
        requestId: "perm_test",
        method: "claude-code/permission/requestApproval",
        kind: "claude-code-permission",
        sessionId: "session_test",
        toolName: "Write",
        toolInputJson: "undefined",
        availableDecisions: ["once", "reject"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("maps Claude Code AskUserQuestion tool calls to user input requests", () => {
    expect(
      mapClaudeCodePermissionsToServerRequests([
        {
          id: "perm_question",
          sessionId: "session_test",
          toolName: "AskUserQuestion",
          toolInput: {
            questions: [
              {
                header: "Choice",
                question: "Which database?",
                options: [
                  {
                    label: "Postgres",
                  },
                ],
              },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        requestId: "perm_question",
        method: "tool/requestUserInput",
        kind: "tool-user-input",
        questions: [
          {
            id: "0",
            header: "Choice",
            question: "Which database?",
            options: [
              {
                label: "Postgres",
                isOther: false,
              },
              {
                label: "Other",
                isOther: true,
              },
            ],
          },
        ],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("resolves supported Claude Code permission decisions", () => {
    expect(resolveClaudeCodePermissionResponse({ decision: "once" })).toEqual({
      decision: "once",
    });
    expect(resolveClaudeCodePermissionResponse({ decision: "reject" })).toEqual({
      decision: "reject",
    });
  });

  it("resolves Claude Code user input answers", () => {
    expect(
      resolveClaudeCodePermissionResponse({
        answers: [
          {
            id: "0",
            value: "Postgres",
          },
        ],
      }),
    ).toEqual({
      answers: [
        {
          id: "0",
          value: "Postgres",
        },
      ],
    });
  });

  it("rejects invalid Claude Code permission response payloads", () => {
    expect(() => resolveClaudeCodePermissionResponse({ decision: "always" })).toThrow(
      "Claude Code permission response has an unsupported decision.",
    );
    expect(() => resolveClaudeCodePermissionResponse({ decision: "decline" })).toThrow(
      "Claude Code permission response has an unsupported decision.",
    );
    expect(() => resolveClaudeCodePermissionResponse({})).toThrow(
      "Claude Code permission response is missing a decision.",
    );
  });
});
