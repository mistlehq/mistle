import { describe, expect, it } from "vitest";

import { resolveComposerSubmitAction } from "./session-composer-capabilities.js";

describe("resolveComposerSubmitAction", () => {
  it("starts a turn with trimmed text when no turn is active", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "  hello world  ",
        hasActiveTurn: false,
        hasPendingInput: false,
        userInputRequestCustomResponseTarget: null,
      }),
    ).toEqual({
      type: "start_turn",
      submitMode: "start",
      prompt: "hello world",
    });
  });

  it("interrupts an active turn when the composer is empty", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "   ",
        hasActiveTurn: true,
        hasPendingInput: false,
        userInputRequestCustomResponseTarget: null,
      }),
    ).toEqual({
      type: "interrupt_turn",
      submitMode: "interrupt",
    });
  });

  it("steers an active turn when the composer has text", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "  refine this  ",
        hasActiveTurn: true,
        hasPendingInput: false,
        userInputRequestCustomResponseTarget: null,
      }),
    ).toEqual({
      type: "steer_turn",
      submitMode: "steer",
      prompt: "refine this",
    });
  });

  it("responds to a pending user input request with trimmed custom text", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "  use Slack instead  ",
        hasActiveTurn: true,
        hasPendingInput: false,
        userInputRequestCustomResponseTarget: {
          requestId: "request-1",
        },
      }),
    ).toEqual({
      type: "respond_to_user_input_request",
      requestId: "request-1",
      submitMode: "custom-response",
      prompt: "use Slack instead",
    });
  });

  it("starts a turn when only pending input is present", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "   ",
        hasActiveTurn: false,
        hasPendingInput: true,
        userInputRequestCustomResponseTarget: null,
      }),
    ).toEqual({
      type: "start_turn",
      submitMode: "start",
      prompt: "",
    });
  });

  it("steers an active turn when only pending input is present", () => {
    expect(
      resolveComposerSubmitAction({
        composerText: "   ",
        hasActiveTurn: true,
        hasPendingInput: true,
        userInputRequestCustomResponseTarget: null,
      }),
    ).toEqual({
      type: "steer_turn",
      submitMode: "steer",
      prompt: "",
    });
  });
});
