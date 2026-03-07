// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatThread } from "./chat-thread.js";

describe("ChatThread", () => {
  it("renders command approvals inline with the matching command block", () => {
    const submittedResults: unknown[] = [];

    render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "overwrite the file",
            status: "completed",
          },
          {
            id: "cmd_1",
            turnId: "turn_1",
            kind: "command-execution",
            command: "cat > /workspace/file.md",
            output: null,
            cwd: "/workspace",
            exitCode: null,
            commandStatus: "completed",
            reason: null,
            status: "completed",
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
        pendingServerRequests={[
          {
            requestId: 11,
            method: "item/commandExecution/requestApproval",
            kind: "command-approval",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "cmd_1",
            reason: "Do you want me to overwrite the file?",
            command: "cat > /workspace/file.md",
            cwd: "/workspace",
            availableDecisions: ["accept", "cancel"],
            networkHost: null,
            networkProtocol: null,
            networkPort: null,
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Approve command")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    expect(submittedResults).toEqual([
      {
        decision: "accept",
      },
    ]);
  });

  it("renders multiline commands in the same code-block treatment as command output", () => {
    render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "write the file",
            status: "completed",
          },
          {
            id: "cmd_1",
            turnId: "turn_1",
            kind: "command-execution",
            command: `/bin/sh -lc "cat > /workspace/two-little-pigs.md <<'EOF'\n# Two Little Pigs\nEOF"`,
            output: null,
            cwd: "/workspace",
            exitCode: null,
            commandStatus: "completed",
            reason: null,
            status: "completed",
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    const renderedCommand = screen.getByText(/# Two Little Pigs/);
    expect(renderedCommand.tagName).toBe("PRE");
    expect(renderedCommand.className).toContain("bg-muted");
  });
});
