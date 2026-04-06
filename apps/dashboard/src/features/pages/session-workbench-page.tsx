import { Badge, Button } from "@mistle/ui";
import { TerminalIcon } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router";

import type { ChatComposerViewModel } from "../chat/components/chat-composer.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import {
  resolveSandboxStatusBadgeUi,
  type SandboxStatusBadgeUi,
} from "./sandbox-status-presentation.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  SessionConversationBottomPanel,
  SessionConversationBottomPanelController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";
import type {
  SandboxStatusReadState,
  WorkbenchSandboxLifecycleStatus,
} from "./session-workbench-state.js";
import { useSessionWorkbenchController } from "./use-session-workbench-controller.js";

export function hasSessionTopAlert(input: {
  hasSandboxStatusError: boolean;
  lifecycleErrorMessage: string | null;
  reconnectMessage: string | null;
  sandboxFailureMessage: string | null;
  stoppedSessionMessage: string | null;
}): boolean {
  return (
    input.hasSandboxStatusError ||
    input.lifecycleErrorMessage !== null ||
    input.reconnectMessage !== null ||
    input.sandboxFailureMessage !== null ||
    input.stoppedSessionMessage !== null
  );
}

export function resolveSessionWorkbenchHeaderStatusUi(input: {
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus;
  sandboxStatusReadState: SandboxStatusReadState;
}): SandboxStatusBadgeUi {
  return input.sandboxStatusReadState === "loading"
    ? resolveSandboxStatusBadgeUi(null)
    : resolveSandboxStatusBadgeUi(input.sandboxLifecycleStatus);
}

export function shouldShowResumeAction(input: { requiresManualResume: boolean }): boolean {
  return input.requiresManualResume;
}

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
    ? (workbench.stoppedSessionState.message ??
      "Terminal is available only when the sandbox is running.")
    : terminalButtonLabel;
  const cliButtonLabel = "CLI";
  const cliButtonTitle = workbench.primaryPanelState.isCliToggleActive
    ? "Return to chat"
    : (workbench.primaryPanelState.disabledReason ?? "Open Codex CLI");
  const sandboxHeaderStatusUi = resolveSessionWorkbenchHeaderStatusUi({
    sandboxLifecycleStatus: workbench.sandboxLifecycleStatus,
    sandboxStatusReadState: workbench.sandboxStatusReadState,
  });
  const showResumeButton = shouldShowResumeAction({
    requiresManualResume: workbench.stoppedSessionState.requiresManualResume,
  });
  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Badge className={sandboxHeaderStatusUi.className} variant={sandboxHeaderStatusUi.variant}>
          {sandboxHeaderStatusUi.label}
        </Badge>
        <span aria-hidden className="h-5 w-px bg-stone-200" />
        {showResumeButton ? (
          <Button
            disabled={workbench.isResumingStoppedSandbox}
            onClick={() => {
              void workbench.requestStoppedSandboxResume();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {workbench.isResumingStoppedSandbox ? "Resuming..." : "Resume"}
          </Button>
        ) : null}
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
      cliButtonTitle,
      terminalButtonLabel,
      showResumeButton,
      terminalButtonTitle,
      workbench.primaryPanelState.canEnterCli,
      workbench.primaryPanelState.disabledReason,
      workbench.primaryPanelState.enterCliMode,
      workbench.primaryPanelState.exitCliMode,
      workbench.primaryPanelState.isCliToggleActive,
      workbench.isResumingStoppedSandbox,
      workbench.ptyState.actions.disconnectPty,
      workbench.requestStoppedSandboxResume,
      sandboxHeaderStatusUi.className,
      sandboxHeaderStatusUi.label,
      sandboxHeaderStatusUi.variant,
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

  const alerts: SessionWorkbenchAlert[] = [];
  if (workbench.sandboxStatusQuery.isError) {
    alerts.push({
      title: "Could not load sandbox status",
      description:
        workbench.sandboxStatusQuery.error instanceof Error
          ? workbench.sandboxStatusQuery.error.message
          : "Could not load sandbox status.",
    });
  }
  if (workbench.lifecycleErrorMessage !== null) {
    alerts.push({
      title: "Session connection error",
      description: workbench.lifecycleErrorMessage,
    });
  }
  if (workbench.sessionReconnectState.message !== null) {
    alerts.push({
      title: "Reconnecting session",
      description: workbench.sessionReconnectState.message,
    });
  }
  if (workbench.stoppedSessionState.message !== null) {
    alerts.push({
      title: "Stopped sandbox",
      description: workbench.stoppedSessionState.message,
    });
  }
  if (workbench.sandboxFailureMessage !== null) {
    alerts.push({
      title: "Sandbox failed",
      description: workbench.sandboxFailureMessage,
    });
  }
  if (
    workbench.primaryPanelState.transitionState === "stable_chat" &&
    workbench.primaryPanelState.error !== null
  ) {
    alerts.push({
      title:
        workbench.primaryPanelState.error.kind === "chat_restore_failed"
          ? "Could not restore chat"
          : "Could not start Codex CLI",
      description:
        workbench.primaryPanelState.error.message ??
        (workbench.primaryPanelState.error.kind === "chat_restore_failed"
          ? "The workbench could not reconnect chat automatically. Please try again later or contact support if the problem continues."
          : "Could not start Codex CLI."),
    });
  }
  const hasTopAlert = hasSessionTopAlert({
    hasSandboxStatusError: workbench.sandboxStatusQuery.isError,
    lifecycleErrorMessage: workbench.lifecycleErrorMessage,
    reconnectMessage:
      workbench.primaryPanelState.transitionState === "stable_chat"
        ? workbench.sessionReconnectState.message
        : null,
    sandboxFailureMessage: workbench.sandboxFailureMessage,
    stoppedSessionMessage: workbench.stoppedSessionState.message,
  });
  if (input.sandboxInstanceId === null) {
    return (
      <SessionWorkbenchPageView
        alerts={[]}
        isSecondaryPanelVisible={false}
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
      alerts={
        hasTopAlert ||
        (workbench.primaryPanelState.transitionState === "stable_chat" &&
          workbench.primaryPanelState.error !== null)
          ? alerts
          : []
      }
      isPrimaryPanelTransitioning={
        workbench.primaryPanelState.transitionState === "switching_to_cli" ||
        workbench.primaryPanelState.transitionState === "restoring_chat"
      }
      isSecondaryPanelVisible={workbench.terminalPanelState.isVisible}
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
          refitKey: workbench.terminalPanelState.isVisible ? "cli:split" : "cli:solo",
        },
        transitionState: workbench.primaryPanelState.transitionState,
      })}
      onSecondaryPanelResize={workbench.terminalPanelState.setPanelSize}
      primaryBottomPanel={
        workbench.primaryPanelState.showsChatComposer ? (
          <>
            {workbench.shouldAutoResumeOnEntry ? (
              <SessionWorkbenchAutoResumeOnEntry
                requestStoppedSandboxResume={workbench.requestStoppedSandboxResume}
              />
            ) : null}
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
          </>
        ) : null
      }
      secondaryPanel={
        <SessionTerminalPanel
          key={terminalPanelKey}
          isResumingSandbox={workbench.isResumingStoppedSandbox}
          isConnectionReady={workbench.connectionReadiness.canConnect}
          isVisible={workbench.terminalPanelState.isVisible}
          onHide={workbench.terminalPanelState.closePanel}
          onDisconnectTerminal={async (): Promise<void> => {
            workbench.terminalPanelState.closePanel();
            await workbench.ptyState.actions.disconnectPty();
          }}
          onRequestSandboxResume={workbench.requestStoppedSandboxResume}
          ptyState={workbench.ptyState}
          sandboxStatus={workbench.sandboxLifecycleStatus}
          sandboxInstanceId={input.sandboxInstanceId}
        />
      }
      secondaryPanelSize={workbench.terminalPanelState.panelSize}
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

function SessionWorkbenchAutoResumeOnEntry(input: {
  requestStoppedSandboxResume: () => Promise<void>;
}): null {
  // Syncs this mount with the external resume API; render logic alone cannot start the network request.
  useEffect(() => {
    void input.requestStoppedSandboxResume();
  }, [input.requestStoppedSandboxResume]);

  return null;
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
