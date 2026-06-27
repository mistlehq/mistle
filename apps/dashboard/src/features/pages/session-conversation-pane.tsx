import { memo, useCallback, useMemo, useState } from "react";
import type React from "react";

import type { ChatEntry } from "../chat/chat-types.js";
import {
  ChatComposer,
  type ChatComposerStatusMessage,
  type ChatComposerViewModel,
} from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import { ChatUserMessage } from "../chat/components/chat-user-message.js";
import {
  ServerRequestsPanel,
  type RespondToServerRequest,
  type ServerRequestEntry,
  type ToolRequestUserInputEntry,
} from "../session-agents/server-requests/index.js";
import {
  ComposerStatusBanner,
  SessionComposerActivityRow,
  createComposerDraft,
  useSessionComposerState,
  type ComposerDraft,
  type QueuedComposerPromptViewModel,
  type SessionComposerDraftState,
  type SessionComposerStateInput,
} from "./session-composer/index.js";
import {
  useFollowStreamingAtBottomScrollBehavior,
  useInitialConversationBottomScrollBehavior,
  usePinnedTurnToTopScrollBehavior,
  type SessionConversationScrollBehavior,
} from "./session-conversation-scroll-behavior.js";

type SessionConversationMainContentProps = {
  activeTurnId: string | null;
  isTurnInProgress: boolean;
  pendingTurnId: string | null;
  autoScrollToBottomOnInitialLoad?: boolean;
  initialBottomScrollResetKey?: string | null;
  scrollBehavior?: SessionConversationScrollBehavior;
  chatEntries: readonly ChatEntry[];
  onUserMessageAction?: ((actionId: string) => void) | undefined;
  serverRequestPanelEntries: readonly ServerRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: RespondToServerRequest;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
};

type SessionConversationSharedPanelProps = {
  chatEntries: readonly ChatEntry[];
  serverRequestPanelEntries: readonly ServerRequestEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: RespondToServerRequest;
};

type SessionConversationBottomPanelProps = SessionConversationSharedPanelProps & {
  composerViewModel: ChatComposerViewModel;
  queuedPrompts?: readonly QueuedComposerPromptViewModel[];
  onRemoveQueuedPrompt?: (queuedPromptId: string) => void;
  showWorkingIndicator?: boolean;
  statusMessage: ChatComposerStatusMessage | null;
};

type SessionConversationBottomPanelControllerProps = SessionConversationSharedPanelProps & {
  draftState: SessionComposerDraftState;
  composerStateInput: SessionComposerStateInput;
  showWorkingIndicator?: boolean;
  supportsUserInputRequestCustomResponse?: boolean;
};

type SessionConversationBottomPanelDraftControllerProps = Omit<
  SessionConversationBottomPanelControllerProps,
  "draftState"
> &
  Pick<
    SessionComposerDraftState,
    | "clearPendingBlueprintComments"
    | "clearPendingDiffComments"
    | "pendingBlueprintComments"
    | "pendingDiffComments"
  > & {
    draftResetKey: string;
  };

function resolveSinglePendingUserInputRequest(
  entries: readonly ServerRequestEntry[],
): ToolRequestUserInputEntry | null {
  const userInputRequests = entries.filter(
    (entry): entry is ToolRequestUserInputEntry => entry.kind === "tool-user-input",
  );
  if (userInputRequests.length !== 1) {
    return null;
  }

  return userInputRequests[0] ?? null;
}

function SessionConversationMainContentView({
  activeTurnId,
  isTurnInProgress,
  pendingTurnId,
  autoScrollToBottomOnInitialLoad = false,
  initialBottomScrollResetKey = null,
  scrollBehavior = "pin-active-turn-to-top",
  chatEntries,
  onUserMessageAction,
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
  useInitialConversationBottomScrollBehavior({
    chatEntries,
    contentRootRef: pinnedTurnScrollBehavior.threadRootRef,
    enabled: autoScrollToBottomOnInitialLoad,
    resetKey: initialBottomScrollResetKey,
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
        {...(onUserMessageAction === undefined ? {} : { onUserMessageAction })}
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

export const SessionConversationMainContent = memo(SessionConversationMainContentView);
SessionConversationMainContent.displayName = "SessionConversationMainContent";

export function SessionConversationBottomPanel({
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  composerViewModel,
  queuedPrompts = [],
  onRemoveQueuedPrompt,
  showWorkingIndicator = false,
  statusMessage,
}: SessionConversationBottomPanelProps): React.JSX.Element {
  const shouldShowWorkingIndicator = showWorkingIndicator && serverRequestPanelEntries.length === 0;

  return (
    <>
      <ServerRequestsPanel
        entries={serverRequestPanelEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
      />
      {statusMessage === null ? null : <ComposerStatusBanner statusMessage={statusMessage} />}
      {shouldShowWorkingIndicator ? (
        <SessionComposerActivityRow active ariaLabel="Working" text="Working..." />
      ) : null}
      {queuedPrompts.length === 0 ? null : (
        <div className="max-h-40 space-y-2 overflow-y-auto px-1 pr-2">
          {queuedPrompts.map((queuedPrompt) => (
            <ChatUserMessage
              attachments={queuedPrompt.attachments}
              key={queuedPrompt.id}
              label="Queue"
              {...(onRemoveQueuedPrompt === undefined || !queuedPrompt.isRemovable
                ? {}
                : {
                    labelAction: {
                      ariaLabel: "Remove queued message",
                      onClick: () => {
                        onRemoveQueuedPrompt(queuedPrompt.id);
                      },
                    },
                  })}
              text={queuedPrompt.text}
            />
          ))}
        </div>
      )}
      <ChatComposer {...composerViewModel} />
    </>
  );
}

export function SessionConversationBottomPanelController({
  draftState,
  composerStateInput,
  showWorkingIndicator,
  supportsUserInputRequestCustomResponse,
  ...bottomPanelProps
}: SessionConversationBottomPanelControllerProps): React.JSX.Element {
  const userInputRequestCustomResponseTarget = useMemo(() => {
    if (supportsUserInputRequestCustomResponse !== true) {
      return null;
    }

    const pendingUserInputRequest = resolveSinglePendingUserInputRequest(
      bottomPanelProps.serverRequestPanelEntries,
    );
    if (pendingUserInputRequest === null) {
      return null;
    }

    return {
      isResponding: bottomPanelProps.isRespondingToServerRequest,
      requestId: pendingUserInputRequest.requestId,
      respond: bottomPanelProps.onRespondToServerRequest,
    };
  }, [
    bottomPanelProps.isRespondingToServerRequest,
    bottomPanelProps.onRespondToServerRequest,
    bottomPanelProps.serverRequestPanelEntries,
    supportsUserInputRequestCustomResponse,
  ]);
  const composerUiState = useSessionComposerState({
    composerStateInput: {
      ...composerStateInput,
      userInputRequestCustomResponseTarget,
    },
    draftState,
  });

  return (
    <SessionConversationBottomPanel
      {...bottomPanelProps}
      composerViewModel={composerUiState.composerViewModel}
      onRemoveQueuedPrompt={composerUiState.removeQueuedPrompt}
      queuedPrompts={composerUiState.queuedPrompts}
      statusMessage={composerUiState.statusMessage}
      {...(showWorkingIndicator === undefined ? {} : { showWorkingIndicator })}
    />
  );
}

export function SessionConversationBottomPanelDraftController({
  clearPendingBlueprintComments,
  clearPendingDiffComments,
  draftResetKey,
  pendingBlueprintComments,
  pendingDiffComments,
  ...controllerProps
}: SessionConversationBottomPanelDraftControllerProps): React.JSX.Element {
  return (
    <SessionConversationBottomPanelDraftOwner
      key={draftResetKey}
      clearPendingBlueprintComments={clearPendingBlueprintComments}
      clearPendingDiffComments={clearPendingDiffComments}
      controllerProps={controllerProps}
      pendingBlueprintComments={pendingBlueprintComments}
      pendingDiffComments={pendingDiffComments}
    />
  );
}

function SessionConversationBottomPanelDraftOwner({
  clearPendingBlueprintComments,
  clearPendingDiffComments,
  controllerProps,
  pendingBlueprintComments,
  pendingDiffComments,
}: {
  clearPendingBlueprintComments: SessionComposerDraftState["clearPendingBlueprintComments"];
  clearPendingDiffComments: SessionComposerDraftState["clearPendingDiffComments"];
  controllerProps: Omit<SessionConversationBottomPanelControllerProps, "draftState">;
  pendingBlueprintComments: SessionComposerDraftState["pendingBlueprintComments"];
  pendingDiffComments: SessionComposerDraftState["pendingDiffComments"];
}): React.JSX.Element {
  const [composerDraft, setComposerDraft] = useState(() => createComposerDraft(""));

  const handleComposerDraftChange = useCallback(
    (nextComposerDraft: React.SetStateAction<ComposerDraft>): void => {
      setComposerDraft(nextComposerDraft);
    },
    [],
  );

  const draftState = useMemo(
    () => ({
      composerDraft,
      pendingBlueprintComments,
      pendingDiffComments,
      clearPendingBlueprintComments,
      clearPendingDiffComments,
      setComposerDraft: handleComposerDraftChange,
    }),
    [
      clearPendingBlueprintComments,
      clearPendingDiffComments,
      composerDraft,
      handleComposerDraftChange,
      pendingBlueprintComments,
      pendingDiffComments,
    ],
  );

  return <SessionConversationBottomPanelController {...controllerProps} draftState={draftState} />;
}
