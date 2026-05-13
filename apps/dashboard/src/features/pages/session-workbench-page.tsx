import { SidebarTrigger, useSidebar } from "@mistle/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";

import type { ChatComposerViewModel } from "../chat/components/chat-composer.js";
import { SessionHeaderTitle } from "../sessions/session-header-title.js";
import { ConversationWorkspaceFrame } from "../shared/conversation-workspace-frame.js";
import { shouldRenderSidebarTrigger } from "../shared/sidebar-trigger-visibility.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  SessionConversationBottomPanel,
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
import { SessionStartupStatus } from "./session-startup-status.js";
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

export function SessionWorkbenchPage(): React.JSX.Element {
  const location = useLocation();
  const params = useParams();
  const sandboxInstanceId = params["sandboxInstanceId"] ?? null;

  return <SessionWorkbenchPageContent key={location.key} sandboxInstanceId={sandboxInstanceId} />;
}

function SessionWorkbenchPageContent(input: {
  sandboxInstanceId: string | null;
}): React.JSX.Element {
  const { conversationPane, workbench } = useSessionWorkbenchController({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const [hasEnteredReadyWorkbench, setHasEnteredReadyWorkbench] = useState(false);
  const conversationScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [composerText, setComposerText] = useState("");
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
    !workbench.diffPanelState.isVisible && !workbench.connectionReadiness.canConnect;
  const diffButtonLabel = workbench.diffPanelState.isVisible ? "Changes" : "Open changes";
  const diffButtonTitle = isDiffOpenDisabled
    ? (workbench.stoppedSessionMessage ?? "Changes are available only when the sandbox is running.")
    : diffButtonLabel;
  const cliButtonLabel = "TUI";
  const cliRuntimeDisplayName = workbench.primaryPanelState.cliRuntimeDisplayName;
  const cliButtonTitle = workbench.primaryPanelState.isCliToggleActive
    ? "Return to chat"
    : (workbench.primaryPanelState.disabledReason ?? `Open ${cliRuntimeDisplayName} TUI`);
  const headerStatusKind = workbench.workbenchStatus.kind;
  const headerStatusLabel =
    headerStatusKind === "error"
      ? "Error"
      : resolveSandboxStatusBadgeUi(workbench.sandboxLifecycleStatus).label;
  const primaryRepositoryErrorMessage =
    workbench.primaryRepositoryState.errorMessage ??
    workbench.primaryRepositoryControlState.disabledReason;
  const headerActions = useMemo(
    () => (
      <SessionWorkbenchHeaderActions
        cliControl={{
          ariaLabel: cliButtonLabel,
          className: workbench.primaryPanelState.isCliToggleActive
            ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
            : "bg-transparent text-foreground shadow-none hover:bg-stone-100",
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
        }}
        diffControl={{
          ariaLabel: diffButtonLabel,
          className: workbench.diffPanelState.isVisible
            ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
            : "bg-transparent text-foreground shadow-none hover:bg-stone-100",
          disabled: isDiffOpenDisabled,
          onClick: () => {
            workbench.diffPanelState.togglePanel();
          },
          pressed: workbench.diffPanelState.isVisible,
          title: diffButtonTitle,
        }}
        mobilePortAccessControl={{
          disabled: workbench.portAccessState.buttonDisabledReason !== null,
          onOpen: () => {
            workbench.portAccessState.setPanelOpen(true);
          },
          surface: <SessionPortAccessSheet state={workbench.portAccessState} />,
          title: workbench.portAccessState.buttonDisabledReason ?? "Show running processes",
        }}
        portAccessControl={<SessionPortAccessPopover state={workbench.portAccessState} />}
        repositoryControl={{
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
            workbench.primaryRepositoryState.selectedRepositoryPath ?? SessionRepositoryNoneValue,
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
        }}
        status={{
          kind: headerStatusKind,
          label: headerStatusLabel,
        }}
        terminalControl={{
          ariaLabel: terminalButtonLabel,
          className: workbench.terminalPanelState.isVisible
            ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
            : "bg-transparent text-foreground shadow-none hover:bg-stone-100",
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
      diffButtonLabel,
      diffButtonTitle,
      headerStatusKind,
      headerStatusLabel,
      terminalButtonLabel,
      terminalButtonTitle,
      workbench.connectionReadiness.canConnect,
      workbench.diffPanelState.isVisible,
      workbench.diffPanelState.togglePanel,
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
      workbench.stoppedSessionMessage,
      workbench.terminalPanelState.closePanel,
      workbench.terminalPanelState.isVisible,
      workbench.terminalPanelState.openPanel,
    ],
  );
  const chatItemIds = new Set(
    conversationPane.chatState.entries.flatMap((entry) => {
      if (entry.kind === "semantic-group") {
        return entry.items.map((item) => item.id);
      }

      if (entry.kind === "command-execution" || entry.kind === "file-change") {
        return [entry.id];
      }

      return [];
    }),
  );
  const unmatchedServerRequests = conversationPane.serverRequestsState.pendingServerRequests.filter(
    (entry) => {
      if (entry.kind !== "command-approval" && entry.kind !== "file-change-approval") {
        return true;
      }

      return !chatItemIds.has(entry.itemId);
    },
  );
  const terminalPanelKey = input.sandboxInstanceId ?? "missing-session";
  const diffPanelErrorNotice = !workbench.connectionReadiness.canConnect
    ? {
        message:
          workbench.stoppedSessionMessage ??
          "Changes are available only when the sandbox is running.",
        title: "Could not load changes",
        variant: "alert" as const,
      }
    : workbench.diffPanelState.errorNotice;
  const diffPanelPatch = workbench.connectionReadiness.canConnect
    ? workbench.diffPanelState.patch
    : "";
  const primaryRepositoryPath = workbench.primaryRepositoryState.selectedRepositoryPath;

  useEffect(() => {
    if (!workbench.connectionReadiness.canConnect) {
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
  }, [diffPanelPatch, primaryRepositoryPath, workbench.connectionReadiness.canConnect]);

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
  useEffect(() => {
    if (
      workbench.connectionReadiness.canConnect &&
      workbench.primaryPanelState.transitionState === "stable_chat"
    ) {
      setHasEnteredReadyWorkbench(true);
    }
  }, [workbench.connectionReadiness.canConnect, workbench.primaryPanelState.transitionState]);
  const initialEntryStartupState =
    !hasEnteredReadyWorkbench && alert === null ? workbench.initialEntryStartupState : null;
  if (input.sandboxInstanceId === null) {
    return (
      <ConversationWorkspaceFrame
        title="Session"
        actions={headerActions}
        leadingControl={<SessionWorkspaceSidebarTrigger />}
      >
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<></>}
          isBottomPanelVisible={false}
          isSecondaryPanelVisible={false}
          primaryBottomPanel={
            <SessionConversationBottomPanel
              chatEntries={[]}
              composerViewModel={createEmptyComposerViewModel()}
              isRespondingToServerRequest={false}
              onRespondToServerRequest={function onRespondToServerRequest() {}}
              serverRequestPanelEntries={[]}
              statusMessage={null}
            />
          }
          secondaryPanel={<></>}
          mainContent={
            <SessionConversationMainContent
              activeTurnId={null}
              isTurnInProgress={false}
              pendingTurnId={null}
              scrollBehavior="follow-streaming-at-bottom"
              chatEntries={[]}
              isRespondingToServerRequest={false}
              onRespondToServerRequest={function onRespondToServerRequest() {}}
              scrollContainerRef={conversationScrollContainerRef}
              serverRequestPanelEntries={[]}
            />
          }
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
      leadingControl={<SessionWorkspaceSidebarTrigger />}
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
        isSecondaryPanelVisible={workbench.diffPanelState.isVisible}
        mainContentLayout={
          workbench.primaryPanelState.transitionState === "stable_cli" ||
          initialEntryStartupState !== null
            ? { scroll: "contained", width: "full" }
            : { scroll: "page", width: "chat" }
        }
        mainContent={renderPrimaryPanelMainContent({
          conversation: {
            activeTurnId: conversationPane.chatState.activeTurnId,
            isTurnInProgress: conversationPane.chatState.status === "inProgress",
            pendingTurnId: conversationPane.chatState.pendingTurnId,
            autoScrollToBottomOnInitialLoad: true,
            initialBottomScrollResetKey: [
              input.sandboxInstanceId,
              conversationPane.activeThreadId ?? "no-thread",
            ].join(":"),
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
          initialEntryStartupState,
          transitionState: workbench.primaryPanelState.transitionState,
        })}
        mainContentScrollContainerRef={conversationScrollContainerRef}
        primaryBottomPanel={
          workbench.primaryPanelState.showsChatComposer && initialEntryStartupState === null ? (
            <SessionConversationBottomPanelController
              chatEntries={conversationPane.chatState.entries}
              composerStateInput={conversationPane.composerStateInput}
              draftState={{
                composerText,
                pendingDiffComments,
                clearPendingDiffComments: handleClearPendingDiffComments,
                setComposerText,
              }}
              isRespondingToServerRequest={
                conversationPane.serverRequestsState.isRespondingToServerRequest
              }
              onRespondToServerRequest={conversationPane.serverRequestsState.respondToServerRequest}
              key={input.sandboxInstanceId ?? "missing-session"}
              serverRequestPanelEntries={unmatchedServerRequests}
              showWorkingIndicator={
                conversationPane.chatState.activeTurnId !== null &&
                conversationPane.chatState.status === "inProgress"
              }
            />
          ) : null
        }
        secondaryPanel={
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
        }
        sandboxInstanceId={input.sandboxInstanceId}
      />
    </ConversationWorkspaceFrame>
  );
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
  initialEntryStartupState: ReturnType<
    typeof useSessionWorkbenchController
  >["workbench"]["initialEntryStartupState"];
  transitionState: ReturnType<
    typeof useSessionWorkbenchController
  >["workbench"]["primaryPanelState"]["transitionState"];
}): React.JSX.Element {
  if (input.initialEntryStartupState !== null) {
    return (
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center px-4 py-6">
        <SessionStartupStatus state={input.initialEntryStartupState} />
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

function SessionWorkspaceSidebarTrigger(): React.JSX.Element | null {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldShowSidebarTrigger = shouldRenderSidebarTrigger({
    isMobile,
    openMobile,
    sidebarState: state,
  });

  return shouldShowSidebarTrigger ? <SidebarTrigger className="-ml-1" /> : null;
}

function createEmptyComposerViewModel(): ChatComposerViewModel {
  return {
    composerText: "",
    gitBranchLabel: null,
    pullRequest: null,
    contextUsage: null,
    pendingDiffCommentSummary: null,
    isSubmitPending: false,
    pendingAttachments: [],
    modelOptions: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    submitMode: "start",
    submitLabel: "Send",
    submitDisabled: true,
    submitDisabledReason: null,
    keyboardShortcuts: [],
    secondarySubmitDisabled: true,
    canUploadAttachments: false,
    isUploadingAttachments: false,
    configControlsDisabled: true,
    onComposerTextChange: function onComposerTextChange() {},
    onSubmit: function onSubmit() {},
    onSecondarySubmit: function onSecondarySubmit() {},
    onModelChange: function onModelChange() {},
    onReasoningEffortChange: function onReasoningEffortChange() {},
    onPendingFilesAdded: function onPendingFilesAdded() {},
    onClearPendingDiffComments: function onClearPendingDiffComments() {},
    onRemovePendingAttachment: function onRemovePendingAttachment() {},
  };
}
