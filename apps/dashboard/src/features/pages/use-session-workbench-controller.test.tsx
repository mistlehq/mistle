// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildAttachedImagePathsText,
  buildPromptWithAttachedImagePaths,
  buildTurnPrompt,
  resolveTurnRepresentation,
} from "../session-agents/codex/session-state/codex-attachment-presentation.js";
import {
  buildModelSelectionLoadingMessage,
  buildModelSelectionRequiredMessage,
  buildNonImageCapableModelWarningMessage,
  buildUnavailableModelErrorMessage,
  resolveActiveComposerModel,
  resolveComposerStatusMessage,
  resolveComposerSubmitReadiness,
  supportsImageInspection,
} from "./use-session-conversation-composer-state.js";
import { DEFAULT_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";
import {
  getSandboxInstanceStatusQueryKey,
  hasAutomationSessionPreparationTimedOut,
  hasFreshSandboxStatusRead,
  isActiveResumeRequest,
  resolveSessionEntryPhase,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  resolveStoppedSessionMessageForEntryPhase,
  seedSandboxInstanceStatusQuery,
  shouldPollStoppedSandboxStatus,
  shouldShowResumeInFlightState,
  shouldWaitForAutomationSessionThread,
  useSessionWorkbenchController,
} from "./use-session-workbench-controller.js";

function createControllerQueryClient(input?: {
  gcTime?: number;
  refetchOnMount?: boolean;
  retry?: boolean;
  staleTime?: number;
}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        ...(input?.gcTime === undefined ? {} : { gcTime: input.gcTime }),
        ...(input?.refetchOnMount === undefined ? {} : { refetchOnMount: input.refetchOnMount }),
        ...(input?.retry === undefined ? {} : { retry: input.retry }),
        ...(input?.staleTime === undefined ? {} : { staleTime: input.staleTime }),
      },
    },
  });
}

function createControllerWrapper(queryClient: QueryClient) {
  return function ControllerWrapper({ children }: React.PropsWithChildren): React.JSX.Element {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderSessionWorkbenchController(input: {
  queryClient: QueryClient;
  sandboxInstanceId: string | null;
}) {
  return renderHook(
    ({ sandboxInstanceId }: { sandboxInstanceId: string | null }) =>
      useSessionWorkbenchController({
        sandboxInstanceId,
      }),
    {
      initialProps: {
        sandboxInstanceId: input.sandboxInstanceId,
      },
      wrapper: createControllerWrapper(input.queryClient),
    },
  );
}

describe("useSessionWorkbenchController", () => {
  it("resolves the explicitly selected composer model", () => {
    expect(
      resolveActiveComposerModel({
        availableModels: [
          {
            id: "model_default",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            isDefault: true,
          },
          {
            id: "model_fast",
            model: "gpt-5.3-codex-spark",
            displayName: "GPT-5.3 Codex Spark",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text"],
            supportsPersonality: false,
            isDefault: false,
          },
        ],
        selectedModel: "gpt-5.3-codex-spark",
      }),
    )?.toMatchObject({
      model: "gpt-5.3-codex-spark",
      displayName: "GPT-5.3 Codex Spark",
    });

    expect(
      resolveActiveComposerModel({
        availableModels: [
          {
            id: "model_default",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            isDefault: true,
          },
        ],
        selectedModel: null,
      }),
    )?.toMatchObject({
      model: "gpt-5.4",
    });
  });

  it("recognizes whether the active model supports image inspection", () => {
    expect(
      supportsImageInspection({
        id: "image_model",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        hidden: false,
        defaultReasoningEffort: null,
        inputModalities: ["text", "image"],
        supportsPersonality: false,
        isDefault: true,
      }),
    ).toBe(true);

    expect(
      supportsImageInspection({
        id: "text_model",
        model: "gpt-5.3-codex-spark",
        displayName: "GPT-5.3 Codex Spark",
        hidden: false,
        defaultReasoningEffort: null,
        inputModalities: ["text"],
        supportsPersonality: false,
        isDefault: false,
      }),
    ).toBe(false);

    expect(supportsImageInspection(null)).toBe(false);
  });

  it("returns null when the selected model is unavailable", () => {
    expect(
      resolveActiveComposerModel({
        availableModels: [
          {
            id: "model_default",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            isDefault: true,
          },
          {
            id: "model_fast",
            model: "gpt-5.3-codex-spark",
            displayName: "GPT-5.3 Codex Spark",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text"],
            supportsPersonality: false,
            isDefault: false,
          },
        ],
        selectedModel: "removed-model",
      }),
    ).toBeNull();
  });

  it("formats uploaded attachment paths into prompt text", () => {
    expect(
      buildAttachedImagePathsText([
        "/tmp/attachments/thread_123/image-1.png",
        "/tmp/attachments/thread_123/image-2.webp",
      ]),
    ).toBe(
      [
        "Attached images:",
        "- /tmp/attachments/thread_123/image-1.png",
        "- /tmp/attachments/thread_123/image-2.webp",
      ].join("\n"),
    );

    expect(
      buildPromptWithAttachedImagePaths({
        prompt: "  Please review these screenshots.  ",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
      }),
    ).toBe(
      [
        "Please review these screenshots.",
        "",
        "Attached images:",
        "- /tmp/attachments/thread_123/image-1.png",
      ].join("\n"),
    );

    expect(
      buildPromptWithAttachedImagePaths({
        prompt: "   ",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
      }),
    ).toBe(["Attached images:", "- /tmp/attachments/thread_123/image-1.png"].join("\n"));
  });

  it("injects attachment paths only for non-image-capable turns", () => {
    expect(
      buildTurnPrompt({
        prompt: "  Please review these screenshots.  ",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
        supportsImageInspection: true,
      }),
    ).toBe("Please review these screenshots.");

    expect(
      buildTurnPrompt({
        prompt: "  Please review these screenshots.  ",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
        supportsImageInspection: false,
      }),
    ).toBe(
      [
        "Please review these screenshots.",
        "",
        "Attached images:",
        "- /tmp/attachments/thread_123/image-1.png",
      ].join("\n"),
    );
  });

  it("keeps uploaded images visible while only submitting them to image-capable models", () => {
    const uploadedAttachments = [
      {
        type: "localImage" as const,
        path: "/tmp/attachments/thread_123/image-1.png",
      },
    ];

    expect(
      resolveTurnRepresentation({
        prompt: "Please review these screenshots.",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
        uploadedAttachments,
        supportsImageInspection: true,
      }),
    ).toEqual({
      prompt: "Please review these screenshots.",
      submittedAttachments: uploadedAttachments,
      transcriptAttachments: uploadedAttachments,
    });

    expect(
      resolveTurnRepresentation({
        prompt: "Please review these screenshots.",
        attachmentPaths: ["/tmp/attachments/thread_123/image-1.png"],
        uploadedAttachments,
        supportsImageInspection: false,
      }),
    ).toEqual({
      prompt: [
        "Please review these screenshots.",
        "",
        "Attached images:",
        "- /tmp/attachments/thread_123/image-1.png",
      ].join("\n"),
      submittedAttachments: [],
      transcriptAttachments: uploadedAttachments,
    });
  });

  it("builds the non-image-capable warning copy", () => {
    expect(buildNonImageCapableModelWarningMessage("Codex Spark")).toBe(
      "Model Codex Spark is not image-capable. Images can remain attached, but the model will not inspect them.",
    );
  });

  it("builds the unavailable-model error copy", () => {
    expect(buildUnavailableModelErrorMessage("gpt-legacy")).toBe(
      "Model gpt-legacy is no longer available. Switch to another model to continue.",
    );
  });

  it("builds the missing-model and loading-model copy", () => {
    expect(buildModelSelectionRequiredMessage()).toBe("Choose a model before sending a message.");
    expect(buildModelSelectionLoadingMessage()).toBe(
      "Wait for the selected model to finish loading before sending a message.",
    );
  });

  it("resolves composer submission readiness from the selected model state", () => {
    expect(
      resolveComposerSubmitReadiness({
        selectedModel: null,
        activeModel: {
          id: "model_default",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          hidden: false,
          defaultReasoningEffort: null,
          inputModalities: ["text", "image"],
          supportsPersonality: false,
          isDefault: true,
        },
        resolvedModel: null,
        modelCatalogStatus: "loaded",
      }),
    ).toEqual({
      status: "ready",
      activeModel: {
        id: "model_default",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        hidden: false,
        defaultReasoningEffort: null,
        inputModalities: ["text", "image"],
        supportsPersonality: false,
        isDefault: true,
      },
    });

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: null,
        activeModel: null,
        resolvedModel: null,
        modelCatalogStatus: "idle",
      }),
    ).toEqual({
      status: "loading-model",
      selectedModel: "__default__",
      message: "Wait for the selected model to finish loading before sending a message.",
    });

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: "gpt-5.4",
        activeModel: null,
        resolvedModel: null,
        modelCatalogStatus: "loading",
      }),
    ).toEqual({
      status: "loading-model",
      selectedModel: "gpt-5.4",
      message: "Wait for the selected model to finish loading before sending a message.",
    });

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: "gpt-legacy-preview",
        activeModel: null,
        resolvedModel: null,
        modelCatalogStatus: "loaded",
      }),
    ).toEqual({
      status: "unavailable-model",
      selectedModel: "gpt-legacy-preview",
      message:
        "Model gpt-legacy-preview is no longer available. Switch to another model to continue.",
    });

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: "gpt-5.4",
        activeModel: null,
        resolvedModel: {
          id: "model_ready",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          hidden: false,
          defaultReasoningEffort: null,
          inputModalities: ["text", "image"],
          supportsPersonality: false,
          isDefault: true,
        },
        modelCatalogStatus: "error",
      }),
    ).toEqual({
      status: "ready",
      activeModel: {
        id: "model_ready",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        hidden: false,
        defaultReasoningEffort: null,
        inputModalities: ["text", "image"],
        supportsPersonality: false,
        isDefault: true,
      },
    });

    expect(
      resolveComposerSubmitReadiness({
        selectedModel: null,
        activeModel: null,
        resolvedModel: null,
        modelCatalogStatus: "loaded",
      }),
    ).toEqual({
      status: "missing-model",
      message: "Choose a model before sending a message.",
    });
  });

  it("resolves composer status message precedence", () => {
    expect(
      resolveComposerStatusMessage({
        composerErrorMessage: null,
        hasPendingAttachments: true,
        submitReadiness: {
          status: "loading-model",
          selectedModel: "gpt-legacy-preview",
          message: "Wait for the selected model to finish loading before sending a message.",
        },
      }),
    ).toEqual({
      message: "Wait for the selected model to finish loading before sending a message.",
      tone: "error",
    });

    expect(
      resolveComposerStatusMessage({
        composerErrorMessage: null,
        hasPendingAttachments: true,
        submitReadiness: {
          status: "unavailable-model",
          selectedModel: "gpt-legacy-preview",
          message:
            "Model gpt-legacy-preview is no longer available. Switch to another model to continue.",
        },
      }),
    ).toEqual({
      message:
        "Model gpt-legacy-preview is no longer available. Switch to another model to continue.",
      tone: "error",
    });

    expect(
      resolveComposerStatusMessage({
        composerErrorMessage: null,
        hasPendingAttachments: true,
        submitReadiness: {
          status: "ready",
          activeModel: {
            id: "text_model",
            model: "gpt-5.3-codex-spark",
            displayName: "GPT-5.3 Codex Spark",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text"],
            supportsPersonality: false,
            isDefault: false,
          },
        },
      }),
    ).toEqual({
      message:
        "Model GPT-5.3 Codex Spark is not image-capable. Images can remain attached, but the model will not inspect them.",
      tone: "warning",
    });

    expect(
      resolveComposerStatusMessage({
        composerErrorMessage: "That file is not a supported PNG, JPEG, WebP, or GIF image.",
        hasPendingAttachments: true,
        submitReadiness: {
          status: "ready",
          activeModel: {
            id: "image_model",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            defaultReasoningEffort: null,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            isDefault: true,
          },
        },
      }),
    ).toEqual({
      message: "That file is not a supported PNG, JPEG, WebP, or GIF image.",
      tone: "error",
    });
  });

  it("returns separate workbench and conversation pane state for a missing session id", () => {
    const queryClient = createControllerQueryClient();
    const { result } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId: null,
    });

    expect(Object.keys(result.current)).toEqual(["workbench", "conversationPane"]);
    expect(result.current.workbench.connectionReadiness).toEqual({
      canConnect: false,
      reason: "missing-session",
    });
    expect(result.current.workbench.stoppedSessionState).toEqual({
      message: null,
      requiresManualResume: false,
    });
    expect(result.current.workbench.hasTopAlert).toBe(false);
    expect(result.current.workbench.ptyState.lifecycle.connectedSandboxInstanceId).toBeNull();
    expect(result.current.workbench.ptyState.lifecycle.state).toBe("idle");
    expect(result.current.workbench.ptyState.output.chunks).toEqual([]);
    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);
    expect(result.current.workbench.startErrorMessage).toBeNull();
    expect(result.current.workbench.sandboxFailureMessage).toBeNull();
    expect(result.current.conversationPane.chatState.entries).toEqual([]);
    expect(result.current.conversationPane.composerProps.composerUi.isConnected).toBe(false);
    expect(result.current.conversationPane.composerProps.modelOptions).toEqual([]);
    expect(result.current.conversationPane.serverRequestsState.pendingServerRequests).toEqual([]);
  });

  it("persists terminal panel visibility and size per sandbox instance", () => {
    const hasStorageApi =
      typeof window.localStorage === "object" &&
      window.localStorage !== null &&
      typeof window.localStorage.getItem === "function" &&
      typeof window.localStorage.removeItem === "function";
    const sandboxInstanceIdOne = `sbi-one-${Date.now()}`;
    const sandboxInstanceIdTwo = `sbi-two-${Date.now()}`;

    if (hasStorageApi) {
      window.localStorage.removeItem(
        `dashboard:session-terminal-workbench:${sandboxInstanceIdOne}`,
      );
      window.localStorage.removeItem(
        `dashboard:session-terminal-workbench:${sandboxInstanceIdTwo}`,
      );
    }

    const queryClient = createControllerQueryClient();
    const { result, rerender } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId: sandboxInstanceIdOne,
    });

    act(() => {
      result.current.workbench.terminalPanelState.openPanel();
      result.current.workbench.terminalPanelState.setPanelSize(52);
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(true);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(52);

    rerender({
      sandboxInstanceId: sandboxInstanceIdTwo,
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);

    rerender({
      sandboxInstanceId: sandboxInstanceIdOne,
    });

    const expectedVisibility = hasStorageApi;
    const expectedPanelSize = hasStorageApi ? 52 : DEFAULT_TERMINAL_PANEL_SIZE;

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(expectedVisibility);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(expectedPanelSize);
  });

  it("waits for automation-backed sessions whose persisted thread id is still pending", () => {
    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: {
          conversationId: "cnv_pending",
          routeId: "cvr_pending",
          providerConversationId: null,
        },
      }),
    ).toBe(true);

    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: {
          conversationId: "cnv_ready",
          routeId: "cvr_ready",
          providerConversationId: "thread_ready",
        },
      }),
    ).toBe(false);

    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: null,
      }),
    ).toBe(false);
  });

  it("times out automation pending state after the configured wait window", () => {
    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBe(false);

    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(false);

    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 30_000,
      }),
    ).toBe(true);
  });

  it("computes the remaining automation preparation timeout delay", () => {
    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBeNull();

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 0,
      }),
    ).toBe(30_000);

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(1);

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 30_000,
      }),
    ).toBe(0);
  });

  it("treats status data as fresh only after a post-mount query update", () => {
    expect(
      hasFreshSandboxStatusRead({
        initialDataUpdatedAtMs: null,
        currentDataUpdatedAtMs: 0,
      }),
    ).toBe(false);

    expect(
      hasFreshSandboxStatusRead({
        initialDataUpdatedAtMs: 0,
        currentDataUpdatedAtMs: 0,
      }),
    ).toBe(false);

    expect(
      hasFreshSandboxStatusRead({
        initialDataUpdatedAtMs: 123,
        currentDataUpdatedAtMs: 124,
      }),
    ).toBe(true);
  });

  it("seeds the sandbox status query from a successful resume response", () => {
    const queryClient = createControllerQueryClient();

    seedSandboxInstanceStatusQuery({
      queryClient,
      sandboxInstanceId: "sbi_resume_001",
      sandboxStatus: {
        id: "sbi_resume_001",
        status: "starting",
        failureCode: null,
        failureMessage: null,
        automationConversation: null,
      },
    });

    expect(queryClient.getQueryData(getSandboxInstanceStatusQueryKey("sbi_resume_001"))).toEqual({
      id: "sbi_resume_001",
      status: "starting",
      failureCode: null,
      failureMessage: null,
      automationConversation: null,
    });
  });

  it.each([
    {
      expected: true,
      input: {
        sandboxStatus: "stopped" as const,
        hasAttemptedInitialStoppedResume: true,
        isResumingStoppedSandbox: false,
        resumeActionErrorMessage: null,
      },
    },
    {
      expected: false,
      input: {
        sandboxStatus: "stopped" as const,
        hasAttemptedInitialStoppedResume: true,
        isResumingStoppedSandbox: false,
        resumeActionErrorMessage: "Resume failed",
      },
    },
    {
      expected: false,
      input: {
        sandboxStatus: "running" as const,
        hasAttemptedInitialStoppedResume: true,
        isResumingStoppedSandbox: false,
        resumeActionErrorMessage: null,
      },
    },
  ])(
    "keeps polling while a stopped sandbox is still resuming: $expected",
    ({ input, expected }) => {
      expect(shouldPollStoppedSandboxStatus(input)).toBe(expected);
    },
  );

  it.each([
    {
      expected: "loading",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        isStatusPending: true,
        sandboxStatus: null,
      },
    },
    {
      expected: "resume_pending",
      input: {
        connectedSession: false,
        hasResumeInFlightState: true,
        isStatusPending: false,
        sandboxStatus: "stopped" as const,
      },
    },
    {
      expected: "manual_resume_required",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        isStatusPending: false,
        sandboxStatus: "stopped" as const,
      },
    },
    {
      expected: "sandbox_starting",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        isStatusPending: false,
        sandboxStatus: "starting" as const,
      },
    },
    {
      expected: "connecting",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        isStatusPending: false,
        sandboxStatus: "running" as const,
      },
    },
    {
      expected: "ready",
      input: {
        connectedSession: true,
        hasResumeInFlightState: false,
        isStatusPending: false,
        sandboxStatus: "running" as const,
      },
    },
    {
      expected: "sandbox_failed",
      input: {
        connectedSession: false,
        hasResumeInFlightState: false,
        isStatusPending: false,
        sandboxStatus: "failed" as const,
      },
    },
  ])("routes session entry based on sandbox lifecycle status: $expected", ({ input, expected }) => {
    expect(resolveSessionEntryPhase(input)).toBe(expected);
  });

  it("shows resume progress while auto-resume is being kicked off or actively submitting", () => {
    expect(
      shouldShowResumeInFlightState({
        hasAttemptedInitialStoppedResume: false,
        resumeActionErrorMessage: null,
        shouldAttemptInitialStoppedResume: false,
        isResumingStoppedSandbox: true,
        sandboxStatus: "stopped",
      }),
    ).toBe(true);

    expect(
      shouldShowResumeInFlightState({
        hasAttemptedInitialStoppedResume: false,
        resumeActionErrorMessage: null,
        shouldAttemptInitialStoppedResume: true,
        isResumingStoppedSandbox: false,
        sandboxStatus: "stopped",
      }),
    ).toBe(true);

    expect(
      shouldShowResumeInFlightState({
        hasAttemptedInitialStoppedResume: true,
        resumeActionErrorMessage: null,
        shouldAttemptInitialStoppedResume: false,
        isResumingStoppedSandbox: false,
        sandboxStatus: "stopped",
      }),
    ).toBe(true);

    expect(
      shouldShowResumeInFlightState({
        hasAttemptedInitialStoppedResume: true,
        resumeActionErrorMessage: "Resume conflict",
        shouldAttemptInitialStoppedResume: false,
        isResumingStoppedSandbox: false,
        sandboxStatus: "stopped",
      }),
    ).toBe(false);

    expect(
      shouldShowResumeInFlightState({
        hasAttemptedInitialStoppedResume: false,
        resumeActionErrorMessage: null,
        shouldAttemptInitialStoppedResume: false,
        isResumingStoppedSandbox: false,
        sandboxStatus: "stopped",
      }),
    ).toBe(false);

    expect(
      shouldShowResumeInFlightState({
        hasAttemptedInitialStoppedResume: false,
        resumeActionErrorMessage: null,
        shouldAttemptInitialStoppedResume: true,
        isResumingStoppedSandbox: false,
        sandboxStatus: "starting",
      }),
    ).toBe(false);
  });

  it("shows definitive resume failures in the stopped-session message path", () => {
    expect(
      resolveStoppedSessionMessageForEntryPhase({
        phase: "manual_resume_required",
        resumeActionErrorMessage: "You no longer have access to this sandbox.",
      }),
    ).toBe("You no longer have access to this sandbox.");

    expect(
      resolveStoppedSessionMessageForEntryPhase({
        phase: "manual_resume_required",
        resumeActionErrorMessage: null,
      }),
    ).toBe("This sandbox is stopped. Resume it to reconnect chat and terminal.");

    expect(
      resolveStoppedSessionMessageForEntryPhase({
        phase: "resume_pending",
        resumeActionErrorMessage: "Conflict",
      }),
    ).toBeNull();
  });

  it("accepts resume completions only for the active request on the same sandbox", () => {
    expect(
      isActiveResumeRequest({
        activeRequest: null,
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(false);

    expect(
      isActiveResumeRequest({
        activeRequest: {
          requestId: 2,
          sandboxInstanceId: "sbi_resume_001",
        },
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(false);

    expect(
      isActiveResumeRequest({
        activeRequest: {
          requestId: 1,
          sandboxInstanceId: "sbi_resume_002",
        },
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(false);

    expect(
      isActiveResumeRequest({
        activeRequest: {
          requestId: 1,
          sandboxInstanceId: "sbi_resume_001",
        },
        requestId: 1,
        sandboxInstanceId: "sbi_resume_001",
      }),
    ).toBe(true);
  });

  it("does not auto-resume from a seeded stopped cache before a fresh fetch", () => {
    const sandboxInstanceId = `sbi-resume-${Date.now()}`;
    const queryClient = createControllerQueryClient({
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedSandboxInstanceStatusQuery({
      queryClient,
      sandboxInstanceId,
      sandboxStatus: {
        id: sandboxInstanceId,
        status: "stopped",
        failureCode: null,
        failureMessage: null,
        automationConversation: null,
      },
    });

    const { result } = renderSessionWorkbenchController({
      queryClient,
      sandboxInstanceId,
    });

    expect(result.current.workbench.isResumingStoppedSandbox).toBe(false);
    expect(result.current.workbench.connectionReadiness.reason).toBe("unknown");
    expect(result.current.workbench.stoppedSessionState.requiresManualResume).toBe(false);
  });
});
