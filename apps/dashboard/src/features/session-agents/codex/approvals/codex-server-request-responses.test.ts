import { describe, expect, it } from "vitest";

import { createCodexServerRequestResponse } from "./codex-server-request-responses.js";

describe("Codex server request responses", () => {
  it("wraps user input cancellation in a Codex client-tool response", () => {
    expect(
      createCodexServerRequestResponse({
        entries: [
          {
            requestId: 17,
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Choice",
                id: "choice",
                question: "Which option?",
                options: [],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ],
        requestId: 17,
        result: {
          decision: "cancel",
        },
      }),
    ).toEqual({
      contentItems: [
        {
          type: "inputText",
          text: JSON.stringify({
            decision: "cancel",
          }),
        },
      ],
      success: true,
    });
  });

  it("does not rewrite approval cancellation decisions", () => {
    expect(
      createCodexServerRequestResponse({
        entries: [
          {
            requestId: 17,
            method: "item/commandExecution/requestApproval",
            kind: "command-approval",
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            reason: null,
            command: "pnpm test",
            cwd: "/workspace",
            availableDecisions: ["accept", "cancel"],
            networkHost: null,
            networkProtocol: null,
            networkPort: null,
            status: "pending",
            responseErrorMessage: null,
          },
        ],
        requestId: 17,
        result: {
          decision: "cancel",
        },
      }),
    ).toEqual({
      decision: "cancel",
    });
  });
});
