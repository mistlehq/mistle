import { Alert, AlertDescription } from "@mistle/ui";

import type { ChatEntry } from "../chat/chat-types.js";
import { ChatComposer, type ChatComposerViewModel } from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import { CodexApprovalRequestsPanel } from "../session-agents/codex/approvals/index.js";
import type { CodexApprovalRequestEntry } from "../session-agents/codex/approvals/index.js";
import {
  useSessionComposerState,
  type SessionComposerStateInput,
} from "./session-composer/index.js";

type SessionConversationMainContentProps = {
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly CodexApprovalRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

type SessionConversationBottomPanelProps = SessionConversationMainContentProps & {
  composerViewModel: ChatComposerViewModel;
};

type SessionConversationBottomPanelControllerProps = SessionConversationMainContentProps & {
  composerStateInput: SessionComposerStateInput;
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
  composerViewModel,
}: SessionConversationBottomPanelProps): React.JSX.Element {
  return (
    <>
      <CodexApprovalRequestsPanel
        entries={serverRequestPanelEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
      />
      {composerViewModel.statusMessage === null ? null : (
        <Alert
          className="mb-3"
          variant={composerViewModel.statusMessage.tone === "error" ? "destructive" : "default"}
        >
          <AlertDescription>{composerViewModel.statusMessage.message}</AlertDescription>
        </Alert>
      )}
      <ChatComposer {...composerViewModel} />
    </>
  );
}

export function SessionConversationBottomPanelController({
  composerStateInput,
  ...bottomPanelProps
}: SessionConversationBottomPanelControllerProps): React.JSX.Element {
  const composerViewModel = useSessionComposerState(composerStateInput);

  return (
    <SessionConversationBottomPanel {...bottomPanelProps} composerViewModel={composerViewModel} />
  );
}
