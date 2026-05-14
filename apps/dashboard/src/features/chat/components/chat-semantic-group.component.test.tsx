// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResolvedAppearanceProvider } from "../../appearance/appearance-provider.js";
import {
  CodexFixtureExploringGroupEntry,
  CodexFixtureMakingEditsGroupEntry,
  CodexFixtureRunningCommandsGroupEntry,
  CodexFixtureSearchingWebGroupEntry,
  CodexFixtureThinkingGroupEntry,
} from "../../session-agents/codex/fixtures/chat-fixtures.js";
import type { ChatSemanticGroupEntry } from "../chat-types.js";
import { ChatSemanticGroup } from "./chat-semantic-group.js";

function openSemanticGroup(): void {
  const groupSummary = screen.getByText("Toggle group").closest("summary");
  if (groupSummary === null) {
    throw new Error("Expected a semantic group summary");
  }

  fireEvent.click(groupSummary);
}

function getSemanticGroupSummaryElement(container: HTMLElement): HTMLElement {
  const groupSummary = container.querySelector("[data-chat-semantic-group-summary]");
  if (groupSummary === null) {
    throw new Error("Expected a semantic group summary.");
  }

  return groupSummary as HTMLElement;
}

describe("ChatSemanticGroup", () => {
  it("renders exploring groups as compact semantic steps with collapsible results", () => {
    const { container } = render(
      <ChatSemanticGroup
        block={CodexFixtureExploringGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    expect(screen.getByText("Explored")).toBeTruthy();
    expect(screen.getByText("2 reads, 1 search, 1 list")).toBeTruthy();
    expect(screen.getByText("Toggle group")).toBeTruthy();
    const groupDisclosure = container.querySelector("details");
    expect(groupDisclosure?.hasAttribute("open")).toBe(false);
    expect(container.textContent?.includes("cwd:")).toBe(false);
  });

  it("renders non-exploring groups with semantic titles and no disclosure for empty output", () => {
    render(
      <ChatSemanticGroup
        block={CodexFixtureThinkingGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    expect(screen.getByText("Thoughts")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
    expect(screen.getAllByText("Thought")).toHaveLength(2);
    expect(screen.getByText(/Comparing current grouped timeline output/)).toBeTruthy();
    expect(screen.queryByText("Toggle results")).toBeNull();
  });

  it("toggles output below the row when a disclosure is opened", () => {
    const { container } = render(
      <ChatSemanticGroup
        block={CodexFixtureExploringGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );
    openSemanticGroup();
    const disclosureDetails = container.querySelectorAll("details").item(1);
    if (disclosureDetails === null) {
      throw new Error("Expected a semantic group item disclosure");
    }
    expect(disclosureDetails.hasAttribute("open")).toBe(false);

    const toggleResultsButtons = screen.getAllByText("Toggle results");
    const firstToggleResultsButton = toggleResultsButtons.at(0);
    if (firstToggleResultsButton === undefined) {
      throw new Error("Expected a semantic group result toggle");
    }
    const disclosureSummary = firstToggleResultsButton.closest("summary");
    if (disclosureSummary === null) {
      throw new Error("Expected a semantic group disclosure summary");
    }
    fireEvent.click(disclosureSummary);

    expect(disclosureDetails.hasAttribute("open")).toBe(true);
  });

  it("toggles the whole semantic group from the header", () => {
    const { container } = render(
      <ChatSemanticGroup
        block={CodexFixtureThinkingGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );
    const groupDisclosure = container.querySelector("details");
    if (groupDisclosure === null) {
      throw new Error("Expected a semantic group disclosure");
    }
    expect(groupDisclosure.hasAttribute("open")).toBe(false);

    const groupSummary = screen.getByText("Toggle group").closest("summary");
    if (groupSummary === null) {
      throw new Error("Expected a semantic group summary");
    }
    fireEvent.click(groupSummary);

    expect(groupDisclosure.hasAttribute("open")).toBe(true);
  });

  it("keeps streaming groups open and collapses them after completion", () => {
    const streamingBlock: ChatSemanticGroupEntry = {
      ...CodexFixtureExploringGroupEntry,
      status: "streaming",
      items: CodexFixtureExploringGroupEntry.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              status: "streaming",
            }
          : item,
      ),
    };

    const { container, rerender } = render(
      <ChatSemanticGroup
        block={streamingBlock}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    const groupDisclosure = container.querySelector("details");
    if (groupDisclosure === null) {
      throw new Error("Expected a semantic group disclosure");
    }
    expect(groupDisclosure.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Search")).toBeTruthy();

    rerender(
      <ChatSemanticGroup
        block={CodexFixtureExploringGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    expect(groupDisclosure.hasAttribute("open")).toBe(false);
  });

  it("renders making-edits output with the diff viewer", () => {
    const { container } = render(
      <ResolvedAppearanceProvider resolvedAppearance="light">
        <ChatSemanticGroup
          block={CodexFixtureMakingEditsGroupEntry}
          isRespondingToServerRequest={false}
          onRespondToServerRequest={() => {}}
          pendingServerRequests={[]}
        />
      </ResolvedAppearanceProvider>,
    );
    openSemanticGroup();

    expect(screen.getByText("Updated files")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(
      screen.getByText("apps/dashboard/src/features/chat/components/chat-thread.tsx"),
    ).toBeTruthy();
    expect(container.querySelectorAll(".rounded-md.border")).not.toHaveLength(0);
  });

  it("renders code read outputs through streamdown with fenced code formatting", () => {
    const readCodeBlock: ChatSemanticGroupEntry = {
      id: "read-code-group-1",
      turnId: "turn-read-code",
      kind: "semantic-group",
      semanticKind: "exploring",
      status: "completed",
      displayKeys: {
        active: "exploring.active",
        completed: "exploring.done",
      },
      counts: {
        reads: 1,
        searches: 0,
        lists: 0,
      },
      items: [
        {
          id: "read-code-item-1",
          sourceKind: "command-execution",
          label: "Read",
          detail: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
          sourcePath: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
          detailKind: "code",
          command: "sed -n '1,40p' apps/dashboard/src/features/chat/components/chat-thread.tsx",
          output: [
            "export function ChatThread(): React.JSX.Element {",
            "  return <div />;",
            "}",
          ].join("\n"),
          status: "streaming",
        },
      ],
    };

    const { container } = render(
      <ChatSemanticGroup
        block={readCodeBlock}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    expect(screen.getByText("Read")).toBeTruthy();
    expect(
      screen.getByText("apps/dashboard/src/features/chat/components/chat-thread.tsx"),
    ).toBeTruthy();
    expect(container.querySelector("code")).toBeTruthy();
  });

  it("renders searching-web output as a result list instead of raw json", () => {
    render(
      <ChatSemanticGroup
        block={CodexFixtureSearchingWebGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );
    openSemanticGroup();

    const toggleResultsButtons = screen.getAllByText("Toggle results");
    const firstToggleResultsButton = toggleResultsButtons.at(0);
    if (firstToggleResultsButton === undefined) {
      throw new Error("Expected a semantic group result toggle");
    }

    const disclosureSummary = firstToggleResultsButton.closest("summary");
    if (disclosureSummary === null) {
      throw new Error("Expected a semantic group disclosure summary");
    }

    fireEvent.click(disclosureSummary);

    expect(screen.getByText("mistlehq/mistle")).toBeTruthy();
    expect(screen.getByText("https://github.com/mistlehq/mistle")).toBeTruthy();
  });

  it("renders running-commands output with the subdued command log treatment", () => {
    const { container } = render(
      <ChatSemanticGroup
        block={CodexFixtureRunningCommandsGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );
    openSemanticGroup();

    const toggleResultsButtons = screen.getAllByText("Toggle results");
    const firstToggleResultsButton = toggleResultsButtons.at(0);
    if (firstToggleResultsButton === undefined) {
      throw new Error("Expected a semantic group result toggle");
    }

    const disclosureSummary = firstToggleResultsButton.closest("summary");
    if (disclosureSummary === null) {
      throw new Error("Expected a semantic group disclosure summary");
    }

    fireEvent.click(disclosureSummary);

    const commandLog = container.querySelector('[data-semantic-output="command-log"]');
    expect(commandLog).toBeTruthy();
    expect(commandLog?.textContent?.length).toBeGreaterThan(0);
  });

  it("renders generic groups with body and json details in the shared semantic UI", () => {
    const { container } = render(
      <ChatSemanticGroup
        block={{
          id: "turn_generic:generic:generic_context_compaction",
          turnId: "turn_generic",
          kind: "semantic-group",
          semanticKind: "generic",
          status: "completed",
          displayKeys: {
            active: "generic.active",
            completed: "generic.done",
          },
          counts: null,
          items: [
            {
              id: "generic_context_compaction",
              sourceKind: "generic-item",
              label: "Context compaction",
              detail: "Compacted the current session context before continuing.",
              detailKind: "plain",
              command: null,
              output: JSON.stringify(
                {
                  strategy: "drop-superseded-read-output",
                },
                null,
                2,
              ),
              status: "completed",
            },
          ],
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    const groupDisclosure = container.querySelector("[data-chat-semantic-group]");
    const groupSummary = getSemanticGroupSummaryElement(container);
    expect(groupDisclosure?.hasAttribute("open")).toBe(false);
    expect(within(groupSummary).getByText("Context compaction")).toBeTruthy();
    expect(screen.queryByText("Activity")).toBeNull();
    expect(screen.queryByText("1 item")).toBeNull();

    openSemanticGroup();

    expect(groupDisclosure?.hasAttribute("open")).toBe(true);
    expect(
      screen.getByText("Compacted the current session context before continuing.", {
        selector: "p",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/drop-superseded-read-output/)).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("keeps body-only generic groups expandable through the semantic item row", () => {
    const { container } = render(
      <ChatSemanticGroup
        block={{
          id: "turn_opencode:generic:opencode_error",
          turnId: "turn_opencode",
          kind: "semantic-group",
          semanticKind: "generic",
          status: "completed",
          displayKeys: {
            active: "generic.active",
            completed: "generic.done",
          },
          counts: null,
          items: [
            {
              id: "opencode_error",
              sourceKind: "generic-item",
              label: "OpenCode error",
              detail: "The selected model is not available for this account.",
              detailKind: "plain",
              command: null,
              output: null,
              status: "completed",
            },
          ],
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={() => {}}
        pendingServerRequests={[]}
      />,
    );

    const groupDisclosure = container.querySelector("[data-chat-semantic-group]");
    const groupSummary = getSemanticGroupSummaryElement(container);
    expect(groupDisclosure?.hasAttribute("open")).toBe(false);
    expect(within(groupSummary).getByText("OpenCode error")).toBeTruthy();

    openSemanticGroup();

    expect(screen.queryByText("Activity")).toBeNull();

    const itemSummary = screen.getByText("Toggle results").closest("summary");
    if (itemSummary === null) {
      throw new Error("Expected a semantic group item summary.");
    }
    fireEvent.click(itemSummary);

    expect(
      screen.getByText("The selected model is not available for this account.", {
        selector: "p",
      }),
    ).toBeTruthy();
  });

  it("renders grouped command approvals inline with the matching semantic item", () => {
    const submittedResults: unknown[] = [];

    render(
      <ChatSemanticGroup
        block={CodexFixtureRunningCommandsGroupEntry}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
        pendingServerRequests={[
          {
            requestId: 22,
            method: "item/commandExecution/requestApproval",
            kind: "command-approval",
            threadId: "turn-running-commands",
            turnId: "turn-running-commands",
            itemId: "running-command-1",
            reason: "Approve the lint command.",
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

    expect(screen.getByText("Approve command")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    expect(submittedResults).toEqual([{ decision: "accept" }]);
  });
});
