import { Alert, AlertDescription, AlertTitle, Badge } from "@mistle/ui";
import { useParams } from "react-router";

import { ChatComposer } from "../chat/components/chat-composer.js";
import { SessionMoreActions } from "../sessions/session-more-actions.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
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
    sandboxFailureMessage,
    sandboxStatusQuery,
    sessionHeaderStatusUi,
    startErrorMessage,
    submitComposer,
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

  if (sandboxInstanceId === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Session id is missing</AlertTitle>
        <AlertDescription>Open a session from the Sessions page.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {hasTopAlert ? (
        <div className="mx-auto flex w-full max-w-3xl flex-none flex-col gap-4 px-4 py-6">
          {sandboxStatusQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load sandbox status</AlertTitle>
              <AlertDescription>
                {sandboxStatusQuery.error instanceof Error
                  ? sandboxStatusQuery.error.message
                  : "Could not load sandbox status."}
              </AlertDescription>
            </Alert>
          ) : null}
          {startErrorMessage !== null ? (
            <Alert variant="destructive">
              <AlertTitle>Session connection error</AlertTitle>
              <AlertDescription>{startErrorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {sandboxFailureMessage === null ? null : (
            <Alert variant="destructive">
              <AlertTitle>Sandbox failed</AlertTitle>
              <AlertDescription>{sandboxFailureMessage}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : null}

      <div
        aria-label="Conversation chat"
        className="min-h-0 flex-1 overflow-y-auto"
        role="region"
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-4">
          <div className="text-muted-foreground py-12 text-sm">No messages yet.</div>
        </div>
      </div>

      <div className="bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-3xl px-4">
          <ChatComposer
            canInterruptTurn={composerState.canInterruptTurn}
            canSteerTurn={composerState.canSteerTurn}
            completedErrorMessage={composerState.completedErrorMessage}
            composerText={composerText}
            isConnected={composerState.isConnected}
            isInterruptingTurn={composerState.isInterruptingTurn}
            isStartingTurn={composerState.isStartingTurn}
            isSteeringTurn={composerState.isSteeringTurn}
            isUpdatingComposerConfig={composerState.isUpdatingComposerConfig}
            modelOptions={composerModelOptions}
            onComposerTextChange={setComposerText}
            onModelChange={setComposerModel}
            onReasoningEffortChange={setComposerReasoningEffort}
            onSubmit={submitComposer}
            selectedModel={selectedComposerModel}
            selectedReasoningEffort={selectedComposerReasoningEffort}
          />
        </div>
      </div>
    </div>
  );
}
