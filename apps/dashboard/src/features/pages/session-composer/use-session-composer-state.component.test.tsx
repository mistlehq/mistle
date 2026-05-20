// @vitest-environment jsdom

import type { ComposerCapability } from "@mistle/integrations-core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { PendingSessionDiffComment } from "../session-diff-comment.js";
import type {
  SessionComposerBootstrapResult,
  SessionComposerCollaborationModeSettings,
  SessionComposerModel,
} from "./session-composer-runtime-contracts.js";
import { useSessionComposerState } from "./use-session-composer-state.js";

const ReadyBootstrap: SessionComposerBootstrapResult = {
  phase: { status: "ready" },
  composerCapabilities: [],
  establishedSnapshot: {
    availableModels: [
      {
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        defaultReasoningEffort: "medium",
        inputModalities: ["text"],
        isDefault: true,
      } satisfies SessionComposerModel,
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
  activeTurnState?: "idle" | "running";
  canInterrupt?: boolean;
  canSteer?: boolean;
  collaborationDeveloperInstructions?: string;
  composerCapabilities?: readonly ComposerCapability[];
  composerText: string;
  configControlsDisabled?: boolean;
  configUpdating?: boolean;
  deferNativeQueue?: boolean;
  deferSubmit?: boolean;
  enableNativeQueueTurn?: boolean;
  executeRuntimeCommand?: (commandId: string) => boolean;
  executeTypedRuntimeCommand?: (input: { commandId: string; text: string }) => boolean;
  initialCollaborationMode?: "default" | "plan";
  onSwitchToPlan?: () => void;
  onSwitchToDefault?: () => void;
  pendingDiffComments: readonly PendingSessionDiffComment[];
  selectedModel?: string | null;
  shouldFailSubmit?: boolean;
  unavailableTypedRuntimeCommands?: readonly {
    name: string;
    message: string;
  }[];
}): React.JSX.Element {
  const [composerText, setComposerText] = useState(input.composerText);
  const [pendingDiffComments, setPendingDiffComments] = useState(input.pendingDiffComments);
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [nativeQueueSubmissionCount, setNativeQueueSubmissionCount] = useState(0);
  const [transcriptPrompt, setTranscriptPrompt] = useState<string | null>(null);
  const [collaborationModeSettings, setCollaborationModeSettings] =
    useState<SessionComposerCollaborationModeSettings | null>(null);
  const [collaborationMode, setCollaborationMode] = useState<"default" | "plan" | null>(null);
  const [resolveSubmit, setResolveSubmit] = useState<(() => void) | null>(null);
  const [resolveNativeQueue, setResolveNativeQueue] = useState<(() => void) | null>(null);

  const composerState = useSessionComposerState({
    composerStateInput: {
      bootstrap:
        input.composerCapabilities === undefined
          ? ReadyBootstrap
          : {
              ...ReadyBootstrap,
              composerCapabilities: input.composerCapabilities,
            },
      clearSessionErrorMessage: () => {
        return;
      },
      configControl: {
        selectedModel: input.selectedModel ?? "gpt-5.4",
        selectedReasoningEffort: "medium",
        hasExplicitModelSelection: true,
        modelOptions: [{ value: "gpt-5.4", label: "GPT-5.4" }],
        reasoningEffortOptions: [{ value: "medium", label: "Medium" }],
        canChangeReasoningEffort: true,
        controlsDisabled: input.configControlsDisabled ?? input.configUpdating === true,
        isUpdating: input.configUpdating === true,
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
          uploadedAttachments: [],
        }),
      },
      repositoryStatus: {
        branchLabel: null,
        pullRequest: null,
      },
      contextUsage: null,
      modelSelection: {
        required: true,
        showControls: true,
      },
      collaborationMode: {
        mode: input.initialCollaborationMode ?? "default",
        onSwitchToPlan: () => {
          setCollaborationMode("plan");
          input.onSwitchToPlan?.();
        },
        onSwitchToDefault: () => {
          setCollaborationMode("default");
          input.onSwitchToDefault?.();
        },
      },
      ...(input.collaborationDeveloperInstructions === undefined
        ? {}
        : {
            collaborationModeSettings: {
              developerInstructions: input.collaborationDeveloperInstructions,
            },
          }),
      sessionErrorMessage: null,
      turnControl: {
        activeTurnState: input.activeTurnState ?? "idle",
        canSteer: input.canSteer ?? input.activeTurnState === "running",
        canInterrupt: input.canInterrupt ?? false,
        isStarting: false,
        isSteering: false,
        isInterrupting: false,
        completedTurnErrorMessage: null,
        startTurn: async ({
          submittedPrompt,
          transcriptPrompt,
          collaborationMode,
          collaborationModeSettings,
        }) => {
          if (input.shouldFailSubmit) {
            throw new Error("Could not submit chat message.");
          }

          setSubmittedPrompt(submittedPrompt);
          setTranscriptPrompt(transcriptPrompt ?? null);
          setCollaborationMode(collaborationMode ?? null);
          setCollaborationModeSettings(collaborationModeSettings ?? null);
          if (input.deferSubmit) {
            await new Promise<void>((resolve) => {
              setResolveSubmit(() => resolve);
            });
          }
        },
        steerTurn: async ({ submittedPrompt, transcriptPrompt }) => {
          setSubmittedPrompt(submittedPrompt);
          setTranscriptPrompt(transcriptPrompt ?? null);
        },
        ...(input.enableNativeQueueTurn === true
          ? {
              queueTurn: async ({ submittedPrompt, transcriptPrompt }) => {
                setNativeQueueSubmissionCount((currentCount) => currentCount + 1);
                setQueuedPrompt(submittedPrompt);
                setTranscriptPrompt(transcriptPrompt ?? null);
                if (input.deferNativeQueue) {
                  await new Promise<void>((resolve) => {
                    setResolveNativeQueue(() => resolve);
                  });
                }
              },
            }
          : {}),
        interruptTurn: () => {
          return;
        },
      },
      ...(input.executeRuntimeCommand === undefined
        ? {}
        : { executeRuntimeCommand: input.executeRuntimeCommand }),
      ...(input.executeTypedRuntimeCommand === undefined
        ? {}
        : { executeTypedRuntimeCommand: input.executeTypedRuntimeCommand }),
      ...(input.unavailableTypedRuntimeCommands === undefined
        ? {}
        : { unavailableTypedRuntimeCommands: input.unavailableTypedRuntimeCommands }),
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
      <button onClick={composerState.composerViewModel.onSecondarySubmit} type="button">
        Queue
      </button>
      <button
        onClick={() => {
          composerState.composerViewModel.onRuntimeCommandSubmit("codex.compact");
        }}
        type="button"
      >
        Submit runtime command
      </button>
      <button
        onClick={() => {
          composerState.composerViewModel.onPendingFilesAdded([
            new File(["pdf-bytes"], "requirements.pdf", {
              type: "application/pdf",
            }),
          ]);
        }}
        type="button"
      >
        Add PDF
      </button>
      {resolveSubmit === null ? null : (
        <button onClick={resolveSubmit} type="button">
          Resolve submit
        </button>
      )}
      {resolveNativeQueue === null ? null : (
        <button onClick={resolveNativeQueue} type="button">
          Resolve queue
        </button>
      )}
      <div data-testid="submit-mode">{composerState.composerViewModel.submitMode}</div>
      <div data-testid="composer-capability-count">
        {String(composerState.composerViewModel.composerCapabilities.length)}
      </div>
      <div data-testid="submit-disabled">
        {composerState.composerViewModel.submitDisabled ? "true" : "false"}
      </div>
      <div data-testid="secondary-submit-disabled">
        {composerState.composerViewModel.secondarySubmitDisabled ? "true" : "false"}
      </div>
      <div data-testid="config-controls-disabled">
        {composerState.composerViewModel.configControlsDisabled ? "true" : "false"}
      </div>
      <div data-testid="submitted-prompt">{submittedPrompt ?? ""}</div>
      <div data-testid="queued-prompt">{queuedPrompt ?? ""}</div>
      <div data-testid="native-queue-submission-count">{String(nativeQueueSubmissionCount)}</div>
      <div data-testid="transcript-prompt">{transcriptPrompt ?? ""}</div>
      <div data-testid="collaboration-mode-settings">
        {collaborationModeSettings === null ? "" : JSON.stringify(collaborationModeSettings)}
      </div>
      <div data-testid="collaboration-mode">{collaborationMode ?? ""}</div>
      <div data-testid="composer-text">{composerText}</div>
      <div data-testid="pending-attachments">
        {composerState.composerViewModel.pendingAttachments
          .map((attachment) => attachment.name)
          .join(",")}
      </div>
      <div data-testid="pending-diff-comments">{String(pendingDiffComments.length)}</div>
      <div data-testid="queued-prompt-count">{String(composerState.queuedPrompts.length)}</div>
      <div data-testid="queued-prompts">
        {composerState.queuedPrompts.map((queuedPrompt) => queuedPrompt.text).join("|")}
      </div>
      <div data-testid="status-message">{composerState.statusMessage?.message ?? ""}</div>
    </div>
  );
}

describe("useSessionComposerState", () => {
  afterEach(() => {
    cleanup();
  });

  it("passes composer capabilities through to the composer view model", () => {
    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.review",
                name: "review",
                availability: {
                  duringActiveTurn: "disabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ]}
        composerText="Review this"
        pendingDiffComments={[]}
      />,
    );

    expect(screen.getByTestId("composer-capability-count").textContent).toBe("1");
  });

  it("executes available runtime composer commands without submitting prompt text", () => {
    const submittedRuntimeCommands: string[] = [];

    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.compact",
                name: "compact",
                submitAs: "runtimeCommand",
              },
            ],
          },
        ]}
        composerText="/compact"
        executeRuntimeCommand={(commandId) => {
          submittedRuntimeCommands.push(commandId);
          return true;
        }}
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit runtime command" }));

    expect(submittedRuntimeCommands).toEqual(["codex.compact"]);
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("");
  });

  it("shows a local error when a runtime composer command has no executor", () => {
    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.compact",
                name: "compact",
                submitAs: "runtimeCommand",
              },
            ],
          },
        ]}
        composerText="/compact"
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit runtime command" }));

    expect(screen.getByTestId("status-message").textContent).toBe(
      "Runtime command 'codex.compact' is not supported.",
    );
    expect(screen.getByTestId("composer-text").textContent).toBe("/compact");
  });

  it("preserves runtime composer command text when the executor rejects it", () => {
    const submittedRuntimeCommands: string[] = [];

    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.compact",
                name: "compact",
                submitAs: "runtimeCommand",
              },
            ],
          },
        ]}
        composerText="/compact"
        executeRuntimeCommand={(commandId) => {
          submittedRuntimeCommands.push(commandId);
          return false;
        }}
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit runtime command" }));

    expect(submittedRuntimeCommands).toEqual(["codex.compact"]);
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("/compact");
  });

  it("executes typed runtime commands instead of submitting them as prompt text", () => {
    const submittedRuntimeCommands: { commandId: string; text: string }[] = [];

    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.goal",
                name: "goal",
                availability: {
                  duringActiveTurn: "enabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ]}
        composerText="/goal ship the command"
        executeTypedRuntimeCommand={(command) => {
          submittedRuntimeCommands.push(command);
          return true;
        }}
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submittedRuntimeCommands).toEqual([
      {
        commandId: "codex.goal",
        text: "/goal ship the command",
      },
    ]);
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("");
  });

  it("keeps typed runtime command text when the runtime rejects it", () => {
    const submittedRuntimeCommands: { commandId: string; text: string }[] = [];

    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.review",
                name: "review",
                availability: {
                  duringActiveTurn: "disabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ]}
        composerText="/review check auth"
        executeTypedRuntimeCommand={(command) => {
          submittedRuntimeCommands.push(command);
          return false;
        }}
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submittedRuntimeCommands).toEqual([
      {
        commandId: "codex.review",
        text: "/review check auth",
      },
    ]);
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("/review check auth");
  });

  it("switches to Plan mode for a bare plan command", () => {
    let switchedToPlan = false;

    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.plan",
                name: "plan",
                availability: {
                  duringActiveTurn: "disabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ]}
        composerText="/plan"
        onSwitchToPlan={() => {
          switchedToPlan = true;
        }}
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(switchedToPlan).toBe(true);
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("");
  });

  it("submits plan command text in Plan mode", async () => {
    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.plan",
                name: "plan",
                availability: {
                  duringActiveTurn: "disabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ]}
        composerText="/plan design the rollout"
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByTestId("submitted-prompt").textContent).toBe("design the rollout");
    });
    expect(screen.getByTestId("collaboration-mode").textContent).toBe("plan");
    expect(screen.getByTestId("collaboration-mode-settings").textContent).toBe(
      JSON.stringify({
        mode: "plan",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        developerInstructions: null,
      }),
    );
    expect(screen.getByTestId("composer-text").textContent).toBe("");
  });

  it("keeps typed runtime commands submittable when the selected model is unavailable", () => {
    const submittedRuntimeCommands: { commandId: string; text: string }[] = [];

    render(
      <SessionComposerStateHarness
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.goal",
                name: "goal",
                availability: {
                  duringActiveTurn: "enabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ]}
        composerText="/goal ship the command"
        executeTypedRuntimeCommand={(command) => {
          submittedRuntimeCommands.push(command);
          return true;
        }}
        pendingDiffComments={[]}
        selectedModel="missing-model"
      />,
    );

    expect(screen.getByTestId("submit-disabled").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submittedRuntimeCommands).toEqual([
      {
        commandId: "codex.goal",
        text: "/goal ship the command",
      },
    ]);
  });

  it("blocks unavailable typed runtime commands before prompt submission", () => {
    render(
      <SessionComposerStateHarness
        composerText="/goal ship the command"
        pendingDiffComments={[]}
        unavailableTypedRuntimeCommands={[
          {
            name: "goal",
            message: "/goal is not enabled for this Codex runtime.",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByTestId("status-message").textContent).toBe(
      "/goal is not enabled for this Codex runtime.",
    );
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("/goal ship the command");
  });

  it("does not queue typed runtime commands during an active turn", () => {
    const submittedRuntimeCommands: { commandId: string; text: string }[] = [];

    render(
      <SessionComposerStateHarness
        activeTurnState="running"
        canSteer
        composerCapabilities={[
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.goal",
                name: "goal",
                availability: {
                  duringActiveTurn: "enabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ]}
        composerText="/goal ship the command"
        executeTypedRuntimeCommand={(command) => {
          submittedRuntimeCommands.push(command);
          return true;
        }}
        pendingDiffComments={[]}
      />,
    );

    expect(screen.getByTestId("secondary-submit-disabled").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    expect(screen.getByTestId("queued-prompts").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("/goal ship the command");
    expect(submittedRuntimeCommands).toEqual([]);
  });

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

  it("keeps the draft visible until submit resolves successfully", async () => {
    render(
      <SessionComposerStateHarness
        composerText="Review these comments"
        deferSubmit
        pendingDiffComments={PendingDiffCommentsFixture}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByTestId("submitted-prompt").textContent).toContain("Review these comments");
    });
    expect(screen.getByTestId("composer-text").textContent).toBe("Review these comments");
    expect(screen.getByTestId("pending-diff-comments").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Resolve submit" }));

    await waitFor(() => {
      expect(screen.getByTestId("composer-text").textContent).toBe("");
    });
    expect(screen.getByTestId("pending-diff-comments").textContent).toBe("0");
  });

  it("keeps the draft when submit fails", async () => {
    render(
      <SessionComposerStateHarness
        composerText="Submit this with review comments"
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
    expect(screen.getByTestId("composer-text").textContent).toBe(
      "Submit this with review comments",
    );
    expect(screen.getByTestId("pending-diff-comments").textContent).toBe("2");
  });

  it("submits runtime-native queued turns immediately and clears the draft on success", async () => {
    render(
      <SessionComposerStateHarness
        activeTurnState="running"
        composerText="Follow up after this"
        enableNativeQueueTurn
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    await waitFor(() => {
      expect(screen.getByTestId("queued-prompt").textContent).toBe("Follow up after this");
    });
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("");
    expect(screen.getByTestId("queued-prompt-count").textContent).toBe("0");
  });

  it("guards runtime-native queued turns while queue submission is pending", async () => {
    render(
      <SessionComposerStateHarness
        activeTurnState="running"
        composerText="Follow up once"
        deferNativeQueue
        enableNativeQueueTurn
        pendingDiffComments={[]}
      />,
    );

    const queueButton = screen.getByRole("button", { name: "Queue" });
    fireEvent.click(queueButton);
    fireEvent.click(queueButton);

    await waitFor(() => {
      expect(screen.getByTestId("native-queue-submission-count").textContent).toBe("1");
    });
    expect(screen.getByTestId("composer-text").textContent).toBe("Follow up once");
    expect(screen.getByTestId("queued-prompt-count").textContent).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "Resolve queue" }));

    await waitFor(() => {
      expect(screen.getByTestId("composer-text").textContent).toBe("");
    });
    expect(screen.getByTestId("native-queue-submission-count").textContent).toBe("1");
  });

  it("blocks prompt submission while composer config is updating", () => {
    render(
      <SessionComposerStateHarness
        composerText="Submit after model switch"
        configUpdating
        pendingDiffComments={[]}
      />,
    );

    expect(screen.getByTestId("submit-disabled").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("Submit after model switch");
  });

  it("blocks queued prompts while composer config is updating", () => {
    render(
      <SessionComposerStateHarness
        activeTurnState="running"
        composerText="Queue after model switch"
        configUpdating
        enableNativeQueueTurn
        pendingDiffComments={[]}
      />,
    );

    expect(screen.getByTestId("secondary-submit-disabled").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    expect(screen.getByTestId("queued-prompt").textContent).toBe("");
    expect(screen.getByTestId("composer-text").textContent).toBe("Queue after model switch");
  });

  it("keeps native queue available when only composer config controls are disabled", async () => {
    render(
      <SessionComposerStateHarness
        activeTurnState="running"
        composerText="Queue while controls are disabled"
        configControlsDisabled
        enableNativeQueueTurn
        pendingDiffComments={[]}
      />,
    );

    expect(screen.getByTestId("config-controls-disabled").textContent).toBe("true");
    expect(screen.getByTestId("secondary-submit-disabled").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    await waitFor(() => {
      expect(screen.getByTestId("queued-prompt").textContent).toBe(
        "Queue while controls are disabled",
      );
    });
  });

  it("does not drain local queued prompts while composer config is updating", async () => {
    const { rerender } = render(
      <SessionComposerStateHarness
        activeTurnState="running"
        composerText="Queue after current task"
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    expect(screen.getByTestId("queued-prompt-count").textContent).toBe("1");

    rerender(
      <SessionComposerStateHarness
        activeTurnState="idle"
        composerText=""
        configUpdating
        pendingDiffComments={[]}
      />,
    );

    expect(screen.getByTestId("queued-prompt-count").textContent).toBe("1");
    expect(screen.getByTestId("submitted-prompt").textContent).toBe("");

    rerender(
      <SessionComposerStateHarness
        activeTurnState="idle"
        composerText=""
        pendingDiffComments={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("submitted-prompt").textContent).toBe("Queue after current task");
    });
    expect(screen.getByTestId("queued-prompt-count").textContent).toBe("0");
  });

  it("submits developer instructions with the selected model for scoped conversations", async () => {
    render(
      <SessionComposerStateHarness
        collaborationDeveloperInstructions="You are Setup Assistant."
        composerText="Draft the setup script"
        pendingDiffComments={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByTestId("submitted-prompt").textContent).toBe("Draft the setup script");
    });
    expect(screen.getByTestId("collaboration-mode-settings").textContent).toBe(
      JSON.stringify({
        mode: "default",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        developerInstructions: "You are Setup Assistant.",
      }),
    );
  });

  it("keeps non-image files pending without showing the image warning", () => {
    render(<SessionComposerStateHarness composerText="" pendingDiffComments={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add PDF" }));

    expect(screen.getByTestId("pending-attachments").textContent).toBe("requirements.pdf");
    expect(screen.getByTestId("status-message").textContent).toBe("");
  });
});
