import type { ChatEntry } from "../chat/chat-types.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import { CodexApprovalRequestsPanel } from "../session-agents/codex/approvals/index.js";
import type { CodexApprovalRequestEntry } from "../session-agents/codex/approvals/index.js";

export type SessionConversationComposerProps = React.ComponentProps<typeof ChatComposer>;

type SessionConversationPaneProps = {
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly CodexApprovalRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  composerProps: SessionConversationComposerProps;
};

export function SessionConversationMainContent({
  chatEntries,
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: SessionConversationPaneProps): React.JSX.Element {
  return (
    <ChatThread
      entries={chatEntries}
      isRespondingToServerRequest={isRespondingToServerRequest}
      onRespondToServerRequest={onRespondToServerRequest}
      pendingServerRequests={serverRequestPanelEntries}
    />
  );
}

export function SessionConversationBottomPanel({
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  composerProps,
}: SessionConversationPaneProps): React.JSX.Element {
  return (
    <>
      <CodexApprovalRequestsPanel
        entries={serverRequestPanelEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
      />
      <ChatComposer {...composerProps} />
    </>
  );
}
