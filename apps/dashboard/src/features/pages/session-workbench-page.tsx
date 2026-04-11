import { Badge, Button } from "@mistle/ui";
import { GitDiffIcon, TerminalIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
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
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";
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
  const cliButtonLabel = "CLI";
  const cliButtonTitle = workbench.primaryPanelState.isCliToggleActive
    ? "Return to chat"
    : (workbench.primaryPanelState.disabledReason ?? "Open Codex CLI");
  const isErrorHeaderStatus = workbench.workbenchStatus.kind === "error";
  const headerStatusLabel = isErrorHeaderStatus
    ? "Error"
    : resolveSandboxStatusBadgeUi(workbench.sandboxLifecycleStatus).label;
  const headerStatusClassName =
    workbench.workbenchStatus.kind === "connected"
      ? "border-emerald-600 bg-emerald-600"
      : "border-stone-300 bg-stone-300";
  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        {isErrorHeaderStatus ? (
          <Badge aria-label={headerStatusLabel} title={headerStatusLabel} variant="destructive">
            {headerStatusLabel}
          </Badge>
        ) : (
          <span
            aria-label={headerStatusLabel}
            className={`inline-block size-2.5 rounded-full border ${headerStatusClassName}`}
            role="status"
            title={headerStatusLabel}
          />
        )}
        <span aria-hidden className="h-5 w-px bg-stone-200" />
        <Button
          aria-label={cliButtonLabel}
          aria-pressed={workbench.primaryPanelState.isCliToggleActive}
          className={
            workbench.primaryPanelState.isCliToggleActive
              ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
              : "bg-transparent text-foreground shadow-none hover:bg-stone-100"
          }
          disabled={
            !workbench.primaryPanelState.canEnterCli &&
            !workbench.primaryPanelState.isCliToggleActive
          }
          onClick={() => {
            if (workbench.primaryPanelState.isCliToggleActive) {
              void workbench.primaryPanelState.exitCliMode();
              return;
            }

            void workbench.primaryPanelState.enterCliMode();
          }}
          size="sm"
          title={cliButtonTitle}
          type="button"
          variant="ghost"
        >
          CLI
        </Button>
        <Button
          aria-label={diffButtonLabel}
          aria-pressed={workbench.diffPanelState.isVisible}
          className={
            workbench.diffPanelState.isVisible
              ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
              : "bg-transparent text-foreground shadow-none hover:bg-stone-100"
          }
          disabled={isDiffOpenDisabled}
          onClick={() => {
            workbench.diffPanelState.togglePanel();
          }}
          size="icon-sm"
          title={diffButtonTitle}
          type="button"
          variant="ghost"
        >
          <GitDiffIcon className="size-4" />
        </Button>
        <SessionPortAccessPopover state={workbench.portAccessState} />
        <Button
          aria-label={terminalButtonLabel}
          aria-pressed={workbench.terminalPanelState.isVisible}
          className={
            workbench.terminalPanelState.isVisible
              ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
              : "bg-transparent text-foreground shadow-none hover:bg-stone-100"
          }
          disabled={isTerminalOpenDisabled}
          onClick={() => {
            if (workbench.terminalPanelState.isVisible) {
              workbench.terminalPanelState.closePanel();
              void workbench.ptyState.actions.disconnectPty();
              return;
            }

            workbench.terminalPanelState.openPanel();
          }}
          size="icon-sm"
          title={terminalButtonTitle}
          type="button"
          variant="ghost"
        >
          <TerminalIcon className="size-4" />
        </Button>
      </div>
    ),
    [
      isTerminalOpenDisabled,
      isDiffOpenDisabled,
      cliButtonTitle,
      diffButtonLabel,
      diffButtonTitle,
      headerStatusClassName,
      headerStatusLabel,
      isErrorHeaderStatus,
      terminalButtonLabel,
      terminalButtonTitle,
      workbench.diffPanelState.isVisible,
      workbench.diffPanelState.togglePanel,
      workbench.portAccessState,
      workbench.sandboxLifecycleStatus,
      workbench.primaryPanelState.canEnterCli,
      workbench.primaryPanelState.disabledReason,
      workbench.primaryPanelState.enterCliMode,
      workbench.primaryPanelState.exitCliMode,
      workbench.primaryPanelState.isCliToggleActive,
      workbench.ptyState.actions.disconnectPty,
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
  const diffPanelErrorMessage = !workbench.connectionReadiness.canConnect
    ? (workbench.stoppedSessionMessage ?? "Changes are available only when the sandbox is running.")
    : workbench.diffPanelState.errorMessage;
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
                : "Could not start Codex CLI",
            description:
              workbench.primaryPanelState.error.message ??
              (workbench.primaryPanelState.error.kind === "chat_restore_failed"
                ? "The workbench could not reconnect chat automatically. Please try again later or contact support if the problem continues."
                : "Could not start Codex CLI."),
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
            chatEntries={[]}
            isRespondingToServerRequest={false}
            onRespondToServerRequest={function onRespondToServerRequest() {}}
            serverRequestPanelEntries={[]}
          />
        }
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
          chatEntries: conversationPane.chatState.entries,
          isRespondingToServerRequest:
            conversationPane.serverRequestsState.isRespondingToServerRequest,
          onRespondToServerRequest: conversationPane.serverRequestsState.respondToServerRequest,
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
          />
        ) : null
      }
      secondaryPanel={
        <SessionDiffPanel
          errorMessage={diffPanelErrorMessage}
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
  | "chatEntries"
  | "isRespondingToServerRequest"
  | "onRespondToServerRequest"
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
