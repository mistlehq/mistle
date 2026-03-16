import type { ChatEntry } from "../chat/chat-types.js";
import type { CodexServerRequestEntry } from "../codex-client/codex-server-requests-state.js";
import {
  CodexSessionPaneBottomPanel,
  CodexSessionPaneMainContent,
  type CodexSessionPaneComposerProps,
} from "./codex-session-pane.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";

export type CodexSessionPageComposerProps = CodexSessionPaneComposerProps;

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
  const alerts: SessionWorkbenchAlert[] = [];
  if (sandboxStatusErrorMessage !== null) {
    alerts.push({
      title: "Could not load sandbox status",
      description: sandboxStatusErrorMessage,
    });
  }
  if (startErrorMessage !== null) {
    alerts.push({
      title: "Session connection error",
      description: startErrorMessage,
    });
  }
  if (sandboxFailureMessage !== null) {
    alerts.push({
      title: "Sandbox failed",
      description: sandboxFailureMessage,
    });
  }

  return (
    <SessionWorkbenchPageView
      alerts={hasTopAlert ? alerts : []}
      bottomPanel={
        <CodexSessionPaneBottomPanel
          chatEntries={chatEntries}
          composerProps={composerProps}
          isRespondingToServerRequest={isRespondingToServerRequest}
          onRespondToServerRequest={onRespondToServerRequest}
          serverRequestPanelEntries={serverRequestPanelEntries}
        />
      }
      mainContent={
        <CodexSessionPaneMainContent
          chatEntries={chatEntries}
          composerProps={composerProps}
          isRespondingToServerRequest={isRespondingToServerRequest}
          onRespondToServerRequest={onRespondToServerRequest}
          serverRequestPanelEntries={serverRequestPanelEntries}
        />
      }
      sandboxInstanceId={sandboxInstanceId}
    />
  );
}
