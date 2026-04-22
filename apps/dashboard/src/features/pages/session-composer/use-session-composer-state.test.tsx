// @vitest-environment jsdom

import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { SessionBootstrapResult } from "../../session-agents/codex/session-state/session-bootstrap/index.js";
import type { PendingSessionDiffComment } from "../session-diff-comment.js";
import { useSessionComposerState } from "./use-session-composer-state.js";

const ReadyBootstrap: SessionBootstrapResult = {
  phase: { status: "ready" },
  establishedSnapshot: {
    availableModels: [
      {
        id: "model-1",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        hidden: false,
        defaultReasoningEffort: "medium",
        inputModalities: ["text"],
        supportsPersonality: true,
        isDefault: true,
      } satisfies CodexModelSummary,
    ],
    configSnapshot: {
      model: "gpt-5.4",
      modelReasoningEffort: "medium",
    },
  },
};

const PendingDiffCommentsFixture: readonly PendingSessionDiffComment[] = [
  {
    id: "comment-1",
    anchor: {
      lineText: '          title="Diffs"',
      nextLineText: '          type="button"',
      previousLineText: '          size="icon-sm"',
    },
    body: "Request change",
    filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
    lineNumber: 140,
    repositoryPath: "/workspace/mistle",
    side: "additions",
    status: {
      kind: "current",
    },
  },
  {
    id: "comment-2",
    anchor: {
      lineText: "+export function SessionDiffPanel(): React.JSX.Element {",
      nextLineText: "+  return <div />;",
      previousLineText: "",
    },
    body: "Use the shared overflow tooltip here.",
    filePath: "apps/dashboard/src/features/pages/session-diff-panel.tsx",
    lineNumber: 4,
    repositoryPath: "/workspace/mistle",
    side: "additions",
    status: {
      kind: "current",
    },
  },
];

function SessionComposerStateHarness(input: {
  composerText: string;
  pendingDiffComments: readonly PendingSessionDiffComment[];
  shouldFailSubmit?: boolean;
}): React.JSX.Element {
  const [composerText, setComposerText] = useState(input.composerText);
  const [pendingDiffComments, setPendingDiffComments] = useState(input.pendingDiffComments);
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
  const [transcriptPrompt, setTranscriptPrompt] = useState<string | null>(null);

  const composerState = useSessionComposerState({
    composerStateInput: {
      bootstrap: ReadyBootstrap,
      clearSessionErrorMessage: () => {
        return;
      },
      configControl: {
        selectedModel: "gpt-5.4",
        selectedReasoningEffort: "medium",
        modelOptions: [{ value: "gpt-5.4", label: "GPT-5.4" }],
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
      attachmentControl: {
        canUploadAttachments: true,
        isUploadingAttachments: false,
        prepareAttachments: async ({ prompt }) => ({
          prompt,
          submittedAttachments: [],
          displayAttachments: [],
        }),
      },
      gitBranchLabel: null,
      sessionErrorMessage: null,
      turnControl: {
        activeTurnState: "idle",
        canSteer: false,
        canInterrupt: false,
        isStarting: false,
        isSteering: false,
        isInterrupting: false,
        completedTurnErrorMessage: null,
        startTurn: async ({ submittedPrompt, transcriptPrompt }) => {
          if (input.shouldFailSubmit) {
            throw new Error("Could not submit chat message.");
          }

          setSubmittedPrompt(submittedPrompt);
          setTranscriptPrompt(transcriptPrompt ?? null);
        },
        steerTurn: async ({ submittedPrompt, transcriptPrompt }) => {
          setSubmittedPrompt(submittedPrompt);
          setTranscriptPrompt(transcriptPrompt ?? null);
        },
        interruptTurn: () => {
          return;
        },
      },
    },
    draftState: {
      composerText,
      pendingDiffComments,
      clearPendingDiffComments: () => {
        setPendingDiffComments([]);
      },
      setComposerText,
    },
  });

  return (
    <div>
      <button onClick={composerState.composerViewModel.onSubmit} type="button">
        Submit
      </button>
      <div data-testid="submit-mode">{composerState.composerViewModel.submitMode}</div>
      <div data-testid="submit-disabled">
        {composerState.composerViewModel.submitDisabled ? "true" : "false"}
      </div>
      <div data-testid="submitted-prompt">{submittedPrompt ?? ""}</div>
      <div data-testid="transcript-prompt">{transcriptPrompt ?? ""}</div>
      <div data-testid="composer-text">{composerText}</div>
      <div data-testid="pending-diff-comments">{String(pendingDiffComments.length)}</div>
      <div data-testid="status-message">{composerState.statusMessage?.message ?? ""}</div>
    </div>
  );
}

describe("useSessionComposerState", () => {
  it("submits diff comments even when the composer text is blank and clears them on success", async () => {
    render(
      <SessionComposerStateHarness
        composerText="   "
        pendingDiffComments={PendingDiffCommentsFixture}
      />,
    );

    expect(screen.getByTestId("submit-mode").textContent).toBe("start");
    expect(screen.getByTestId("submit-disabled").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByTestId("submitted-prompt").textContent).toContain(
        "Review comment on `apps/dashboard/src/features/pages/session-workbench-page.tsx` line R140:",
      );
    });
    expect(screen.getByTestId("transcript-prompt").textContent).toContain(
      "Review comment on `apps/dashboard/src/features/pages/session-diff-panel.tsx` line R4:",
    );
    expect(screen.getByTestId("composer-text").textContent).toBe("");
    expect(screen.getByTestId("pending-diff-comments").textContent).toBe("0");
  });

  it("keeps pending diff comments in place when submit fails", async () => {
    render(
      <SessionComposerStateHarness
        composerText=""
        pendingDiffComments={PendingDiffCommentsFixture}
        shouldFailSubmit
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("status-message").textContent).toBe(
        "Could not submit chat message.",
      );
    });
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("pending-diff-comments").textContent).toBe("2");
  });
});
