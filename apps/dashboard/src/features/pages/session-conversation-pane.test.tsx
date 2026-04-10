// @vitest-environment jsdom

import type { CodexTurnInputLocalImageItem } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import type { SessionBootstrapResult } from "../session-agents/codex/session-state/session-bootstrap/index.js";
import type { SessionComposerStateInput } from "./session-composer/index.js";
import {
  SessionConversationBottomPanel,
  SessionConversationBottomPanelController,
} from "./session-conversation-pane.js";

const ReadyBootstrapFixture: SessionBootstrapResult = {
  phase: { status: "ready" },
  establishedSnapshot: {
    availableModels: [
      {
        id: "model_123",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        hidden: false,
        defaultReasoningEffort: null,
        inputModalities: ["text", "image"],
        supportsPersonality: false,
        isDefault: true,
      },
    ],
    configSnapshot: {
      model: "gpt-5.4",
      modelReasoningEffort: "medium",
    },
  },
};

function createPaneControllerInput(input?: {
  prepareAttachments?: SessionComposerStateInput["attachmentControl"]["prepareAttachments"];
  startTurn?: SessionComposerStateInput["turnControl"]["startTurn"];
}): SessionComposerStateInput {
  return {
    bootstrap: ReadyBootstrapFixture,
    clearSessionErrorMessage: () => {},
    configControl: {
      selectedModel: "gpt-5.4",
      selectedReasoningEffort: "medium",
      modelOptions: [{ value: "gpt-5.4", label: "GPT-5.4" }],
      canChangeModel: true,
      canChangeReasoningEffort: true,
      isUpdating: false,
      setModel: () => {},
      setReasoningEffort: () => {},
    },
    attachmentControl: {
      canUploadAttachments: true,
      isUploadingAttachments: false,
      prepareAttachments:
        input?.prepareAttachments ??
        (async ({
          prompt,
        }): Promise<{
          prompt: string;
          submittedAttachments: readonly CodexTurnInputLocalImageItem[];
          displayAttachments: readonly CodexTurnInputLocalImageItem[];
        }> => ({
          prompt,
          submittedAttachments: [],
          displayAttachments: [],
        })),
    },
    sessionErrorMessage: null,
    turnControl: {
      activeTurnState: "idle",
      canSteer: false,
      canInterrupt: false,
      isStarting: false,
      isSteering: false,
      isInterrupting: false,
      completedTurnErrorMessage: null,
      startTurn: input?.startTurn ?? (async () => {}),
      steerTurn: async () => {},
      interruptTurn: () => {},
    },
  };
}

function createImageFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "screenshot.png", { type: "image/png" });
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected composer file input to be rendered.");
  }

  return input;
}

describe("SessionConversationBottomPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the session status message above the composer", () => {
    render(
      <SessionConversationBottomPanel
        chatEntries={[]}
        composerViewModel={{
          ...SessionComposerFixtureProps,
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={[]}
        statusMessage={{
          message:
            "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
          variant: "default",
        }}
      />,
    );

    expect(
      screen.getByText(
        "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("shows upload failures through the rendered pane and keeps pending attachments visible", async () => {
    const rendered = render(
      <SessionConversationBottomPanelController
        chatEntries={[]}
        composerStateInput={createPaneControllerInput({
          prepareAttachments: async () => {
            throw new Error("That image file could not be validated.");
          },
        })}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={[]}
      />,
    );

    fireEvent.change(getFileInput(rendered.container), {
      target: {
        files: [createImageFile()],
      },
    });
    expect(await screen.findByText("screenshot.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "That image file could not be validated.",
    );
    expect(screen.getByText("screenshot.png")).toBeTruthy();
  });

  it("clears the rendered error and attachment chips after a successful retry", async () => {
    let attemptCount = 0;

    const rendered = render(
      <SessionConversationBottomPanelController
        chatEntries={[]}
        composerStateInput={createPaneControllerInput({
          prepareAttachments: async ({ prompt }) => {
            attemptCount += 1;
            if (attemptCount === 1) {
              throw new Error("That image file could not be validated.");
            }

            return {
              prompt,
              submittedAttachments: [
                {
                  type: "localImage",
                  path: "/tmp/attachments/thread_123/screenshot.png",
                },
              ],
              displayAttachments: [
                {
                  type: "localImage",
                  path: "/tmp/attachments/thread_123/screenshot.png",
                },
              ],
            };
          },
        })}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={[]}
      />,
    );

    fireEvent.change(getFileInput(rendered.container), {
      target: {
        files: [createImageFile()],
      },
    });
    expect(await screen.findByText("screenshot.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "That image file could not be validated.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.queryByText("That image file could not be validated.")).toBeNull();
      expect(screen.queryByText("screenshot.png")).toBeNull();
    });
  });
});
