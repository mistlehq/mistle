// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatCommandApproval } from "./chat-command-approval.js";

describe("ChatCommandApproval", () => {
  it("renders the approval context and submits the selected decision", () => {
    const submittedResults: unknown[] = [];

    render(
      <ChatCommandApproval
        approvalRequest={{
          requestId: 77,
          method: "item/commandExecution/requestApproval",
          kind: "command-approval",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          reason: "Approve the command before continuing.",
          command: "pnpm lint",
          cwd: "/home/sandbox",
          availableDecisions: ["accept", "cancel"],
          networkHost: "api.example.com",
          networkProtocol: "https",
          networkPort: "443",
          status: "pending",
          responseErrorMessage: null,
        }}
        command="pnpm lint"
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.getByText("Approve command")).toBeTruthy();
    expect(screen.getByText("Approve the command before continuing.")).toBeTruthy();
    expect(screen.getByText("network: https://api.example.com:443")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    expect(submittedResults).toEqual([{ decision: "accept" }]);
  });
});
