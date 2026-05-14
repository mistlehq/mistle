import { describe, expect, it } from "vitest";

import type { SessionComposerModel } from "./session-composer-runtime-contracts.js";
import { resolveComposerStatusMessage } from "./session-composer-status.js";

const ImageCapableModel: SessionComposerModel = {
  model: "gpt-5.4",
  displayName: "GPT-5.4",
  defaultReasoningEffort: null,
  inputModalities: ["text", "image"],
  isDefault: true,
};

const TextOnlyModel: SessionComposerModel = {
  model: "codex-spark",
  displayName: "Codex Spark",
  defaultReasoningEffort: null,
  inputModalities: ["text"],
  isDefault: false,
};

describe("session-composer-status", () => {
  it("shows an unavailable-model error when bootstrap succeeded but the selected model is missing", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: null,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingImageAttachments: false,
        isUploadingAttachments: false,
        requiresModelSelection: true,
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
        activeComposerModel: ImageCapableModel,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingImageAttachments: false,
        isUploadingAttachments: false,
        requiresModelSelection: true,
        sessionErrorMessage: null,
        selectedModel: "gpt-5.4",
      }),
    ).toBeNull();
  });

  it("does not require a composer model when the active runtime owns model selection elsewhere", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: null,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingImageAttachments: false,
        isUploadingAttachments: false,
        requiresModelSelection: false,
        sessionErrorMessage: null,
        selectedModel: null,
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
        hasPendingImageAttachments: false,
        isUploadingAttachments: false,
        requiresModelSelection: true,
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
        activeComposerModel: ImageCapableModel,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingImageAttachments: true,
        isUploadingAttachments: true,
        requiresModelSelection: true,
        sessionErrorMessage: null,
        selectedModel: "gpt-5.4",
      }),
    ).toEqual({
      message: "Uploading attachments...",
      variant: "default",
      presentation: "loading",
    });
  });

  it("does not show an image warning when no image attachments are pending on text-only models", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: TextOnlyModel,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingImageAttachments: false,
        isUploadingAttachments: false,
        requiresModelSelection: true,
        sessionErrorMessage: null,
        selectedModel: "codex-spark",
      }),
    ).toBeNull();
  });

  it("shows an image warning for pending image attachments on text-only models", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: TextOnlyModel,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingImageAttachments: true,
        isUploadingAttachments: false,
        requiresModelSelection: true,
        sessionErrorMessage: null,
        selectedModel: "codex-spark",
      }),
    ).toEqual({
      message:
        "Model Codex Spark cannot inspect images. Images will only be sent as file path references.",
      variant: "default",
    });
  });

  it("does not show an image warning for image attachments on image-capable models", () => {
    expect(
      resolveComposerStatusMessage({
        activeComposerModel: ImageCapableModel,
        bootstrapState: { status: "ready" },
        composerErrorMessage: null,
        completedTurnErrorMessage: null,
        hasPendingImageAttachments: true,
        isUploadingAttachments: false,
        requiresModelSelection: true,
        sessionErrorMessage: null,
        selectedModel: "gpt-5.4",
      }),
    ).toBeNull();
  });
});
