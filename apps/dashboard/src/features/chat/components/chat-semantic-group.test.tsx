// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CodexStoryExploringGroupEntry,
  CodexStoryMakingEditsGroupEntry,
  CodexStorySearchingWebGroupEntry,
  CodexStoryThinkingGroupEntry,
} from "../../codex-client/codex-story-fixtures.js";
import type { ChatSemanticGroupEntry } from "../chat-types.js";
import { ChatSemanticGroup } from "./chat-semantic-group.js";

afterEach(cleanup);

describe("ChatSemanticGroup", () => {
  it("renders exploring groups as compact semantic steps with collapsible results", () => {
    const { container } = render(<ChatSemanticGroup block={CodexStoryExploringGroupEntry} />);

    expect(screen.getByText("Explored")).toBeTruthy();
    expect(screen.getByText("2 reads, 1 search, 1 list")).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("semantic")).toBeTruthy();
    expect(screen.getAllByText("Toggle results")).toHaveLength(4);
    expect(screen.getByText("Toggle group")).toBeTruthy();
    expect(container.textContent?.includes("cwd:")).toBe(false);
  });

  it("renders non-exploring groups with semantic titles and no disclosure for empty output", () => {
    render(<ChatSemanticGroup block={CodexStoryThinkingGroupEntry} />);

    expect(screen.getByText("Thoughts")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
    expect(screen.getAllByText("Thought")).toHaveLength(2);
    expect(screen.getByText(/Comparing current grouped transcript output/)).toBeTruthy();
    expect(screen.queryByText("Toggle results")).toBeNull();
  });

  it("toggles output below the row when a disclosure is opened", () => {
    const { container } = render(<ChatSemanticGroup block={CodexStoryExploringGroupEntry} />);
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
    const { container } = render(<ChatSemanticGroup block={CodexStoryThinkingGroupEntry} />);
    const groupDisclosure = container.querySelector("details");
    if (groupDisclosure === null) {
      throw new Error("Expected a semantic group disclosure");
    }
    expect(groupDisclosure.hasAttribute("open")).toBe(true);

    const groupSummary = screen.getByText("Toggle group").closest("summary");
    if (groupSummary === null) {
      throw new Error("Expected a semantic group summary");
    }
    fireEvent.click(groupSummary);

    expect(groupDisclosure.hasAttribute("open")).toBe(false);
  });

  it("renders making-edits output with the diff viewer", () => {
    const { container } = render(<ChatSemanticGroup block={CodexStoryMakingEditsGroupEntry} />);

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
          label: "Read",
          detail: "apps/dashboard/src/features/chat/components/chat-thread.tsx",
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

    const { container } = render(<ChatSemanticGroup block={readCodeBlock} />);

    expect(screen.getByText("Read")).toBeTruthy();
    expect(
      screen.getByText("apps/dashboard/src/features/chat/components/chat-thread.tsx"),
    ).toBeTruthy();
    expect(container.querySelector("code")).toBeTruthy();
  });

  it("renders searching-web output as a result list instead of raw json", () => {
    render(<ChatSemanticGroup block={CodexStorySearchingWebGroupEntry} />);

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

    expect(screen.getByText("packages/web/src/components/Share.tsx")).toBeTruthy();
    expect(
      screen.getByText(
        "https://github.com/anomalyco/opencode/blob/dev/packages/web/src/components/Share.tsx",
      ),
    ).toBeTruthy();
  });
});
