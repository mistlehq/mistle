import type { ChatEntry } from "../chat/chat-types.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import { CodexServerRequestsPanel } from "../codex-client/codex-server-requests-panel.js";
import type { CodexServerRequestEntry } from "../codex-client/codex-server-requests-state.js";

export type CodexSessionPaneComposerProps = React.ComponentProps<typeof ChatComposer>;

type CodexSessionPaneProps = {
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly CodexServerRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  composerProps: CodexSessionPaneComposerProps;
};

export function CodexSessionPaneMainContent({
  chatEntries,
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: CodexSessionPaneProps): React.JSX.Element {
  return (
    <ChatThread
      entries={chatEntries}
      isRespondingToServerRequest={isRespondingToServerRequest}
      onRespondToServerRequest={onRespondToServerRequest}
      pendingServerRequests={serverRequestPanelEntries}
    />
  );
}

export function CodexSessionPaneBottomPanel({
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  composerProps,
}: CodexSessionPaneProps): React.JSX.Element {
  return (
    <>
      <CodexServerRequestsPanel
        entries={serverRequestPanelEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
      />
      <ChatComposer {...composerProps} />
    </>
  );
}
