import { Badge } from "@mistle/ui";
import { useParams } from "react-router";

import { SessionMoreActions } from "../sessions/session-more-actions.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import {
  CodexSessionPaneBottomPanel,
  CodexSessionPaneMainContent,
  type CodexSessionPaneComposerProps,
} from "./codex-session-pane.js";
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

  if (sandboxInstanceId === null) {
    return (
      <SessionWorkbenchPageView
        alerts={[]}
        bottomPanel={
          <CodexSessionPaneBottomPanel
            chatEntries={[]}
            composerProps={createEmptyComposerProps()}
            isRespondingToServerRequest={false}
            onRespondToServerRequest={function onRespondToServerRequest() {}}
            serverRequestPanelEntries={[]}
          />
        }
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
      alerts={workbench.hasTopAlert ? alerts : []}
      bottomPanel={
        <CodexSessionPaneBottomPanel
          chatEntries={codexPane.chatState.entries}
          composerProps={codexPane.composerProps}
          isRespondingToServerRequest={codexPane.serverRequestsState.isRespondingToServerRequest}
          onRespondToServerRequest={codexPane.serverRequestsState.respondToServerRequest}
          serverRequestPanelEntries={unmatchedServerRequests}
        />
      }
      mainContent={
        <CodexSessionPaneMainContent
          chatEntries={codexPane.chatState.entries}
          composerProps={codexPane.composerProps}
          isRespondingToServerRequest={codexPane.serverRequestsState.isRespondingToServerRequest}
          onRespondToServerRequest={codexPane.serverRequestsState.respondToServerRequest}
          serverRequestPanelEntries={unmatchedServerRequests}
        />
      }
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
