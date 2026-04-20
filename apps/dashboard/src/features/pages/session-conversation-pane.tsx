import type React from "react";

import type { ChatEntry } from "../chat/chat-types.js";
import {
  ChatComposer,
  type ChatComposerStatusMessage,
  type ChatComposerViewModel,
} from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import { CodexApprovalRequestsPanel } from "../session-agents/codex/approvals/index.js";
import type { CodexApprovalRequestEntry } from "../session-agents/codex/approvals/index.js";
import {
  ComposerStatusBanner,
  SessionComposerActivityRow,
  useSessionComposerState,
  type SessionComposerDraftState,
  type SessionComposerStateInput,
} from "./session-composer/index.js";
import {
  useFollowStreamingAtBottomScrollBehavior,
  usePinnedTurnToTopScrollBehavior,
  type SessionConversationScrollBehavior,
} from "./session-conversation-scroll-behavior.js";

type SessionConversationMainContentProps = {
  activeTurnId: string | null;
  isTurnInProgress: boolean;
  pendingTurnId: string | null;
  scrollBehavior?: SessionConversationScrollBehavior;
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly CodexApprovalRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
};

type SessionConversationSharedPanelProps = {
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly CodexApprovalRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

type SessionConversationBottomPanelProps = SessionConversationSharedPanelProps & {
  composerViewModel: ChatComposerViewModel;
  showWorkingIndicator?: boolean;
  statusMessage: ChatComposerStatusMessage | null;
};

type SessionConversationBottomPanelControllerProps = SessionConversationSharedPanelProps & {
  draftState: SessionComposerDraftState;
  composerStateInput: SessionComposerStateInput;
  showWorkingIndicator?: boolean;
};

export function SessionConversationMainContent({
  activeTurnId,
  isTurnInProgress,
  pendingTurnId,
  scrollBehavior = "pin-active-turn-to-top",
  chatEntries,
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  scrollContainerRef,
}: SessionConversationMainContentProps): React.JSX.Element {
  const pinnedTurnScrollBehavior = usePinnedTurnToTopScrollBehavior({
    activeTurnId,
    chatEntries,
    enabled: scrollBehavior === "pin-active-turn-to-top",
    isTurnInProgress,
    pendingTurnId,
    scrollContainerRef,
  });
  useFollowStreamingAtBottomScrollBehavior({
    chatEntries,
    enabled: scrollBehavior === "follow-streaming-at-bottom",
    scrollContainerRef,
  });

  return (
    <div
      ref={pinnedTurnScrollBehavior.threadRootRef}
      style={
        pinnedTurnScrollBehavior.pinnedTurnId === null ? undefined : { overflowAnchor: "none" }
      }
    >
      <ChatThread
        entries={chatEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
        pendingServerRequests={serverRequestPanelEntries}
      />
      {pinnedTurnScrollBehavior.pinnedTurnId === null ? null : (
        <div
          aria-hidden="true"
          data-slot="conversation-bottom-spacer"
          style={{ height: `${pinnedTurnScrollBehavior.reservedSpacerHeight}px` }}
        />
      )}
    </div>
  );
}

export function SessionConversationBottomPanel({
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  composerViewModel,
  showWorkingIndicator = false,
  statusMessage,
}: SessionConversationBottomPanelProps): React.JSX.Element {
  return (
    <>
      <CodexApprovalRequestsPanel
        entries={serverRequestPanelEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
      />
      {statusMessage === null ? null : <ComposerStatusBanner statusMessage={statusMessage} />}
      {showWorkingIndicator ? (
        <SessionComposerActivityRow active ariaLabel="Working" text="Working..." />
      ) : null}
      <ChatComposer {...composerViewModel} />
    </>
  );
}

export function SessionConversationBottomPanelController({
  draftState,
  composerStateInput,
  showWorkingIndicator,
  ...bottomPanelProps
}: SessionConversationBottomPanelControllerProps): React.JSX.Element {
  const composerUiState = useSessionComposerState({
    composerStateInput,
    draftState,
  });

  return (
    <SessionConversationBottomPanel
      {...bottomPanelProps}
      composerViewModel={composerUiState.composerViewModel}
      statusMessage={composerUiState.statusMessage}
      {...(showWorkingIndicator === undefined ? {} : { showWorkingIndicator })}
    />
  );
}
