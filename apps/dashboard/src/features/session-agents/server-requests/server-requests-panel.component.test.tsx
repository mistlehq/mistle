// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ServerRequestsPanel } from "./server-requests-panel.js";

describe("ServerRequestsPanel", () => {
  it("renders command approvals in the standalone panel when passed through", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
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
            cwd: "/root",
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
      <ServerRequestsPanel
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

  it("renders OpenCode permission requests in the standalone panel", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "permission-1",
            method: "opencode/permission/requestApproval",
            kind: "opencode-permission",
            sessionId: "session-1",
            permission: "bash",
            patterns: ["pnpm test"],
            availableDecisions: ["once", "always", "reject"],
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

    expect(screen.getByText("OpenCode permission").textContent).toBe("OpenCode permission");
    expect(screen.getByText("bash: pnpm test").textContent).toBe("bash: pnpm test");

    fireEvent.click(screen.getByRole("button", { name: "once" }));

    expect(submittedResults).toEqual([
      {
        decision: "once",
      },
    ]);
  });
});
