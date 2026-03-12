// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatPlanEntry } from "./chat-plan-entry.js";

describe("ChatPlanEntry", () => {
  it("renders structured plan updates as a checklist with explanation", () => {
    const { container } = render(
      <ChatPlanEntry
        block={{
          id: "plan-1",
          turnId: "turn-1",
          kind: "plan",
          text: null,
          explanation: "Refining rollout sequence",
          steps: [
            {
              step: "Audit coverage",
              status: "completed",
            },
            {
              step: "Add parity tests",
              status: "inProgress",
            },
            {
              step: "Polish Storybook",
              status: "pending",
            },
          ],
          status: "streaming",
        }}
      />,
    );

    expect(screen.getByText("Updated Plan")).toBeTruthy();
    expect(screen.getByText("Refining rollout sequence")).toBeTruthy();
    expect(screen.getByText("Audit coverage")).toBeTruthy();
    expect(screen.getByText("Add parity tests")).toBeTruthy();
    expect(screen.getByText("Polish Storybook")).toBeTruthy();
    expect(container.querySelectorAll("svg")).toHaveLength(3);
  });
});
