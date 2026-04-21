// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatThread } from "./chat-thread.js";

describe("ChatThread", () => {
  it("renders command approvals inline with the matching command block", () => {
    const submittedResults: unknown[] = [];

    const rendered = render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "overwrite the file",
            attachments: [],
            status: "completed",
          },
          {
            id: "cmd_1",
            turnId: "turn_1",
            kind: "command-execution",
            command: "cat > /root/file.md",
            output: null,
            cwd: "/root",
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
            command: "cat > /root/file.md",
            cwd: "/root",
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

    expect(within(rendered.container).getAllByText("Approve command").length).toBeGreaterThan(0);
    const acceptButton = within(rendered.container).getByRole("button", { name: "accept" });
    fireEvent.click(acceptButton);

    expect(submittedResults).toEqual([
      {
        decision: "accept",
      },
    ]);
  }, 10_000);

  it("renders multiline commands in the same code-block treatment as command output", () => {
    render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "write the file",
            attachments: [],
            status: "completed",
          },
          {
            id: "cmd_1",
            turnId: "turn_1",
            kind: "command-execution",
            command: `/bin/sh -lc "cat > /root/two-little-pigs.md <<'EOF'\n# Two Little Pigs\nEOF"`,
            output: null,
            cwd: "/root",
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

  it("renders exploring groups as semantic investigation steps with collapsible results", () => {
    const { container } = render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "Inspect the codebase",
            attachments: [],
            status: "completed",
          },
          {
            id: "exploring_1",
            turnId: "turn_1",
            kind: "semantic-group",
            semanticKind: "exploring",
            status: "completed",
            displayKeys: {
              active: "exploring.active",
              completed: "exploring.done",
            },
            counts: {
              reads: 1,
              searches: 1,
              lists: 0,
            },
            items: [
              {
                id: "cmd_1",
                sourceKind: "command-execution",
                label: "Read",
                detail: "app.ts",
                sourcePath: "app.ts",
                detailKind: "code",
                command: "sed -n '1,120p' app.ts",
                output: "export const App = () => null;",
                status: "completed",
              },
              {
                id: "cmd_2",
                sourceKind: "command-execution",
                label: "Search",
                detail: "App",
                detailKind: "plain",
                command: "rg App src",
                output: "src/app.ts",
                status: "completed",
              },
            ],
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    expect(screen.getByText("Explored")).toBeTruthy();
    const groupDisclosure = container.querySelector("details");
    expect(groupDisclosure?.hasAttribute("open")).toBe(false);
    expect(container.textContent?.includes("cwd: /root")).toBe(false);
  });

  it("renders command approvals inline for grouped command items", () => {
    const submittedResults: unknown[] = [];

    const rendered = render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "Run a couple of checks",
            attachments: [],
            status: "completed",
          },
          {
            id: "commands_1",
            turnId: "turn_1",
            kind: "semantic-group",
            semanticKind: "running-commands",
            status: "completed",
            displayKeys: {
              active: "running-commands.active",
              completed: "running-commands.done",
            },
            counts: null,
            items: [
              {
                id: "cmd_1",
                sourceKind: "command-execution",
                label: "Command",
                detail: "pnpm --filter @mistle/dashboard lint",
                detailKind: "code",
                command: "pnpm --filter @mistle/dashboard lint",
                output: "Done",
                status: "completed",
              },
            ],
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
        pendingServerRequests={[
          {
            requestId: 44,
            method: "item/commandExecution/requestApproval",
            kind: "command-approval",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "cmd_1",
            reason: "Approve the grouped command.",
            command: "pnpm --filter @mistle/dashboard lint",
            cwd: "/root",
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

    expect(within(rendered.container).getAllByText("Approve command").length).toBeGreaterThan(0);
    const acceptButton = within(rendered.container).getByRole("button", { name: "accept" });
    fireEvent.click(acceptButton);

    expect(submittedResults).toEqual([{ decision: "accept" }]);
  });

  it("renders generic items collapsed by default and expands their content on demand", () => {
    render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "Show the fallback activity",
            attachments: [],
            status: "completed",
          },
          {
            id: "generic_1",
            turnId: "turn_1",
            kind: "generic-item",
            itemType: "contextCompaction",
            title: "Context compaction",
            body: "Compacted the current session context before continuing.",
            detailsJson: JSON.stringify(
              {
                strategy: "drop-superseded-read-output",
              },
              null,
              2,
            ),
            status: "streaming",
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    expect(screen.getByText("Context compaction")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    const genericDisclosure = screen.getByText("Context compaction").closest("details");
    expect(genericDisclosure?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Context compaction"));

    expect(genericDisclosure?.hasAttribute("open")).toBe(true);
    expect(
      screen.getByText("Compacted the current session context before continuing."),
    ).toBeTruthy();
    expect(screen.getByText(/drop-superseded-read-output/)).toBeTruthy();
  });

  it("renders user image attachments as attachment rows", () => {
    render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "Check this screenshot",
            attachments: [
              {
                kind: "image",
                path: "/root/.local/attachments/thread_1/screenshot.png",
                name: "screenshot.png",
              },
            ],
            status: "completed",
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    expect(screen.getByText("Image attached: screenshot.png")).toBeTruthy();
  });

  it("renders trailing user actions and routes their action id", () => {
    const invokedActionIds: string[] = [];

    render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "start here",
            status: "completed",
          },
          {
            id: "assistant_1",
            turnId: "turn_1",
            kind: "assistant-message",
            text: "drafting response",
            phase: null,
            status: "streaming",
          },
          {
            id: "steer_1",
            turnId: "turn_1",
            kind: "user-message",
            label: "Steer",
            labelAction: {
              ariaLabel: "Remove steer message",
              actionId: "steer_1",
            },
            text: "tighten the scope",
            status: "completed",
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        onUserMessageAction={(actionId) => {
          invokedActionIds.push(actionId);
        }}
        pendingServerRequests={[]}
      />,
    );

    expect(screen.getByText("tighten the scope")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove steer message" }));

    expect(invokedActionIds).toEqual(["steer_1"]);
  });

  it("renders assistant streaming that arrives after a steer below the accepted steer message", () => {
    const { container } = render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "start here",
            status: "completed",
          },
          {
            id: "assistant_1",
            turnId: "turn_1",
            kind: "assistant-message",
            text: "first pass",
            phase: null,
            status: "completed",
          },
          {
            id: "steer_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "tighten the scope",
            status: "completed",
          },
          {
            id: "assistant_2",
            turnId: "turn_1",
            kind: "assistant-message",
            text: "second pass after steer",
            phase: null,
            status: "streaming",
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    const textContent = container.textContent ?? "";
    expect(textContent.indexOf("first pass")).toBeLessThan(
      textContent.indexOf("tighten the scope"),
    );
    expect(textContent.indexOf("tighten the scope")).toBeLessThan(
      textContent.indexOf("second pass after steer"),
    );
  });
});
