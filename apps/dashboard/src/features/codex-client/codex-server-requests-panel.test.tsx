// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodexServerRequestsPanel } from "./codex-server-requests-panel.js";

describe("CodexServerRequestsPanel", () => {
  it("renders command approvals in the standalone panel when passed through", () => {
    const submittedResults: unknown[] = [];

    render(
      <CodexServerRequestsPanel
        entries={[
          {
            requestId: 11,
            method: "item/commandExecution/requestApproval",
            kind: "command-approval",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "cmd_1",
            reason: "Needs approval",
            command: "rm -rf /tmp/build",
            cwd: "/home/sandbox",
            availableDecisions: ["accept", "decline"],
            networkHost: null,
            networkProtocol: null,
            networkPort: null,
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    expect(submittedResults).toEqual([
      {
        decision: "accept",
      },
    ]);
  });

  it("collects tool/requestUserInput answers before submitting", () => {
    const submittedResults: unknown[] = [];

    render(
      <CodexServerRequestsPanel
        entries={[
          {
            requestId: 17,
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Choice",
                id: "q1",
                question: "Which option?",
                options: [
                  {
                    label: "A",
                    description: "First option",
                    isOther: false,
                  },
                  {
                    label: "Other",
                    description: null,
                    isOther: true,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Other"), {
      target: {
        value: "Custom answer",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit responses" }));

    expect(submittedResults).toEqual([
      {
        answers: [
          {
            id: "q1",
            value: "Custom answer",
          },
        ],
      },
    ]);
  });
});
