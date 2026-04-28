// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatGenericItem } from "./chat-generic-item.js";

describe("ChatGenericItem", () => {
  it("renders expandable generic items collapsed by default", () => {
    render(
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
          status: "streaming",
        }}
      />,
    );

    const disclosure = screen.getByText("Context compaction").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Running")).toBeTruthy();

    fireEvent.click(screen.getByText("Context compaction"));

    expect(disclosure?.hasAttribute("open")).toBe(true);
    expect(
      screen.getByText("Compacted the current session context before continuing."),
    ).toBeTruthy();
    expect(screen.getByText(/drop-superseded-read-output/)).toBeTruthy();
  });

  it("keeps generic items without details open", () => {
    render(
      <ChatGenericItem
        block={{
          id: "generic_2",
          turnId: "turn_2",
          kind: "generic-item",
          itemType: "enteredReviewMode",
          title: "Entered review mode",
          body: null,
          detailsJson: null,
          status: "completed",
        }}
      />,
    );

    const disclosure = screen.getByText("Entered review mode").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Completed")).toBeTruthy();
  });
});
