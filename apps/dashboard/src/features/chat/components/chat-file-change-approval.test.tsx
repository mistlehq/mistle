// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatFileChangeApproval } from "./chat-file-change-approval.js";

describe("ChatFileChangeApproval", () => {
  it("renders the approval context and submits the selected decision", () => {
    const submittedResults: unknown[] = [];

    render(
      <ChatFileChangeApproval
        approvalRequest={{
          requestId: 88,
          method: "item/fileChange/requestApproval",
          kind: "file-change-approval",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "file-change-1",
          reason: "Approve the file update.",
          grantRoot: "/home/sandbox",
          availableDecisions: ["accept", "decline"],
          status: "pending",
          responseErrorMessage: null,
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.getByText("Approve file changes")).toBeTruthy();
    expect(screen.getByText("Approve the file update.")).toBeTruthy();
    expect(screen.getByText("grant root: /home/sandbox")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    expect(submittedResults).toEqual([{ decision: "accept" }]);
  });
});
