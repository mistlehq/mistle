// @vitest-environment jsdom

import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import { useSessionComposerAttachmentControl } from "./session-composer/index.js";
import {
  SessionConversationBottomPanel,
  SessionConversationBottomPanelController,
} from "./session-conversation-pane.js";

const ComposerModelFixture: CodexModelSummary = {
  id: "model_gpt_54",
  model: "gpt-5.4",
  displayName: "GPT-5.4",
  hidden: false,
  defaultReasoningEffort: "medium",
  inputModalities: ["text", "image"],
  supportsPersonality: true,
  isDefault: true,
};

const UploadedImageFixture = {
  attachmentId: "att_123",
  threadId: "thread_123",
  originalFilename: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  path: "/tmp/attachments/thread_123/upload.png",
} as const;

function createImageFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "screenshot.png", { type: "image/png" });
}

function RenderedComposerPaneHarness(input: {
  uploadImage: (input: { file: File; threadId: string }) => Promise<typeof UploadedImageFixture>;
}): React.JSX.Element {
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const transport = useMemo(
    () =>
      new SandboxSessionTransport({
        runtime: createBrowserSandboxSessionRuntime(),
      }),
    [],
  );
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget: {
      sandboxInstanceId: "sbi_123",
      threadId: "thread_123",
    },
    ensureTransportConnected: async () => {
      return {
        sandboxInstanceId: "sbi_123",
        transport,
      };
    },
    dependencies: {
      // Exception approved by user for this task: there is no real dashboard upload harness
      // for the rendered composer pane path yet. Cleanup owner: Codex. Cleanup date: 2026-04-10.
      createUploadStreamClient: () => {
        return {
          uploadImage: input.uploadImage,
        };
      },
    },
  });

  return (
    <SessionConversationBottomPanelController
      chatEntries={[]}
      composerStateInput={{
        bootstrap: {
          phase: { status: "ready" },
          establishedSnapshot: {
            availableModels: [ComposerModelFixture],
            configSnapshot: {
              model: ComposerModelFixture.model,
              modelReasoningEffort: ComposerModelFixture.defaultReasoningEffort,
            },
          },
        },
        clearSessionErrorMessage: () => {
          setSessionErrorMessage(null);
        },
        configControl: {
          selectedModel: ComposerModelFixture.model,
          selectedReasoningEffort: ComposerModelFixture.defaultReasoningEffort,
          modelOptions: [
            {
              value: ComposerModelFixture.model,
              label: ComposerModelFixture.displayName,
            },
          ],
          canChangeModel: true,
          canChangeReasoningEffort: true,
          isUpdating: false,
          setModel: () => {
            return;
          },
          setReasoningEffort: () => {
            return;
          },
        },
        attachmentControl,
        sessionErrorMessage,
        turnControl: {
          activeTurnState: "idle",
          canSteer: false,
          canInterrupt: false,
          isStarting: false,
          isSteering: false,
          isInterrupting: false,
          completedTurnErrorMessage: null,
          startTurn: async () => {
            return;
          },
          steerTurn: async () => {
            return;
          },
          interruptTurn: () => {
            return;
          },
        },
      }}
      isRespondingToServerRequest={false}
      onRespondToServerRequest={function onRespondToServerRequest() {}}
      serverRequestPanelEntries={[]}
    />
  );
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

  it("shows upload failures in the rendered pane and keeps pending attachments visible", async () => {
    const { container } = render(
      <RenderedComposerPaneHarness
        uploadImage={async () => {
          throw new Error("That image file could not be validated.");
        }}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected composer file input to exist.");
    }

    fireEvent.change(fileInput, {
      target: {
        files: [createImageFile()],
      },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Inspect the image" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("That image file could not be validated.")).toBeTruthy();
    expect(screen.getByText("screenshot.png")).toBeTruthy();
  });

  it("clears the rendered upload error and pending attachment after a successful retry", async () => {
    let uploadAttemptCount = 0;
    const { container } = render(
      <RenderedComposerPaneHarness
        uploadImage={async () => {
          uploadAttemptCount += 1;
          if (uploadAttemptCount === 1) {
            throw new Error("That image file could not be validated.");
          }

          return UploadedImageFixture;
        }}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected composer file input to exist.");
    }

    fireEvent.change(fileInput, {
      target: {
        files: [createImageFile()],
      },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Inspect the image" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("That image file could not be validated.")).toBeTruthy();
    expect(screen.getByText("screenshot.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.queryByText("That image file could not be validated.")).toBeNull();
      expect(screen.queryByText("screenshot.png")).toBeNull();
    });
  });
});
