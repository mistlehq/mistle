import { describe, expect, it } from "vitest";

import type { DesignerRuntimeConversationTranscript } from "../designer/designer-service.js";
import { shouldPollDesignerRuntimeTranscript } from "./designer-session-page.js";

function createTranscript(
  turns: DesignerRuntimeConversationTranscript["turns"],
): DesignerRuntimeConversationTranscript {
  return {
    providerConversationId: "thread_designer_test",
    name: null,
    preview: null,
    turns,
    actionProposals: [],
  };
}

describe("shouldPollDesignerRuntimeTranscript", () => {
  it("polls before the first provider transcript load", () => {
    expect(shouldPollDesignerRuntimeTranscript(null)).toBe(true);
  });

  it("continues polling until the first provider turn appears", () => {
    expect(shouldPollDesignerRuntimeTranscript(createTranscript([]))).toBe(true);
  });

  it("continues polling while any provider turn is non-terminal", () => {
    expect(
      shouldPollDesignerRuntimeTranscript(
        createTranscript([
          {
            id: "turn_running",
            status: "inProgress",
            items: [],
          },
        ]),
      ),
    ).toBe(true);
  });

  it("continues polling until the last submitted follow-up turn appears", () => {
    expect(
      shouldPollDesignerRuntimeTranscript(
        createTranscript([
          {
            id: "turn_previous",
            status: "completed",
            items: [],
          },
        ]),
        "turn_follow_up",
      ),
    ).toBe(true);
  });

  it("stops polling when the expected follow-up turn is terminal", () => {
    expect(
      shouldPollDesignerRuntimeTranscript(
        createTranscript([
          {
            id: "turn_follow_up",
            status: "completed",
            items: [],
          },
        ]),
        "turn_follow_up",
      ),
    ).toBe(false);
  });

  it("stops polling once all provider turns are terminal", () => {
    expect(
      shouldPollDesignerRuntimeTranscript(
        createTranscript([
          {
            id: "turn_completed",
            status: "completed",
            items: [],
          },
          {
            id: "turn_failed",
            status: "failed",
            items: [],
          },
        ]),
      ),
    ).toBe(false);
  });
});
