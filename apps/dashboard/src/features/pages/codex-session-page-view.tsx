import { Alert, AlertDescription, AlertTitle } from "@mistle/ui";

import type { ChatEntry } from "../chat/chat-types.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import { CodexServerRequestsPanel } from "../codex-client/codex-server-requests-panel.js";
import type { CodexServerRequestEntry } from "../codex-client/codex-server-requests-state.js";

export type CodexSessionPageComposerProps = React.ComponentProps<typeof ChatComposer>;

type CodexSessionPageViewProps = {
  sandboxInstanceId: string | null;
  hasTopAlert: boolean;
  sandboxStatusErrorMessage: string | null;
  startErrorMessage: string | null;
  sandboxFailureMessage: string | null;
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly CodexServerRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  composerProps: CodexSessionPageComposerProps;
};

export function CodexSessionPageView({
  sandboxInstanceId,
  hasTopAlert,
  sandboxStatusErrorMessage,
  startErrorMessage,
  sandboxFailureMessage,
  chatEntries,
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  composerProps,
}: CodexSessionPageViewProps): React.JSX.Element {
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
          {sandboxStatusErrorMessage === null ? null : (
            <Alert variant="destructive">
              <AlertTitle>Could not load sandbox status</AlertTitle>
              <AlertDescription>{sandboxStatusErrorMessage}</AlertDescription>
            </Alert>
          )}
          {startErrorMessage === null ? null : (
            <Alert variant="destructive">
              <AlertTitle>Session connection error</AlertTitle>
              <AlertDescription>{startErrorMessage}</AlertDescription>
            </Alert>
          )}
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
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <ChatThread
            entries={chatEntries}
            isRespondingToServerRequest={isRespondingToServerRequest}
            onRespondToServerRequest={onRespondToServerRequest}
            pendingServerRequests={serverRequestPanelEntries}
          />
        </div>
      </div>

      <div className="bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-3xl px-4">
          <CodexServerRequestsPanel
            entries={serverRequestPanelEntries}
            isRespondingToServerRequest={isRespondingToServerRequest}
            onRespondToServerRequest={onRespondToServerRequest}
          />
          <ChatComposer {...composerProps} />
        </div>
      </div>
    </div>
  );
}
