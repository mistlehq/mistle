// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatGenericItem } from "./chat-generic-item.js";

describe("ChatGenericItem", () => {
  it("renders expandable generic items through the shared semantic group UI", () => {
    const { container } = render(
      <ChatGenericItem
        block={{
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
          status: "completed",
        }}
      />,
    );

    const groupDisclosure = container.querySelector("[data-chat-semantic-group]");
    expect(groupDisclosure?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Activity")).toBeTruthy();
    expect(screen.getByText("1 item")).toBeTruthy();

    const groupSummary = screen.getByText("Toggle group").closest("summary");
    if (groupSummary === null) {
      throw new Error("Expected a semantic group summary.");
    }
    fireEvent.click(groupSummary);

    expect(groupDisclosure?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Context compaction")).toBeTruthy();
    expect(
      screen.getByText("Compacted the current session context before continuing.", {
        selector: "p",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/drop-superseded-read-output/)).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("keeps body-only generic items expandable through the semantic group item row", () => {
    const { container } = render(
      <ChatGenericItem
        block={{
          id: "generic_2",
          turnId: "turn_2",
          kind: "generic-item",
          itemType: "opencode-error",
          title: "OpenCode error",
          body: "The selected model is not available for this account.",
          detailsJson: null,
          status: "completed",
        }}
      />,
    );

    const groupDisclosure = container.querySelector("[data-chat-semantic-group]");
    expect(groupDisclosure?.hasAttribute("open")).toBe(false);

    const groupSummary = screen.getByText("Toggle group").closest("summary");
    if (groupSummary === null) {
      throw new Error("Expected a semantic group summary.");
    }
    fireEvent.click(groupSummary);

    expect(screen.getByText("Activity")).toBeTruthy();
    expect(screen.getByText("OpenCode error")).toBeTruthy();

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
});
