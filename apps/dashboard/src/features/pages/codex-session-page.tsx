import { Badge, Button } from "@mistle/ui";
import { TerminalIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { useParams } from "react-router";

import { SessionMoreActions } from "../sessions/session-more-actions.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import {
  CodexSessionPaneBottomPanel,
  CodexSessionPaneMainContent,
  type CodexSessionPaneComposerProps,
} from "./codex-session-pane.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";
import { useCodexSessionPageController } from "./use-codex-session-page-controller.js";

export function CodexSessionPage(): React.JSX.Element {
  const params = useParams();
  const sandboxInstanceId = params["sandboxInstanceId"] ?? null;
  const { codexPane, workbench } = useCodexSessionPageController({
    sandboxInstanceId,
  });
  const handleCloseTerminalPanel = useCallback(async (): Promise<void> => {
    await workbench.ptyState.actions.disconnectPty();
    workbench.terminalPanelState.closePanel();
  }, [workbench.ptyState.actions, workbench.terminalPanelState]);
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
        onClick={() => {
          if (workbench.terminalPanelState.isVisible) {
            void handleCloseTerminalPanel();
            return;
          }

          workbench.terminalPanelState.openPanel();
        }}
        size="sm"
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
    codexPane.chatState.entries.flatMap((entry) => {
      if (entry.kind === "semantic-group") {
        return entry.items.map((item) => item.id);
      }

      if (entry.kind === "command-execution" || entry.kind === "file-change") {
        return [entry.id];
      }

      return [];
    }),
  );
  const unmatchedServerRequests = codexPane.serverRequestsState.pendingServerRequests.filter(
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
  if (workbench.sandboxFailureMessage !== null) {
    alerts.push({
      title: "Sandbox failed",
      description: workbench.sandboxFailureMessage,
    });
  }
  if (workbench.ptyState.lifecycle.errorMessage !== null) {
    alerts.push({
      title: "Terminal connection error",
      description: workbench.ptyState.lifecycle.errorMessage,
    });
  }

  if (sandboxInstanceId === null) {
    return (
      <SessionWorkbenchPageView
        alerts={[]}
        isSecondaryPanelVisible={false}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={
          <CodexSessionPaneBottomPanel
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
          <CodexSessionPaneMainContent
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
      alerts={
        workbench.hasTopAlert || workbench.ptyState.lifecycle.errorMessage !== null ? alerts : []
      }
      isSecondaryPanelVisible={workbench.terminalPanelState.isVisible}
      mainContent={
        <CodexSessionPaneMainContent
          chatEntries={codexPane.chatState.entries}
          composerProps={codexPane.composerProps}
          isRespondingToServerRequest={codexPane.serverRequestsState.isRespondingToServerRequest}
          onRespondToServerRequest={codexPane.serverRequestsState.respondToServerRequest}
          serverRequestPanelEntries={unmatchedServerRequests}
        />
      }
      onSecondaryPanelResize={workbench.terminalPanelState.setPanelSize}
      primaryBottomPanel={
        <CodexSessionPaneBottomPanel
          chatEntries={codexPane.chatState.entries}
          composerProps={codexPane.composerProps}
          isRespondingToServerRequest={codexPane.serverRequestsState.isRespondingToServerRequest}
          onRespondToServerRequest={codexPane.serverRequestsState.respondToServerRequest}
          serverRequestPanelEntries={unmatchedServerRequests}
        />
      }
      secondaryPanel={
        <SessionTerminalPanel
          isVisible={workbench.terminalPanelState.isVisible}
          onClose={handleCloseTerminalPanel}
          ptyState={workbench.ptyState}
          sandboxInstanceId={sandboxInstanceId}
        />
      }
      secondaryPanelSize={workbench.terminalPanelState.panelSize}
      sandboxInstanceId={sandboxInstanceId}
    />
  );
}

function createEmptyComposerProps(): CodexSessionPaneComposerProps {
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
