import { describe, expect, it } from "vitest";

import { resolveComposerSubmitAction } from "./session-composer-capabilities.js";

describe("resolveComposerSubmitAction", () => {
  it("starts a turn with trimmed text when no turn is active", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "  hello world  ",
        hasActiveTurn: false,
        hasPendingAttachments: false,
      }),
    ).toEqual({
      type: "start_turn",
      submitMode: "start",
      prompt: "hello world",
      shouldClearComposer: true,
    });
  });

  it("interrupts an active turn when the composer is empty", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "   ",
        hasActiveTurn: true,
        hasPendingAttachments: false,
      }),
    ).toEqual({
      type: "interrupt_turn",
      submitMode: "interrupt",
      shouldClearComposer: false,
    });
  });

  it("steers an active turn when the composer has text", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "  refine this  ",
        hasActiveTurn: true,
        hasPendingAttachments: false,
      }),
    ).toEqual({
      type: "steer_turn",
      submitMode: "steer",
      prompt: "refine this",
      shouldClearComposer: true,
    });
  });
});
