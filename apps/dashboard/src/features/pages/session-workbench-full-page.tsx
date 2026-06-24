import { CssBreakpointVariables, useIsBelowBreakpoint } from "@mistle/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useSearchParams } from "react-router";

import { isUnavailableResourceError } from "../api/http-api-error.js";
import type { ChatEntry } from "../chat/chat-types.js";
import type { DashboardControlActionSupport } from "../session-agents/dashboard-control-actions.js";
import {
  RuntimeConversationNavigatorPanel,
  RuntimeConversationNavigatorSheet,
} from "../session-agents/runtime-conversations/runtime-conversation-navigator.js";
import { SessionHeaderTitle } from "../sessions/session-header-title.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { ConversationWorkspaceFrame } from "../shared/conversation-workspace-frame.js";
import { PageFrame } from "../shared/page-frame.js";
import { UnavailableResourceState } from "../shared/unavailable-resource-state.js";
import { useDocumentTitle } from "../shared/use-document-title.js";
import { SandboxOperationProgress } from "./sandbox-operation-progress.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";
import type { SessionComposerBootstrapPhase } from "./session-composer/session-composer-runtime-contracts.js";
import {
  SessionConversationBottomPanelController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import type {
  PendingSessionDiffComment,
  PendingSessionDiffCommentInput,
} from "./session-diff-comment.js";
import { reconcilePendingSessionDiffComments } from "./session-diff-comment.js";
import { parseSessionDiffPatch } from "./session-diff-panel-model.js";
import { SessionDiffPanel } from "./session-diff-panel.js";
import { SessionPortAccessPopover, SessionPortAccessSheet } from "./session-port-access-popover.js";
import { filterUnmatchedSessionServerRequests } from "./session-server-request-filter.js";
import { SessionStartupStatus, type SessionStartupState } from "./session-startup-status.js";
import type {
  SessionTerminalContentInset,
  SessionTerminalThemeMode,
} from "./session-terminal-surface.js";
import {
  SessionTerminalWorkspace,
  type SessionTerminalWorkspaceHandle,
} from "./session-terminal-workspace.js";
import { SessionWorkbenchHeaderActions } from "./session-workbench-header-actions.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";
import { SessionRepositoryNoneValue } from "./use-session-primary-repository-state.js";
import { useSessionWorkbenchController } from "./use-session-workbench-controller.js";
import type { SessionWorkbenchSandboxStatusReader } from "./use-session-workbench-lifecycle-state.js";
import { useSessionWorkbenchRuntimeConversationNavigation } from "./use-session-workbench-runtime-conversation-navigation.js";
import type { SessionWorkbenchConnectionTokenMinter } from "./use-session-workbench-transport.js";

type SessionWorkbenchFullPageSecondaryPanel =
  | {
      kind: "diff";
    }
  | {
      kind: "custom";
      diffControlTitle: string;
      layoutKey: string;
      minSize: string;
      renderPanel: () => React.ReactNode;
    };

export type SessionWorkbenchFullPageProps = {
  documentTitleFallback: string;
  frameTitle: string;
  headerControls?: {
    cli?: boolean;
    diff?: boolean;
    portAccess?: boolean;
    repository?: boolean;
  };
  leadingControl: React.ReactNode;
  requestedRuntimeConversationId: string | null;
  sandboxInstanceId: string | null;
  mintConnectionToken?: SessionWorkbenchConnectionTokenMinter;
  sandboxStatusReader?: SessionWorkbenchSandboxStatusReader;
  searchParams: URLSearchParams;
  secondaryPanel: SessionWorkbenchFullPageSecondaryPanel;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  dashboardControlActions?: DashboardControlActionSupport;
  autoStartTurn?: {
    key: string;
    prompt: string;
  };
};

type SessionWorkbenchActiveTurnState = ReturnType<
  typeof useSessionWorkbenchController
>["conversationPane"]["composerStateInput"]["turnControl"]["activeTurnState"];

type SessionWorkbenchPrimaryPanelTransitionState = ReturnType<
  typeof useSessionWorkbenchController
>["workbench"]["primaryPanelState"]["transitionState"];

export function shouldAutoStartWorkbenchTurn(input: {
  activeConversationId: string | null;
  activeTurnState: SessionWorkbenchActiveTurnState;
  autoStartTurn: SessionWorkbenchFullPageProps["autoStartTurn"] | undefined;
  chatEntries: readonly ChatEntry[];
  initialEntryStartupState: SessionStartupState | null;
  isInitialConversationHydrated: boolean;
  isStartingTurn: boolean;
  startedTurnKeys: ReadonlySet<string>;
  transitionState: SessionWorkbenchPrimaryPanelTransitionState;
}): boolean {
  if (input.autoStartTurn === undefined) {
    return false;
  }

  const autoStartTurn = input.autoStartTurn;

  if (input.startedTurnKeys.has(autoStartTurn.key)) {
    return false;
  }

  if (
    input.activeConversationId === null ||
    input.transitionState !== "stable_chat" ||
    !input.isInitialConversationHydrated ||
    input.initialEntryStartupState !== null ||
    input.activeTurnState !== "idle" ||
    input.isStartingTurn
  ) {
    return false;
  }

  return !input.chatEntries.some(
    (entry) => entry.kind === "user-message" && entry.text === autoStartTurn.prompt,
  );
}

export function resolveSessionEntryPreparationState(input: {
  activeConversationId: string | null;
  activeTurnState: SessionWorkbenchActiveTurnState;
  autoStartTurn: SessionWorkbenchFullPageProps["autoStartTurn"] | undefined;
  autoStartedTurnKeys: ReadonlySet<string>;
  bootstrapPhaseStatus: SessionComposerBootstrapPhase["status"];
  chatEntries: readonly ChatEntry[];
  isInitialConversationHydrated: boolean;
  startupState: SessionStartupState | null;
  transitionState: SessionWorkbenchPrimaryPanelTransitionState;
}): SessionStartupState | null {
  if (input.startupState !== null) {
    return input.startupState;
  }

  if (input.transitionState !== "stable_chat") {
    return null;
  }

  if (input.activeConversationId === null) {
    return "preparing_conversation";
  }

  if (!input.isInitialConversationHydrated) {
    return "loading_conversation";
  }

  if (
    input.bootstrapPhaseStatus === "unavailable" ||
    input.bootstrapPhaseStatus === "bootstrapping"
  ) {
    return "preparing_conversation";
  }

  if (input.bootstrapPhaseStatus === "failed") {
    return null;
  }

  const autoStartTurn = input.autoStartTurn;
  if (autoStartTurn === undefined) {
    return null;
  }

  if (
    input.autoStartedTurnKeys.has(autoStartTurn.key) ||
    input.activeTurnState === "running" ||
    input.chatEntries.some(
      (entry) => entry.kind === "user-message" && entry.text === autoStartTurn.prompt,
    )
  ) {
    return null;
  }

  return "starting_first_turn";
}

export function SessionWorkbenchFullPage(input: SessionWorkbenchFullPageProps): React.JSX.Element {
  const { conversationPane, workbench } = useSessionWorkbenchController({
    requestedRuntimeConversationId: input.requestedRuntimeConversationId,
    sandboxInstanceId: input.sandboxInstanceId,
    ...(input.dashboardControlActions === undefined
      ? {}
      : { dashboardControlActions: input.dashboardControlActions }),
    ...(input.mintConnectionToken === undefined
      ? {}
      : { mintConnectionToken: input.mintConnectionToken }),
    ...(input.sandboxStatusReader === undefined
      ? {}
      : { sandboxStatusReader: input.sandboxStatusReader }),
  });
  const [hasEnteredReadyConversation, setHasEnteredReadyConversation] = useState(false);
  const conversationScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previousActiveConversationIdRef = useRef<string | null>(null);
  const [composerDraft, setComposerDraft] = useState(createComposerDraft(""));
  const [isMobileConversationNavigatorOpen, setMobileConversationNavigatorOpen] = useState(false);
  const isMobileSecondaryPanelLayout = useIsBelowBreakpoint(CssBreakpointVariables.SM);
  const [autoStartedTurnKeys, setAutoStartedTurnKeys] = useState<ReadonlySet<string>>(new Set());
  const autoStartedTurnKeysRef = useRef(new Set<string>());
  const autoStartingTurnKeysRef = useRef(new Set<string>());
  const [pendingDiffComments, setPendingDiffComments] = useState<
    readonly PendingSessionDiffComment[]
  >([]);
  const handleAddPendingDiffComment = useCallback(
    (comment: PendingSessionDiffCommentInput): void => {
      setPendingDiffComments((currentComments) => [
        ...currentComments,
        {
          ...comment,
          id: crypto.randomUUID(),
          status: comment.status ?? {
            kind: "current",
          },
        },
      ]);
    },
    [],
  );
  const handleClearPendingDiffComments = useCallback((): void => {
    setPendingDiffComments([]);
  }, []);
  const handleUpdatePendingDiffComment = useCallback((commentId: string, body: string): void => {
    setPendingDiffComments((currentComments) =>
      currentComments.map((comment) =>
        comment.id !== commentId
          ? comment
          : {
              ...comment,
              body,
            },
      ),
    );
  }, []);
  const handleRemovePendingDiffComment = useCallback((commentId: string): void => {
    setPendingDiffComments((currentComments) =>
      currentComments.filter((comment) => comment.id !== commentId),
    );
  }, []);
  const terminalWorkspaceRef = useRef<SessionTerminalWorkspaceHandle | null>(null);
  const isTerminalOpenDisabled =
    !workbench.terminalPanelState.isVisible && !workbench.connectionReadiness.canConnect;
  const terminalButtonLabel = workbench.terminalPanelState.isVisible ? "Terminal" : "Open terminal";
  const terminalButtonTitle = isTerminalOpenDisabled
    ? (workbench.stoppedSessionMessage ?? "Terminal is available only when the sandbox is running.")
    : terminalButtonLabel;
  const isDiffOpenDisabled =
    input.secondaryPanel.kind === "diff" &&
    !workbench.diffPanelState.isVisible &&
    !workbench.connectionReadiness.canConnect;
  const diffButtonTitle =
    input.secondaryPanel.kind === "custom"
      ? input.secondaryPanel.diffControlTitle
      : isDiffOpenDisabled
        ? (workbench.stoppedSessionMessage ??
          "Changes are available only when the sandbox is running.")
        : workbench.diffPanelState.isVisible
          ? "Changes"
          : "Open changes";
  const cliButtonLabel = "TUI";
  const cliRuntimeDisplayName = workbench.primaryPanelState.cliRuntimeDisplayName;
  const cliButtonTitle = workbench.primaryPanelState.isCliToggleActive
    ? "Return to chat"
    : (workbench.primaryPanelState.disabledReason ?? `Open ${cliRuntimeDisplayName} TUI`);
  const headerControls = input.headerControls;
  const shouldShowCliControl = headerControls?.cli ?? true;
  const shouldShowDiffControl = headerControls?.diff ?? true;
  const shouldShowPortAccessControl = headerControls?.portAccess ?? true;
  const shouldShowRepositoryControl = headerControls?.repository ?? true;
  const headerStatusKind = workbench.workbenchStatus.kind;
  const headerStatusUi = resolveSandboxStatusBadgeUi(workbench.sandboxLifecycleStatus);
  const headerStatusLabel = headerStatusKind === "error" ? "Error" : headerStatusUi.label;
  const primaryRepositoryErrorMessage =
    workbench.primaryRepositoryState.errorMessage ??
    workbench.primaryRepositoryControlState.disabledReason;
  const primaryRepositoryPath = workbench.primaryRepositoryState.selectedRepositoryPath;
  const conversationNavigation = useSessionWorkbenchRuntimeConversationNavigation({
    runtimeConversationNavigator: conversationPane.runtimeConversationNavigator,
    closeDiffPanel: workbench.diffPanelState.closePanel,
    isDiffPanelVisible:
      input.secondaryPanel.kind === "diff" ? workbench.diffPanelState.isVisible : false,
    isSecondaryPanelLayoutAvailable: !isMobileSecondaryPanelLayout,
    pendingServerRequests: conversationPane.serverRequestsState.pendingServerRequests,
    primaryPanelTransitionState: workbench.primaryPanelState.transitionState,
    primaryRepositoryPath,
    requestedRuntimeConversationId: input.requestedRuntimeConversationId,
    sandboxInstanceId: input.sandboxInstanceId,
    searchParams: input.searchParams,
    setSearchParams: input.setSearchParams,
  });
  const closeConversationNavigatorPanel = conversationNavigation.closePanel;
  const isDiffPanelActive =
    input.secondaryPanel.kind === "diff" && conversationNavigation.isDiffPanelActive;
  const isConversationNavigatorPanelVisible = conversationNavigation.isPanelVisible;
  const toggleConversationNavigatorPanel = conversationNavigation.togglePanel;
  const headerActions = useMemo(
    () => (
      <SessionWorkbenchHeaderActions
        {...(!shouldShowCliControl
          ? {}
          : {
              cliControl: {
                ariaLabel: cliButtonLabel,
                className: workbench.primaryPanelState.isCliToggleActive
                  ? "bg-muted text-foreground shadow-none hover:bg-muted/80"
                  : "bg-transparent text-foreground shadow-none hover:bg-muted/60",
                disabled:
                  !workbench.primaryPanelState.canEnterCli &&
                  !workbench.primaryPanelState.isCliToggleActive,
                onClick: () => {
                  if (workbench.primaryPanelState.isCliToggleActive) {
                    void workbench.primaryPanelState.exitCliMode();
                    return;
                  }

                  void workbench.primaryPanelState.enterCliMode();
                },
                pressed: workbench.primaryPanelState.isCliToggleActive,
                title: cliButtonTitle,
              },
            })}
        {...(!shouldShowDiffControl
          ? {}
          : {
              diffControl: {
                ariaLabel: isDiffPanelActive ? "Changes" : "Open changes",
                className: isDiffPanelActive
                  ? "bg-muted text-foreground shadow-none hover:bg-muted/80"
                  : "bg-transparent text-foreground shadow-none hover:bg-muted/60",
                disabled: input.secondaryPanel.kind === "custom" || isDiffOpenDisabled,
                onClick: () => {
                  if (input.secondaryPanel.kind === "custom") {
                    return;
                  }
                  closeConversationNavigatorPanel();
                  if (workbench.diffPanelState.isVisible) {
                    workbench.diffPanelState.closePanel();
                    return;
                  }

                  workbench.diffPanelState.openPanel();
                },
                pressed: isDiffPanelActive,
                title: diffButtonTitle,
              },
            })}
        {...(!shouldShowPortAccessControl
          ? {}
          : {
              mobilePortAccessControl: {
                disabled: workbench.portAccessState.buttonDisabledReason !== null,
                onOpen: () => {
                  workbench.portAccessState.setPanelOpen(true);
                },
                surface: <SessionPortAccessSheet state={workbench.portAccessState} />,
                title: workbench.portAccessState.buttonDisabledReason ?? "Show running processes",
              },
            })}
        {...(conversationNavigation.runtimeConversationNavigatorProps === null
          ? {}
          : {
              mobileConversationNavigatorControl: {
                disabled: false,
                onOpen: () => {
                  setMobileConversationNavigatorOpen(true);
                },
                surface: (
                  <RuntimeConversationNavigatorSheet
                    isOpen={isMobileConversationNavigatorOpen}
                    navigator={conversationNavigation.runtimeConversationNavigatorProps}
                    onOpenChange={setMobileConversationNavigatorOpen}
                  />
                ),
                title: "Show conversations",
              },
            })}
        {...(!shouldShowPortAccessControl
          ? {}
          : {
              portAccessControl: <SessionPortAccessPopover state={workbench.portAccessState} />,
            })}
        {...(!shouldShowRepositoryControl
          ? {}
          : {
              repositoryControl: {
                ariaLabel: "Primary repository",
                disabled:
                  !workbench.connectionReadiness.canConnect ||
                  (workbench.primaryRepositoryState.isInitialLoading &&
                    workbench.primaryRepositoryState.options.length === 1) ||
                  workbench.primaryRepositoryControlState.disabledReason !== null,
                ...(primaryRepositoryErrorMessage === null
                  ? {}
                  : { errorMessage: primaryRepositoryErrorMessage }),
                isRefreshing: workbench.primaryRepositoryState.isRefreshing,
                onOpenChange: (open) => {
                  if (!open) {
                    return;
                  }

                  void workbench.primaryRepositoryState.refreshRepositories();
                },
                onValueChange: (nextValue) => {
                  void workbench.primaryRepositoryControlState.switchPrimaryRepository(
                    nextValue === SessionRepositoryNoneValue ? null : nextValue,
                  );
                },
                options: workbench.primaryRepositoryState.options,
                selectedValue:
                  workbench.primaryRepositoryState.selectedRepositoryPath ??
                  SessionRepositoryNoneValue,
                title:
                  primaryRepositoryErrorMessage ??
                  (!workbench.connectionReadiness.canConnect
                    ? (workbench.stoppedSessionMessage ??
                      "Primary repository is available only when the sandbox is running.")
                    : workbench.primaryRepositoryState.isInitialLoading
                      ? "Loading repositories from the active sandbox."
                      : workbench.primaryRepositoryState.isRefreshing
                        ? "Refreshing repositories from the active sandbox."
                        : "Primary repository"),
              },
            })}
        status={
          headerStatusKind === "error"
            ? {
                kind: headerStatusKind,
                label: headerStatusLabel,
              }
            : {
                indicatorClassName: headerStatusUi.indicatorClassName,
                kind: headerStatusKind,
                label: headerStatusLabel,
              }
        }
        {...(conversationNavigation.runtimeConversationNavigatorProps !== null
          ? {
              conversationControl: {
                ariaLabel: "Show conversations",
                className: isConversationNavigatorPanelVisible
                  ? "bg-muted text-foreground shadow-none hover:bg-muted/80"
                  : "bg-transparent text-foreground shadow-none hover:bg-muted/60",
                disabled: false,
                onClick: toggleConversationNavigatorPanel,
                pressed: isConversationNavigatorPanelVisible,
                title: "Show conversations",
              },
            }
          : {})}
        terminalControl={{
          ariaLabel: terminalButtonLabel,
          className: workbench.terminalPanelState.isVisible
            ? "bg-muted text-foreground shadow-none hover:bg-muted/80"
            : "bg-transparent text-foreground shadow-none hover:bg-muted/60",
          disabled: isTerminalOpenDisabled,
          onClick: () => {
            if (workbench.terminalPanelState.isVisible) {
              workbench.terminalPanelState.closePanel();
              return;
            }

            workbench.terminalPanelState.openPanel();
            terminalWorkspaceRef.current?.ensureTerminalWorkspace();
          },
          pressed: workbench.terminalPanelState.isVisible,
          title: terminalButtonTitle,
        }}
      />
    ),
    [
      isTerminalOpenDisabled,
      isDiffOpenDisabled,
      cliButtonTitle,
      closeConversationNavigatorPanel,
      diffButtonTitle,
      headerStatusKind,
      headerStatusLabel,
      isDiffPanelActive,
      isConversationNavigatorPanelVisible,
      isMobileConversationNavigatorOpen,
      input.secondaryPanel,
      shouldShowCliControl,
      shouldShowDiffControl,
      shouldShowPortAccessControl,
      shouldShowRepositoryControl,
      toggleConversationNavigatorPanel,
      terminalButtonLabel,
      terminalButtonTitle,
      conversationNavigation.runtimeConversationNavigatorProps,
      workbench.connectionReadiness.canConnect,
      workbench.diffPanelState.closePanel,
      workbench.diffPanelState.isVisible,
      workbench.diffPanelState.openPanel,
      workbench.portAccessState,
      workbench.primaryRepositoryState.errorMessage,
      workbench.primaryRepositoryState.isInitialLoading,
      workbench.primaryRepositoryState.isRefreshing,
      workbench.primaryRepositoryState.options,
      workbench.primaryRepositoryState.refreshRepositories,
      workbench.primaryRepositoryState.selectedRepositoryPath,
      primaryRepositoryErrorMessage,
      workbench.primaryRepositoryControlState.switchPrimaryRepository,
      workbench.sandboxLifecycleStatus,
      workbench.primaryPanelState.canEnterCli,
      workbench.primaryPanelState.disabledReason,
      workbench.primaryPanelState.enterCliMode,
      workbench.primaryPanelState.exitCliMode,
      workbench.primaryPanelState.isCliToggleActive,
      workbench.primaryPanelState.transitionState,
      workbench.stoppedSessionMessage,
      workbench.terminalPanelState.closePanel,
      workbench.terminalPanelState.isVisible,
      workbench.terminalPanelState.openPanel,
    ],
  );
  const unmatchedServerRequests = filterUnmatchedSessionServerRequests({
    chatEntries: conversationPane.chatState.entries,
    pendingServerRequests: conversationPane.serverRequestsState.pendingServerRequests,
  });
  const terminalPanelKey = input.sandboxInstanceId ?? "missing-session";
  const diffPanelErrorNotice: React.ComponentProps<typeof SessionDiffPanel>["errorNotice"] =
    !workbench.connectionReadiness.canConnect
      ? {
          message:
            workbench.stoppedSessionMessage ??
            "Changes are available only when the sandbox is running.",
          title: "Could not load changes",
          variant: "alert",
        }
      : workbench.diffPanelState.errorNotice;
  const diffPanelPatch = workbench.connectionReadiness.canConnect
    ? workbench.diffPanelState.patch
    : "";
  const sessionDocumentTitle =
    workbench.sandboxStatusQuery.data === undefined
      ? input.documentTitleFallback
      : resolveSessionTitleLabel(workbench.sandboxStatusQuery.data.title);

  useDocumentTitle(sessionDocumentTitle);

  useEffect(() => {
    if (previousActiveConversationIdRef.current === conversationPane.activeConversationId) {
      return;
    }

    previousActiveConversationIdRef.current = conversationPane.activeConversationId;
    setComposerDraft(createComposerDraft(""));
    setPendingDiffComments([]);
  }, [conversationPane.activeConversationId]);

  useEffect(() => {
    if (input.secondaryPanel.kind !== "diff" || !workbench.connectionReadiness.canConnect) {
      return;
    }

    const parsedPatch = parseSessionDiffPatch(diffPanelPatch);
    setPendingDiffComments((currentComments) =>
      reconcilePendingSessionDiffComments({
        comments: currentComments,
        currentRepositoryPath: primaryRepositoryPath,
        fileDiffs: parsedPatch.kind === "parsed" ? parsedPatch.files : [],
      }),
    );
  }, [
    diffPanelPatch,
    input.secondaryPanel.kind,
    primaryRepositoryPath,
    workbench.connectionReadiness.canConnect,
  ]);

  const alert: SessionWorkbenchAlert | null = workbench.sandboxStatusQuery.isError
    ? {
        title: "Could not load sandbox status",
        description:
          workbench.sandboxStatusQuery.error instanceof Error
            ? workbench.sandboxStatusQuery.error.message
            : "Could not load sandbox status.",
      }
    : workbench.workbenchStatus.alert !== null
      ? workbench.workbenchStatus.alert
      : workbench.primaryPanelState.transitionState === "stable_chat" &&
          workbench.primaryPanelState.error !== null
        ? {
            title:
              workbench.primaryPanelState.error.kind === "chat_restore_failed"
                ? "Could not restore chat"
                : `Could not start ${cliRuntimeDisplayName} TUI`,
            description:
              workbench.primaryPanelState.error.message ??
              (workbench.primaryPanelState.error.kind === "chat_restore_failed"
                ? "Could not restore chat."
                : `Could not start ${cliRuntimeDisplayName} TUI.`),
          }
        : null;

  const activeConversationId = conversationPane.activeConversationId;
  const turnControl = conversationPane.composerStateInput.turnControl;
  const isConversationTurnRunning = turnControl.activeTurnState === "running";
  const initialConnectionStartupState =
    !hasEnteredReadyConversation && alert === null ? workbench.initialEntryStartupState : null;
  const entryPreparationState = resolveSessionEntryPreparationState({
    activeConversationId,
    activeTurnState: turnControl.activeTurnState,
    autoStartTurn: input.autoStartTurn,
    autoStartedTurnKeys,
    bootstrapPhaseStatus: conversationPane.composerStateInput.bootstrap.phase.status,
    chatEntries: conversationPane.chatState.entries,
    isInitialConversationHydrated: conversationPane.isInitialConversationHydrated,
    startupState: initialConnectionStartupState,
    transitionState: workbench.primaryPanelState.transitionState,
  });

  const hasReachedReadyConversation =
    entryPreparationState === null &&
    workbench.connectionReadiness.canConnect &&
    workbench.primaryPanelState.transitionState === "stable_chat";

  useEffect(() => {
    if (!hasReachedReadyConversation) {
      return;
    }

    // The sandbox/runtime lifecycle can transiently report startup states after
    // chat first becomes usable; keep the entry latch in an effect so render
    // stays pure while preserving composer and diff state across that transition.
    setHasEnteredReadyConversation(true);
  }, [hasReachedReadyConversation]);

  useEffect(() => {
    const autoStartTurn = input.autoStartTurn;
    if (autoStartTurn === undefined) {
      return;
    }

    if (
      !shouldAutoStartWorkbenchTurn({
        activeConversationId,
        activeTurnState: turnControl.activeTurnState,
        autoStartTurn,
        chatEntries: conversationPane.chatState.entries,
        initialEntryStartupState: initialConnectionStartupState,
        isInitialConversationHydrated: conversationPane.isInitialConversationHydrated,
        isStartingTurn: turnControl.isStarting,
        startedTurnKeys: new Set([
          ...autoStartedTurnKeysRef.current,
          ...autoStartingTurnKeysRef.current,
        ]),
        transitionState: workbench.primaryPanelState.transitionState,
      })
    ) {
      return;
    }

    autoStartingTurnKeysRef.current.add(autoStartTurn.key);
    void turnControl
      .startTurn({
        submittedPrompt: autoStartTurn.prompt,
        transcriptPrompt: autoStartTurn.prompt,
        resolveSkillMentions: false,
      })
      .then(() => {
        autoStartingTurnKeysRef.current.delete(autoStartTurn.key);
        autoStartedTurnKeysRef.current.add(autoStartTurn.key);
        setAutoStartedTurnKeys(new Set(autoStartedTurnKeysRef.current));
      })
      .catch(() => {
        autoStartingTurnKeysRef.current.delete(autoStartTurn.key);
      });
  }, [
    activeConversationId,
    conversationPane.chatState.entries,
    conversationPane.isInitialConversationHydrated,
    initialConnectionStartupState,
    input.autoStartTurn,
    turnControl.activeTurnState,
    turnControl.isStarting,
    turnControl.startTurn,
    workbench.primaryPanelState.transitionState,
  ]);

  if (isUnavailableResourceError(workbench.sandboxStatusQuery.error)) {
    return (
      <ConversationWorkspaceFrame title={input.frameTitle} leadingControl={input.leadingControl}>
        <PageFrame width="normal">
          <UnavailableResourceState />
        </PageFrame>
      </ConversationWorkspaceFrame>
    );
  }

  if (input.sandboxInstanceId === null) {
    return (
      <ConversationWorkspaceFrame
        title={input.frameTitle}
        actions={headerActions}
        leadingControl={input.leadingControl}
      >
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<></>}
          isBottomPanelVisible={false}
          isSecondaryPanelVisible={false}
          primaryBottomPanel={<></>}
          secondaryPanel={<></>}
          mainContent={<></>}
          mainContentScrollContainerRef={conversationScrollContainerRef}
          sandboxInstanceId={null}
        />
      </ConversationWorkspaceFrame>
    );
  }

  return (
    <ConversationWorkspaceFrame
      title={<SessionHeaderTitle sandboxInstanceId={input.sandboxInstanceId} />}
      actions={headerActions}
      leadingControl={input.leadingControl}
    >
      <SessionWorkbenchPageView
        alert={alert}
        isPrimaryPanelTransitioning={
          workbench.primaryPanelState.transitionState === "switching_to_cli" ||
          workbench.primaryPanelState.transitionState === "restoring_chat"
        }
        bottomPanel={
          <SessionTerminalWorkspace
            key={terminalPanelKey}
            cwd={workbench.terminalCwd}
            ensureTransportConnected={workbench.ensureTransportConnected}
            isConnectionReady={workbench.connectionReadiness.canConnect}
            isVisible={workbench.terminalPanelState.isVisible}
            onTerminalReset={workbench.handleTerminalWorkspaceReset}
            onWorkspaceEmpty={() => {
              workbench.terminalPanelState.closePanel();
            }}
            ref={terminalWorkspaceRef}
            sandboxStatus={workbench.sandboxLifecycleStatus}
            sandboxInstanceId={input.sandboxInstanceId}
          />
        }
        isBottomPanelVisible={workbench.terminalPanelState.isVisible}
        isSecondaryPanelVisible={
          input.secondaryPanel.kind === "custom" ||
          conversationNavigation.secondaryPanelKind !== null
        }
        {...(conversationNavigation.secondaryPanelKind === "conversations"
          ? { secondaryPanelDefaultSize: "20%" }
          : {})}
        secondaryPanelLayoutKey={
          input.secondaryPanel.kind === "custom" ? input.secondaryPanel.layoutKey : "right-panel"
        }
        secondaryPanelMinSize={
          input.secondaryPanel.kind === "custom" ? input.secondaryPanel.minSize : "16rem"
        }
        mainContentLayout={
          workbench.primaryPanelState.transitionState === "stable_cli" ||
          entryPreparationState !== null
            ? { scroll: "contained", width: "full" }
            : { scroll: "page", width: "chat" }
        }
        mainContent={renderPrimaryPanelMainContent({
          conversation: {
            activeTurnId: conversationPane.chatState.activeTurnId,
            isTurnInProgress: isConversationTurnRunning,
            pendingTurnId: conversationPane.chatState.pendingTurnId,
            autoScrollToBottomOnInitialLoad: true,
            initialBottomScrollResetKey: resolveConversationScopedComposerRenderKey({
              activeConversationId: conversationPane.activeConversationId,
              requestedRuntimeConversationId: input.requestedRuntimeConversationId,
              sandboxInstanceId: input.sandboxInstanceId,
              triggerConversation: workbench.sandboxStatusQuery.data?.triggerConversation ?? null,
            }),
            scrollBehavior: "follow-streaming-at-bottom",
            chatEntries: conversationPane.chatState.entries,
            onUserMessageAction: conversationPane.dismissUserMessageAction,
            isRespondingToServerRequest:
              conversationPane.serverRequestsState.isRespondingToServerRequest,
            onRespondToServerRequest: conversationPane.serverRequestsState.respondToServerRequest,
            scrollContainerRef: conversationScrollContainerRef,
            serverRequestPanelEntries: unmatchedServerRequests,
          },
          cli: {
            ptyState: workbench.cliPtyState,
            refitKey: workbench.terminalPanelState.isVisible
              ? "cli:terminal-open"
              : "cli:terminal-closed",
            terminalContentInset: workbench.primaryPanelState.cliTerminalContentInset,
            terminalThemeMode: workbench.primaryPanelState.cliTerminalThemeMode,
          },
          entryPreparationState,
          sandboxInstanceId: input.sandboxInstanceId,
          startupOperation: workbench.sandboxStatusQuery.data?.startupOperation ?? null,
          transitionState: workbench.primaryPanelState.transitionState,
        })}
        mainContentScrollContainerRef={conversationScrollContainerRef}
        primaryBottomPanel={
          workbench.primaryPanelState.showsChatComposer && entryPreparationState === null ? (
            <SessionConversationBottomPanelController
              chatEntries={conversationPane.chatState.entries}
              composerStateInput={conversationPane.composerStateInput}
              draftState={{
                composerDraft,
                pendingDiffComments,
                clearPendingDiffComments: handleClearPendingDiffComments,
                setComposerDraft,
              }}
              isRespondingToServerRequest={
                conversationPane.serverRequestsState.isRespondingToServerRequest
              }
              onRespondToServerRequest={conversationPane.serverRequestsState.respondToServerRequest}
              key={input.sandboxInstanceId ?? "missing-session"}
              serverRequestPanelEntries={unmatchedServerRequests}
              showWorkingIndicator={isConversationTurnRunning}
            />
          ) : null
        }
        secondaryPanel={
          conversationNavigation.secondaryPanelKind === "conversations" &&
          conversationNavigation.runtimeConversationNavigatorProps !== null ? (
            <RuntimeConversationNavigatorPanel
              {...conversationNavigation.runtimeConversationNavigatorProps}
            />
          ) : input.secondaryPanel.kind === "custom" ? (
            input.secondaryPanel.renderPanel()
          ) : (
            <SessionDiffPanel
              errorNotice={diffPanelErrorNotice}
              isLoading={
                workbench.connectionReadiness.canConnect && workbench.diffPanelState.isLoading
              }
              onAddComment={handleAddPendingDiffComment}
              onDeleteComment={handleRemovePendingDiffComment}
              onUpdateComment={handleUpdatePendingDiffComment}
              pendingComments={pendingDiffComments}
              patch={diffPanelPatch}
              repositoryPath={primaryRepositoryPath}
              summaryLabel={workbench.diffPanelState.compareLabel}
              title="Current changes"
            />
          )
        }
        sandboxInstanceId={input.sandboxInstanceId}
      />
    </ConversationWorkspaceFrame>
  );
}

export function resolveConversationScopedComposerRenderKey(input: {
  activeConversationId: string | null;
  requestedRuntimeConversationId: string | null;
  sandboxInstanceId: string | null;
  triggerConversation: { providerConversationId: string | null } | null;
}): string {
  const conversationScopeId =
    input.requestedRuntimeConversationId ??
    input.activeConversationId ??
    input.triggerConversation?.providerConversationId ??
    "no-thread";

  return [input.sandboxInstanceId ?? "missing-session", conversationScopeId].join(":");
}

type PrimaryPanelConversationContent = Pick<
  React.ComponentProps<typeof SessionConversationMainContent>,
  | "activeTurnId"
  | "isTurnInProgress"
  | "pendingTurnId"
  | "autoScrollToBottomOnInitialLoad"
  | "initialBottomScrollResetKey"
  | "scrollBehavior"
  | "chatEntries"
  | "onUserMessageAction"
  | "isRespondingToServerRequest"
  | "onRespondToServerRequest"
  | "scrollContainerRef"
  | "serverRequestPanelEntries"
>;

type PrimaryPanelCliContent = {
  ptyState: React.ComponentProps<typeof SessionCliPanel>["ptyState"];
  refitKey?: string;
  terminalContentInset: SessionTerminalContentInset;
  terminalThemeMode: SessionTerminalThemeMode;
};

function renderPrimaryPanelMainContent(input: {
  cli: PrimaryPanelCliContent;
  conversation: PrimaryPanelConversationContent;
  entryPreparationState: SessionStartupState | null;
  sandboxInstanceId: string | null;
  startupOperation:
    | NonNullable<
        ReturnType<typeof useSessionWorkbenchController>["workbench"]["sandboxStatusQuery"]["data"]
      >["startupOperation"]
    | null;
  transitionState: ReturnType<
    typeof useSessionWorkbenchController
  >["workbench"]["primaryPanelState"]["transitionState"];
}): React.JSX.Element {
  if (input.entryPreparationState !== null) {
    const showSandboxOperationProgress =
      input.startupOperation?.operationId !== undefined &&
      input.entryPreparationState !== "preparing_conversation" &&
      input.entryPreparationState !== "loading_conversation" &&
      input.entryPreparationState !== "starting_first_turn";

    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-4 px-4 py-6">
        <SessionStartupStatus state={input.entryPreparationState} />
        {showSandboxOperationProgress ? (
          <SandboxOperationProgress
            displayMode="timeline"
            emptyMessage="Waiting for session startup events."
            hideWhenEmpty
            operationId={input.startupOperation?.operationId ?? null}
            sandboxInstanceId={input.sandboxInstanceId}
            showBorder
            showLoadError={false}
          />
        ) : null}
      </div>
    );
  }

  switch (input.transitionState) {
    case "switching_to_cli":
    case "restoring_chat":
      return <></>;
    case "stable_cli":
      return (
        <SessionCliPanel
          ptyState={input.cli.ptyState}
          terminalContentInset={input.cli.terminalContentInset}
          terminalThemeMode={input.cli.terminalThemeMode}
          {...(input.cli.refitKey === undefined ? {} : { refitKey: input.cli.refitKey })}
        />
      );
    case "stable_chat":
      return <SessionConversationMainContent {...input.conversation} />;
  }
}
