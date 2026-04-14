import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  useSessionComposerState,
  type SessionComposerStateInput,
} from "./session-composer/index.js";

type SessionConversationMainContentProps = {
  activeTurnId: string | null;
  isTurnInProgress: boolean;
  pendingTurnId: string | null;
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
  statusMessage: ChatComposerStatusMessage | null;
};

type SessionConversationBottomPanelControllerProps = SessionConversationSharedPanelProps & {
  composerStateInput: SessionComposerStateInput;
};

const PinnedTurnTopInsetPx = 12;

function findPinnedTurnElement(input: {
  pinnedTurnId: string | null;
  threadRootElement: HTMLDivElement;
}): HTMLDivElement | null {
  if (input.pinnedTurnId === null) {
    return null;
  }

  const turnElements = input.threadRootElement.querySelectorAll<HTMLDivElement>("[data-turn-id]");
  for (const turnElement of turnElements) {
    if (turnElement.dataset["turnId"] === input.pinnedTurnId) {
      return turnElement;
    }
  }

  return null;
}

function alignPinnedTurnToContainerTop(input: {
  pinnedTurnElement: HTMLDivElement;
  scrollContainerElement: HTMLDivElement;
}): void {
  const scrollContainerRect = input.scrollContainerElement.getBoundingClientRect();
  const pinnedTurnRect = input.pinnedTurnElement.getBoundingClientRect();
  const scrollDelta = pinnedTurnRect.top - (scrollContainerRect.top + PinnedTurnTopInsetPx);
  if (Math.abs(scrollDelta) < 1) {
    return;
  }

  input.scrollContainerElement.scrollTop += scrollDelta;
}

function measurePinnedTurnSpacerHeight(input: {
  pinnedTurnElement: HTMLDivElement | null;
  scrollContainerElement: HTMLDivElement;
}): number {
  if (input.pinnedTurnElement === null) {
    return 0;
  }

  return Math.max(
    0,
    input.scrollContainerElement.clientHeight - input.pinnedTurnElement.offsetHeight,
  );
}

export function SessionConversationMainContent({
  activeTurnId,
  isTurnInProgress,
  pendingTurnId,
  chatEntries,
  serverRequestPanelEntries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  scrollContainerRef,
}: SessionConversationMainContentProps): React.JSX.Element {
  const threadRootRef = useRef<HTMLDivElement | null>(null);
  const reservedSpacerHeightRef = useRef(0);
  const spacerAlignedTurnIdRef = useRef<string | null>(null);
  const [pinnedTurnId, setPinnedTurnId] = useState<string | null>(null);
  const [reservedSpacerHeight, setReservedSpacerHeight] = useState(0);

  useEffect(() => {
    if (pendingTurnId !== null && pinnedTurnId !== pendingTurnId) {
      setPinnedTurnId(pendingTurnId);
    }
  }, [pendingTurnId, pinnedTurnId]);

  useEffect(() => {
    const hasActiveTurn =
      activeTurnId !== null && chatEntries.some((entry) => entry.turnId === activeTurnId);
    if (isTurnInProgress && hasActiveTurn && pinnedTurnId !== activeTurnId) {
      setPinnedTurnId(activeTurnId);
    }
  }, [activeTurnId, chatEntries, isTurnInProgress, pinnedTurnId]);

  useEffect(() => {
    if (pinnedTurnId === null) {
      return;
    }

    const hasPinnedTurn = chatEntries.some((entry) => entry.turnId === pinnedTurnId);
    if (!hasPinnedTurn) {
      setPinnedTurnId(null);
      reservedSpacerHeightRef.current = 0;
      setReservedSpacerHeight(0);
    }
  }, [chatEntries, pinnedTurnId]);

  useLayoutEffect(() => {
    const scrollContainerElement = scrollContainerRef?.current ?? null;
    const threadRootElement = threadRootRef.current;
    if (scrollContainerElement === null || threadRootElement === null) {
      return;
    }

    let animationFrameId = 0;
    let nestedAnimationFrameId = 0;
    const updateReservedSpacerHeight = (): void => {
      const pinnedTurnElement = findPinnedTurnElement({
        pinnedTurnId,
        threadRootElement,
      });

      const nextReservedSpacerHeight = measurePinnedTurnSpacerHeight({
        pinnedTurnElement,
        scrollContainerElement,
      });
      if (reservedSpacerHeightRef.current !== nextReservedSpacerHeight) {
        reservedSpacerHeightRef.current = nextReservedSpacerHeight;
        setReservedSpacerHeight(nextReservedSpacerHeight);
      }
    };

    updateReservedSpacerHeight();
    animationFrameId = requestAnimationFrame(() => {
      updateReservedSpacerHeight();
      nestedAnimationFrameId = requestAnimationFrame(() => {
        updateReservedSpacerHeight();
      });
    });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelAnimationFrame(animationFrameId);
        cancelAnimationFrame(nestedAnimationFrameId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateReservedSpacerHeight();
    });

    resizeObserver.observe(scrollContainerElement);
    resizeObserver.observe(threadRootElement);

    return () => {
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(nestedAnimationFrameId);
      resizeObserver.disconnect();
    };
  }, [chatEntries, pinnedTurnId, scrollContainerRef]);

  useLayoutEffect(() => {
    if (pinnedTurnId === null) {
      spacerAlignedTurnIdRef.current = null;
      return;
    }

    const scrollContainerElement = scrollContainerRef?.current ?? null;
    const threadRootElement = threadRootRef.current;
    if (scrollContainerElement === null || threadRootElement === null) {
      return;
    }

    let animationFrameId = 0;
    let nestedAnimationFrameId = 0;
    const alignPinnedTurn = (): void => {
      const pinnedTurnElement = findPinnedTurnElement({
        pinnedTurnId,
        threadRootElement,
      });
      if (pinnedTurnElement === null) {
        return;
      }

      alignPinnedTurnToContainerTop({
        pinnedTurnElement,
        scrollContainerElement,
      });
    };

    alignPinnedTurn();
    animationFrameId = requestAnimationFrame(() => {
      alignPinnedTurn();
      nestedAnimationFrameId = requestAnimationFrame(() => {
        alignPinnedTurn();
      });
    });

    spacerAlignedTurnIdRef.current = null;
    return () => {
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(nestedAnimationFrameId);
    };
  }, [pinnedTurnId, scrollContainerRef]);

  useLayoutEffect(() => {
    if (pinnedTurnId === null || reservedSpacerHeight === 0) {
      return;
    }

    if (spacerAlignedTurnIdRef.current === pinnedTurnId) {
      return;
    }

    const scrollContainerElement = scrollContainerRef?.current ?? null;
    const threadRootElement = threadRootRef.current;
    if (scrollContainerElement === null || threadRootElement === null) {
      return;
    }

    const animationFrameId = requestAnimationFrame(() => {
      const pinnedTurnElement = findPinnedTurnElement({
        pinnedTurnId,
        threadRootElement,
      });
      if (pinnedTurnElement === null) {
        return;
      }

      alignPinnedTurnToContainerTop({
        pinnedTurnElement,
        scrollContainerElement,
      });
      spacerAlignedTurnIdRef.current = pinnedTurnId;
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [pinnedTurnId, reservedSpacerHeight, scrollContainerRef]);

  return (
    <div ref={threadRootRef} style={pinnedTurnId === null ? undefined : { overflowAnchor: "none" }}>
      <ChatThread
        entries={chatEntries}
        isRespondingToServerRequest={isRespondingToServerRequest}
        onRespondToServerRequest={onRespondToServerRequest}
        pendingServerRequests={serverRequestPanelEntries}
      />
      {pinnedTurnId === null ? null : (
        <div
          aria-hidden="true"
          data-slot="conversation-bottom-spacer"
          style={{ height: `${reservedSpacerHeight}px` }}
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
      <ChatComposer {...composerViewModel} />
    </>
  );
}

export function SessionConversationBottomPanelController({
  composerStateInput,
  ...bottomPanelProps
}: SessionConversationBottomPanelControllerProps): React.JSX.Element {
  const composerUiState = useSessionComposerState(composerStateInput);

  return (
    <SessionConversationBottomPanel
      {...bottomPanelProps}
      composerViewModel={composerUiState.composerViewModel}
      statusMessage={composerUiState.statusMessage}
    />
  );
}
