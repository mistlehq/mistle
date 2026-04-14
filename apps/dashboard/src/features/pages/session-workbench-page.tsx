import { useMemo, useRef } from "react";
import { useLocation, useParams } from "react-router";

import type { ChatComposerViewModel } from "../chat/components/chat-composer.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  SessionConversationBottomPanel,
  SessionConversationBottomPanelController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionDiffPanel } from "./session-diff-panel.js";
import { SessionPortAccessPopover } from "./session-port-access-popover.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";
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
  const conversationScrollContainerRef = useRef<HTMLDivElement | null>(null);
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
  const cliButtonTitle = workbench.primaryPanelState.isCliToggleActive
    ? "Return to chat"
    : (workbench.primaryPanelState.disabledReason ?? "Open Codex TUI");
  const headerStatusKind = workbench.workbenchStatus.kind;
  const headerStatusLabel =
    headerStatusKind === "error"
      ? "Error"
      : resolveSandboxStatusBadgeUi(workbench.sandboxLifecycleStatus).label;
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
        extraActions={<SessionPortAccessPopover state={workbench.portAccessState} />}
        repositoryControl={{
          ariaLabel: "Primary repository",
          disabled:
            !workbench.connectionReadiness.canConnect ||
            (workbench.primaryRepositoryState.isInitialLoading &&
              workbench.primaryRepositoryState.options.length === 1) ||
            workbench.primaryRepositoryControlState.isSwitching ||
            workbench.primaryRepositoryControlState.disabledReason !== null,
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
            workbench.primaryRepositoryState.errorMessage ??
            workbench.primaryRepositoryControlState.disabledReason ??
            (!workbench.connectionReadiness.canConnect
              ? (workbench.stoppedSessionMessage ??
                "Primary repository is available only when the sandbox is running.")
              : workbench.primaryRepositoryControlState.isSwitching
                ? "Switching the active chat thread for the selected repository."
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
              void workbench.ptyState.actions.disconnectPty();
              return;
            }

            workbench.terminalPanelState.openPanel();
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
      workbench.primaryRepositoryControlState.disabledReason,
      workbench.primaryRepositoryControlState.isSwitching,
      workbench.primaryRepositoryControlState.switchPrimaryRepository,
      workbench.sandboxLifecycleStatus,
      workbench.primaryPanelState.canEnterCli,
      workbench.primaryPanelState.disabledReason,
      workbench.primaryPanelState.enterCliMode,
      workbench.primaryPanelState.exitCliMode,
      workbench.primaryPanelState.isCliToggleActive,
      workbench.ptyState.actions.disconnectPty,
      workbench.stoppedSessionMessage,
      workbench.terminalPanelState.closePanel,
      workbench.terminalPanelState.isVisible,
      workbench.terminalPanelState.openPanel,
    ],
  );
  useAppShellHeaderActions(headerActions);

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
  const terminalPanelKey = [
    input.sandboxInstanceId,
    workbench.terminalPanelState.isVisible ? "visible" : "hidden",
  ].join(":");
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
                : "Could not start Codex TUI",
            description:
              workbench.primaryPanelState.error.message ??
              (workbench.primaryPanelState.error.kind === "chat_restore_failed"
                ? "The workbench could not reconnect chat automatically. Please try again later or contact support if the problem continues."
                : "Could not start Codex TUI."),
          }
        : null;
  if (input.sandboxInstanceId === null) {
    return (
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<></>}
        bottomPanelSize={32}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        onBottomPanelResize={function onBottomPanelResize() {}}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
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
        secondaryPanelSize={38}
        mainContent={
          <SessionConversationMainContent
            activeTurnId={null}
            isTurnInProgress={false}
            pendingTurnId={null}
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
    );
  }

  return (
    <SessionWorkbenchPageView
      alert={alert}
      isPrimaryPanelTransitioning={
        workbench.primaryPanelState.transitionState === "switching_to_cli" ||
        workbench.primaryPanelState.transitionState === "restoring_chat"
      }
      bottomPanel={
        <SessionTerminalPanel
          key={terminalPanelKey}
          cwd={workbench.primaryRepositoryState.selectedRepositoryPath}
          isConnectionReady={workbench.connectionReadiness.canConnect}
          isVisible={workbench.terminalPanelState.isVisible}
          onHide={workbench.terminalPanelState.closePanel}
          onDisconnectTerminal={async (): Promise<void> => {
            workbench.terminalPanelState.closePanel();
            await workbench.ptyState.actions.disconnectPty();
          }}
          ptyState={workbench.ptyState}
          sandboxStatus={workbench.sandboxLifecycleStatus}
          sandboxInstanceId={input.sandboxInstanceId}
        />
      }
      bottomPanelSize={workbench.terminalPanelState.panelSize}
      isBottomPanelVisible={workbench.terminalPanelState.isVisible}
      isSecondaryPanelVisible={workbench.diffPanelState.isVisible}
      mainContentLayout={
        workbench.primaryPanelState.transitionState === "stable_cli"
          ? { scroll: "contained", width: "full" }
          : { scroll: "page", width: "chat" }
      }
      mainContent={renderPrimaryPanelMainContent({
        conversation: {
          activeTurnId: conversationPane.chatState.activeTurnId,
          isTurnInProgress: conversationPane.chatState.status === "inProgress",
          pendingTurnId: conversationPane.chatState.pendingTurnId,
          chatEntries: conversationPane.chatState.entries,
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
        },
        transitionState: workbench.primaryPanelState.transitionState,
      })}
      mainContentScrollContainerRef={conversationScrollContainerRef}
      onBottomPanelResize={workbench.terminalPanelState.setPanelSize}
      onSecondaryPanelResize={workbench.diffPanelState.setPanelSize}
      primaryBottomPanel={
        workbench.primaryPanelState.showsChatComposer ? (
          <SessionConversationBottomPanelController
            chatEntries={conversationPane.chatState.entries}
            composerStateInput={conversationPane.composerStateInput}
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
          isLoading={workbench.connectionReadiness.canConnect && workbench.diffPanelState.isLoading}
          patch={diffPanelPatch}
          summaryLabel="Compared with main"
          title="Current changes"
        />
      }
      secondaryPanelSize={workbench.diffPanelState.panelSize}
      sandboxInstanceId={input.sandboxInstanceId}
    />
  );
}

type PrimaryPanelConversationContent = Pick<
  React.ComponentProps<typeof SessionConversationMainContent>,
  | "activeTurnId"
  | "isTurnInProgress"
  | "pendingTurnId"
  | "chatEntries"
  | "isRespondingToServerRequest"
  | "onRespondToServerRequest"
  | "scrollContainerRef"
  | "serverRequestPanelEntries"
>;

type PrimaryPanelCliContent = Pick<
  React.ComponentProps<typeof SessionCliPanel>,
  "ptyState" | "refitKey"
>;

function renderPrimaryPanelMainContent(input: {
  cli: PrimaryPanelCliContent;
  conversation: PrimaryPanelConversationContent;
  transitionState: ReturnType<
    typeof useSessionWorkbenchController
  >["workbench"]["primaryPanelState"]["transitionState"];
}): React.JSX.Element {
  switch (input.transitionState) {
    case "switching_to_cli":
    case "restoring_chat":
      return <></>;
    case "stable_cli":
      return (
        <SessionCliPanel
          ptyState={input.cli.ptyState}
          {...(input.cli.refitKey === undefined ? {} : { refitKey: input.cli.refitKey })}
        />
      );
    case "stable_chat":
      return <SessionConversationMainContent {...input.conversation} />;
  }
}

function createEmptyComposerViewModel(): ChatComposerViewModel {
  return {
    composerText: "",
    isSubmitPending: false,
    pendingAttachments: [],
    modelOptions: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    submitMode: "start",
    submitLabel: "Send",
    submitDisabled: true,
    submitDisabledReason: null,
    canUploadAttachments: false,
    isUploadingAttachments: false,
    configControlsDisabled: true,
    onComposerTextChange: function onComposerTextChange() {},
    onSubmit: function onSubmit() {},
    onModelChange: function onModelChange() {},
    onReasoningEffortChange: function onReasoningEffortChange() {},
    onPendingImageFilesAdded: function onPendingImageFilesAdded() {},
    onRemovePendingAttachment: function onRemovePendingAttachment() {},
  };
}
