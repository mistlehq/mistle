import { Alert, AlertDescription } from "@mistle/ui";

import type { ChatEntry } from "../chat/chat-types.js";
import { ChatComposer, type ChatComposerStatusMessage } from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import { CodexApprovalRequestsPanel } from "../session-agents/codex/approvals/index.js";
import type { CodexApprovalRequestEntry } from "../session-agents/codex/approvals/index.js";

export type SessionConversationComposerProps = React.ComponentProps<typeof ChatComposer>;

type SessionConversationMainContentProps = {
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly CodexApprovalRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

type SessionConversationBottomPanelProps = SessionConversationMainContentProps & {
  sessionStatusMessage: ChatComposerStatusMessage | null;
  composerProps: SessionConversationComposerProps;
};

export function SessionConversationMainContent({
  chatEntries,
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: SessionConversationMainContentProps): React.JSX.Element {
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
  sessionStatusMessage,
  composerProps,
}: SessionConversationBottomPanelProps): React.JSX.Element {
  return (
    <>
      <CodexApprovalRequestsPanel
        entries={serverRequestPanelEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
      />
      {sessionStatusMessage === null ? null : (
        <Alert
          className="mb-3"
          variant={sessionStatusMessage.tone === "error" ? "destructive" : "default"}
        >
          <AlertDescription>{sessionStatusMessage.message}</AlertDescription>
        </Alert>
      )}
      <ChatComposer {...composerProps} />
    </>
  );
}
