import { describe, expect, it } from "vitest";

import { resolveComposerSubmitAction } from "./session-composer-capabilities.js";

describe("resolveComposerSubmitAction", () => {
  it("starts a turn with trimmed text when no turn is active", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "  hello world  ",
        hasActiveTurn: false,
        hasPendingInput: false,
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
        hasPendingInput: false,
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
        hasPendingInput: false,
      }),
    ).toEqual({
      type: "steer_turn",
      submitMode: "steer",
      prompt: "refine this",
      shouldClearComposer: true,
    });
  });

  it("starts a turn when only pending input is present", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "   ",
        hasActiveTurn: false,
        hasPendingInput: true,
      }),
    ).toEqual({
      type: "start_turn",
      submitMode: "start",
      prompt: "",
      shouldClearComposer: true,
    });
  });

  it("steers an active turn when only pending input is present", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "   ",
        hasActiveTurn: true,
        hasPendingInput: true,
      }),
    ).toEqual({
      type: "steer_turn",
      submitMode: "steer",
      prompt: "",
      shouldClearComposer: true,
    });
  });
});
