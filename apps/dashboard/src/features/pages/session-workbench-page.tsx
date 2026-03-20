import { Badge, Button } from "@mistle/ui";
import { TerminalIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { useParams } from "react-router";

import { SessionMoreActions } from "../sessions/session-more-actions.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
  type SessionConversationComposerProps,
} from "./session-conversation-pane.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";
import { useSessionWorkbenchController } from "./use-session-workbench-controller.js";

export function SessionWorkbenchPage(): React.JSX.Element {
  const params = useParams();
  const sandboxInstanceId = params["sandboxInstanceId"] ?? null;
  const { conversationPane, workbench } = useSessionWorkbenchController({
    sandboxInstanceId,
  });
  const handleHideTerminalPanel = useCallback((): void => {
    workbench.terminalPanelState.closePanel();
  }, [workbench.terminalPanelState]);
  const handleCloseTerminalPanel = useCallback(async (): Promise<void> => {
    workbench.terminalPanelState.closePanel();
    await workbench.ptyState.actions.disconnectPty();
  }, [workbench.ptyState.actions, workbench.terminalPanelState]);
  const isTerminalOpenDisabled =
    !workbench.terminalPanelState.isVisible && !workbench.connectionReadiness.canConnect;
  const terminalButtonLabel = workbench.terminalPanelState.isVisible ? "Terminal" : "Open terminal";
  const terminalButtonTitle = isTerminalOpenDisabled
    ? (workbench.stoppedSessionState.message ??
      "Terminal is available only when the sandbox is running.")
    : terminalButtonLabel;
  const headerActions = (
    <div className="flex items-center gap-2">
      <Badge
        className={workbench.sessionHeaderStatusUi.className}
        variant={workbench.sessionHeaderStatusUi.variant}
      >
        {workbench.sessionHeaderStatusUi.label}
      </Badge>
      <SessionMoreActions
        agentConnectionState={workbench.moreActionsState.agentConnectionState}
        configJson={workbench.moreActionsState.configJson}
        configRequirementsJson={workbench.moreActionsState.configRequirementsJson}
        connectedSession={workbench.moreActionsState.connectedSession}
        isReadingConfig={workbench.moreActionsState.isReadingConfig}
        isReadingConfigRequirements={workbench.moreActionsState.isReadingConfigRequirements}
        onLoadConfigSetup={workbench.moreActionsState.loadConfigSetup}
        sandboxInstanceId={sandboxInstanceId}
      />
      <Button
        disabled={isTerminalOpenDisabled}
        onClick={() => {
          if (workbench.terminalPanelState.isVisible) {
            void handleCloseTerminalPanel();
            return;
          }

          workbench.terminalPanelState.openPanel();
        }}
        size="sm"
        title={terminalButtonTitle}
        type="button"
        variant={workbench.terminalPanelState.isVisible ? "secondary" : "outline"}
      >
        <TerminalIcon className="size-4" />
        Terminal
      </Button>
    </div>
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
  if (workbench.startErrorMessage !== null) {
    alerts.push({
      title: "Session connection error",
      description: workbench.startErrorMessage,
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
  if (sandboxInstanceId === null) {
    return (
      <SessionWorkbenchPageView
        alerts={[]}
        isSecondaryPanelVisible={false}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={
          <SessionConversationBottomPanel
            chatEntries={[]}
            composerProps={createEmptyComposerProps()}
            isRespondingToServerRequest={false}
            onRespondToServerRequest={function onRespondToServerRequest() {}}
            serverRequestPanelEntries={[]}
          />
        }
        secondaryPanel={<></>}
        secondaryPanelSize={38}
        mainContent={
          <SessionConversationMainContent
            chatEntries={[]}
            composerProps={createEmptyComposerProps()}
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
      alerts={workbench.hasTopAlert ? alerts : []}
      isSecondaryPanelVisible={workbench.terminalPanelState.isVisible}
      mainContent={
        <SessionConversationMainContent
          chatEntries={conversationPane.chatState.entries}
          composerProps={conversationPane.composerProps}
          isRespondingToServerRequest={
            conversationPane.serverRequestsState.isRespondingToServerRequest
          }
          onRespondToServerRequest={conversationPane.serverRequestsState.respondToServerRequest}
          serverRequestPanelEntries={unmatchedServerRequests}
        />
      }
      onSecondaryPanelResize={workbench.terminalPanelState.setPanelSize}
      primaryBottomPanel={
        <SessionConversationBottomPanel
          chatEntries={conversationPane.chatState.entries}
          composerProps={conversationPane.composerProps}
          isRespondingToServerRequest={
            conversationPane.serverRequestsState.isRespondingToServerRequest
          }
          onRespondToServerRequest={conversationPane.serverRequestsState.respondToServerRequest}
          serverRequestPanelEntries={unmatchedServerRequests}
        />
      }
      secondaryPanel={
        <SessionTerminalPanel
          isConnectionReady={workbench.connectionReadiness.canConnect}
          isVisible={workbench.terminalPanelState.isVisible}
          onHide={handleHideTerminalPanel}
          onClose={handleCloseTerminalPanel}
          ptyState={workbench.ptyState}
          sandboxInstanceId={sandboxInstanceId}
          sandboxStatus={workbench.sandboxStatusQuery.data?.status ?? null}
        />
      }
      secondaryPanelSize={workbench.terminalPanelState.panelSize}
      sandboxInstanceId={sandboxInstanceId}
    />
  );
}

function createEmptyComposerProps(): SessionConversationComposerProps {
  return {
    canInterruptTurn: false,
    canSteerTurn: false,
    completedErrorMessage: null,
    composerText: "",
    isConnected: false,
    isInterruptingTurn: false,
    isStartingTurn: false,
    isSteeringTurn: false,
    isUpdatingComposerConfig: false,
    modelOptions: [],
    onComposerTextChange: function onComposerTextChange() {},
    onModelChange: function onModelChange() {},
    onReasoningEffortChange: function onReasoningEffortChange() {},
    onSubmit: function onSubmit() {},
    selectedModel: null,
    selectedReasoningEffort: null,
  };
}
