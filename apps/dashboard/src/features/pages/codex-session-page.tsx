import { Badge } from "@mistle/ui";
import { useParams } from "react-router";

import { SessionMoreActions } from "../sessions/session-more-actions.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import {
  CodexSessionPageView,
  type CodexSessionPageComposerProps,
} from "./codex-session-page-view.js";
import { useCodexSessionPageController } from "./use-codex-session-page-controller.js";

export function CodexSessionPage(): React.JSX.Element {
  const params = useParams();
  const sandboxInstanceId = params["sandboxInstanceId"] ?? null;
  const {
    composerText,
    composerModelOptions,
    composerState,
    selectedComposerModel,
    selectedComposerReasoningEffort,
    setComposerModel,
    setComposerReasoningEffort,
    setComposerText,
    hasTopAlert,
    moreActionsState,
    serverRequestsState,
    sandboxFailureMessage,
    sandboxStatusQuery,
    sessionHeaderStatusUi,
    startErrorMessage,
    submitComposer,
    chatState,
  } = useCodexSessionPageController({
    sandboxInstanceId,
  });
  const headerActions = (
    <div className="flex items-center gap-2">
      <Badge className={sessionHeaderStatusUi.className} variant={sessionHeaderStatusUi.variant}>
        {sessionHeaderStatusUi.label}
      </Badge>
      <SessionMoreActions
        agentConnectionState={moreActionsState.agentConnectionState}
        configJson={moreActionsState.configJson}
        configRequirementsJson={moreActionsState.configRequirementsJson}
        connectedSession={moreActionsState.connectedSession}
        isReadingConfig={moreActionsState.isReadingConfig}
        isReadingConfigRequirements={moreActionsState.isReadingConfigRequirements}
        onLoadConfigSetup={moreActionsState.loadConfigSetup}
        sandboxInstanceId={sandboxInstanceId}
      />
    </div>
  );
  useAppShellHeaderActions(headerActions);

  const transcriptItemIds = new Set(
    chatState.entries.flatMap((entry) => {
      if (entry.kind === "exploring-group") {
        return entry.items.map((item) => item.id);
      }

      if (entry.kind === "command-execution" || entry.kind === "file-change") {
        return [entry.id];
      }

      return [];
    }),
  );
  const unmatchedServerRequests = serverRequestsState.pendingServerRequests.filter((entry) => {
    if (entry.kind !== "command-approval" && entry.kind !== "file-change-approval") {
      return true;
    }

    return !transcriptItemIds.has(entry.itemId);
  });

  if (sandboxInstanceId === null) {
    return (
      <CodexSessionPageView
        chatEntries={[]}
        composerProps={createEmptyComposerProps()}
        hasTopAlert={false}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        sandboxFailureMessage={null}
        sandboxInstanceId={null}
        sandboxStatusErrorMessage={null}
        serverRequestPanelEntries={[]}
        startErrorMessage={null}
      />
    );
  }

  return (
    <CodexSessionPageView
      chatEntries={chatState.entries}
      composerProps={{
        canInterruptTurn: composerState.canInterruptTurn,
        canSteerTurn: composerState.canSteerTurn,
        completedErrorMessage: composerState.completedErrorMessage,
        composerText,
        isConnected: composerState.isConnected,
        isInterruptingTurn: composerState.isInterruptingTurn,
        isStartingTurn: composerState.isStartingTurn,
        isSteeringTurn: composerState.isSteeringTurn,
        isUpdatingComposerConfig: composerState.isUpdatingComposerConfig,
        modelOptions: composerModelOptions,
        onComposerTextChange: setComposerText,
        onModelChange: setComposerModel,
        onReasoningEffortChange: setComposerReasoningEffort,
        onSubmit: submitComposer,
        selectedModel: selectedComposerModel,
        selectedReasoningEffort: selectedComposerReasoningEffort,
      }}
      hasTopAlert={hasTopAlert}
      isRespondingToServerRequest={serverRequestsState.isRespondingToServerRequest}
      onRespondToServerRequest={serverRequestsState.respondToServerRequest}
      sandboxFailureMessage={sandboxFailureMessage}
      sandboxInstanceId={sandboxInstanceId}
      sandboxStatusErrorMessage={
        sandboxStatusQuery.isError
          ? sandboxStatusQuery.error instanceof Error
            ? sandboxStatusQuery.error.message
            : "Could not load sandbox status."
          : null
      }
      serverRequestPanelEntries={unmatchedServerRequests}
      startErrorMessage={startErrorMessage}
    />
  );
}

function createEmptyComposerProps(): CodexSessionPageComposerProps {
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
