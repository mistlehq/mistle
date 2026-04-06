import { describe, expect, it } from "vitest";

import { resolveComposerStatusMessage } from "./session-composer-status.js";

describe("session-composer-status", () => {
  it("shows an unavailable-model error when bootstrap succeeded but the selected model is missing", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: null,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingAttachments: false,
        isUploadingAttachments: false,
        sessionErrorMessage: null,
        selectedModel: "removed-model",
      }),
    ).toEqual({
      message: "Model removed-model is no longer available. Switch to another model to continue.",
      variant: "alert",
    });
  });

  it("clears the bootstrap model error once a valid model is selected", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: {
          id: "model_123",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          hidden: false,
          defaultReasoningEffort: null,
          inputModalities: ["text", "image"],
          supportsPersonality: false,
          isDefault: true,
        },
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingAttachments: false,
        isUploadingAttachments: false,
        sessionErrorMessage: null,
        selectedModel: "gpt-5.4",
      }),
    ).toBeNull();
  });

  it("shows a completed turn error as an alert notice", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: null,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: "The session disconnected before the turn could be submitted.",
        hasPendingAttachments: false,
        isUploadingAttachments: false,
        sessionErrorMessage: null,
        selectedModel: "gpt-5.4",
      }),
    ).toEqual({
      message: "The session disconnected before the turn could be submitted.",
      variant: "alert",
    });
  });

  it("shows attachment uploads as a loading notice", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: {
          id: "model_123",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          hidden: false,
          defaultReasoningEffort: null,
          inputModalities: ["text", "image"],
          supportsPersonality: false,
          isDefault: true,
        },
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingAttachments: true,
        isUploadingAttachments: true,
        sessionErrorMessage: null,
        selectedModel: "gpt-5.4",
      }),
    ).toEqual({
      message: "Uploading attachments...",
      variant: "default",
      presentation: "loading",
    });
  });
});
