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
  SessionComposerActivityRow,
  useSessionComposerState,
  type SessionComposerStateInput,
} from "./session-composer/index.js";

type SessionConversationMainContentProps = {
  activeTurnId: string | null;
  isTurnInProgress: boolean;
  pendingTurnId: string | null;
  scrollBehavior?: "pin-active-turn-to-top" | "follow-streaming-at-bottom" | "none";
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
  composerStateInput: SessionComposerStateInput;
  showWorkingIndicator?: boolean;
};

const PinnedTurnTopInsetPx = 12;
const ScrollFollowBottomThresholdPx = 24;

function findPinnedTurnElement(input: {
  pinnedTurnId: string | null;
  threadRootElement: HTMLDivElement;
}): HTMLDivElement | null {
  if (input.pinnedTurnId === null) {
    return null;
  }

  const turnElements = input.threadRootElement.querySelectorAll<HTMLDivElement>("[data-turn-id]");
  for (const turnElement of Array.from(turnElements)) {
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

function hasStreamingChatEntries(chatEntries: readonly ChatEntry[]): boolean {
  return chatEntries.some((entry) => entry.status === "streaming");
}

function isScrollContainerNearBottom(scrollContainerElement: HTMLDivElement): boolean {
  const remainingScrollDistance =
    scrollContainerElement.scrollHeight -
    scrollContainerElement.clientHeight -
    scrollContainerElement.scrollTop;
  return remainingScrollDistance <= ScrollFollowBottomThresholdPx;
}

function scrollContainerToBottom(scrollContainerElement: HTMLDivElement): void {
  const targetScrollTop = Math.max(
    0,
    scrollContainerElement.scrollHeight - scrollContainerElement.clientHeight,
  );
  if (Math.abs(scrollContainerElement.scrollTop - targetScrollTop) < 1) {
    return;
  }

  scrollContainerElement.scrollTop = targetScrollTop;
}

function usePinnedTurnToTopScrollBehavior(input: {
  activeTurnId: string | null;
  isTurnInProgress: boolean;
  pendingTurnId: string | null;
  chatEntries: readonly ChatEntry[];
  enabled: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null> | undefined;
}): {
  pinnedTurnId: string | null;
  reservedSpacerHeight: number;
  threadRootRef: React.RefObject<HTMLDivElement | null>;
} {
  const threadRootRef = useRef<HTMLDivElement | null>(null);
  const reservedSpacerHeightRef = useRef(0);
  const spacerAlignedTurnIdRef = useRef<string | null>(null);
  const [pinnedTurnId, setPinnedTurnId] = useState<string | null>(null);
  const [reservedSpacerHeight, setReservedSpacerHeight] = useState(0);

  useEffect(() => {
    if (!input.enabled) {
      return;
    }

    if (input.pendingTurnId !== null && pinnedTurnId !== input.pendingTurnId) {
      setPinnedTurnId(input.pendingTurnId);
    }
  }, [input.enabled, input.pendingTurnId, pinnedTurnId]);

  useEffect(() => {
    if (!input.enabled) {
      return;
    }

    const hasActiveTurn =
      input.activeTurnId !== null &&
      input.chatEntries.some((entry) => entry.turnId === input.activeTurnId);
    if (input.isTurnInProgress && hasActiveTurn && pinnedTurnId !== input.activeTurnId) {
      setPinnedTurnId(input.activeTurnId);
    }
  }, [input.activeTurnId, input.chatEntries, input.enabled, input.isTurnInProgress, pinnedTurnId]);

  useEffect(() => {
    if (!input.enabled) {
      if (
        pinnedTurnId !== null ||
        reservedSpacerHeightRef.current !== 0 ||
        reservedSpacerHeight !== 0
      ) {
        setPinnedTurnId(null);
        reservedSpacerHeightRef.current = 0;
        setReservedSpacerHeight(0);
      }
      return;
    }

    if (pinnedTurnId === null) {
      return;
    }

    const hasPinnedTurn = input.chatEntries.some((entry) => entry.turnId === pinnedTurnId);
    if (!hasPinnedTurn) {
      setPinnedTurnId(null);
      reservedSpacerHeightRef.current = 0;
      setReservedSpacerHeight(0);
    }
  }, [input.chatEntries, input.enabled, pinnedTurnId, reservedSpacerHeight]);

  useLayoutEffect(() => {
    if (!input.enabled) {
      return;
    }

    const scrollContainerElement = input.scrollContainerRef?.current ?? null;
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
  }, [input.chatEntries, input.enabled, pinnedTurnId, input.scrollContainerRef]);

  useLayoutEffect(() => {
    if (!input.enabled) {
      spacerAlignedTurnIdRef.current = null;
      return;
    }

    if (pinnedTurnId === null) {
      spacerAlignedTurnIdRef.current = null;
      return;
    }

    const scrollContainerElement = input.scrollContainerRef?.current ?? null;
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
  }, [input.enabled, pinnedTurnId, input.scrollContainerRef]);

  useLayoutEffect(() => {
    if (!input.enabled) {
      return;
    }

    if (pinnedTurnId === null || reservedSpacerHeight === 0) {
      return;
    }

    if (spacerAlignedTurnIdRef.current === pinnedTurnId) {
      return;
    }

    const scrollContainerElement = input.scrollContainerRef?.current ?? null;
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
  }, [input.enabled, pinnedTurnId, reservedSpacerHeight, input.scrollContainerRef]);

  return {
    pinnedTurnId,
    reservedSpacerHeight,
    threadRootRef,
  };
}

function useFollowStreamingAtBottomScrollBehavior(input: {
  chatEntries: readonly ChatEntry[];
  enabled: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null> | undefined;
}): void {
  const shouldAutoFollowBottomRef = useRef(true);
  const previousScrollHeightRef = useRef(0);
  const hasStreamingEntries = hasStreamingChatEntries(input.chatEntries);

  useEffect(() => {
    const scrollContainerElement = input.scrollContainerRef?.current ?? null;
    if (scrollContainerElement === null) {
      return;
    }

    previousScrollHeightRef.current = scrollContainerElement.scrollHeight;

    const updateShouldAutoFollowBottom = (): void => {
      shouldAutoFollowBottomRef.current = isScrollContainerNearBottom(scrollContainerElement);
    };

    updateShouldAutoFollowBottom();
    scrollContainerElement.addEventListener("scroll", updateShouldAutoFollowBottom, {
      passive: true,
    });

    return () => {
      scrollContainerElement.removeEventListener("scroll", updateShouldAutoFollowBottom);
    };
  }, [input.scrollContainerRef]);

  useLayoutEffect(() => {
    if (!input.enabled) {
      return;
    }

    if (!hasStreamingEntries) {
      return;
    }

    if (!shouldAutoFollowBottomRef.current) {
      return;
    }

    const scrollContainerElement = input.scrollContainerRef?.current ?? null;
    if (scrollContainerElement === null) {
      return;
    }

    let animationFrameId = 0;
    let nestedAnimationFrameId = 0;
    const previousScrollHeight = previousScrollHeightRef.current;
    const wasNearBottomBeforeUpdate =
      previousScrollHeight === 0 ||
      previousScrollHeight -
        scrollContainerElement.clientHeight -
        scrollContainerElement.scrollTop <=
        ScrollFollowBottomThresholdPx;

    const followStreamingContent = (): void => {
      scrollContainerToBottom(scrollContainerElement);
      previousScrollHeightRef.current = scrollContainerElement.scrollHeight;
      shouldAutoFollowBottomRef.current = isScrollContainerNearBottom(scrollContainerElement);
    };

    if (shouldAutoFollowBottomRef.current || wasNearBottomBeforeUpdate) {
      followStreamingContent();
    } else {
      previousScrollHeightRef.current = scrollContainerElement.scrollHeight;
    }

    animationFrameId = requestAnimationFrame(() => {
      if (shouldAutoFollowBottomRef.current || wasNearBottomBeforeUpdate) {
        followStreamingContent();
      } else {
        previousScrollHeightRef.current = scrollContainerElement.scrollHeight;
      }
      nestedAnimationFrameId = requestAnimationFrame(() => {
        if (shouldAutoFollowBottomRef.current || wasNearBottomBeforeUpdate) {
          followStreamingContent();
          return;
        }

        previousScrollHeightRef.current = scrollContainerElement.scrollHeight;
      });
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(nestedAnimationFrameId);
    };
  }, [input.chatEntries, input.enabled, hasStreamingEntries, input.scrollContainerRef]);
}

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
  composerStateInput,
  showWorkingIndicator,
  ...bottomPanelProps
}: SessionConversationBottomPanelControllerProps): React.JSX.Element {
  const composerUiState = useSessionComposerState(composerStateInput);

  return (
    <SessionConversationBottomPanel
      {...bottomPanelProps}
      composerViewModel={composerUiState.composerViewModel}
      statusMessage={composerUiState.statusMessage}
      {...(showWorkingIndicator === undefined ? {} : { showWorkingIndicator })}
    />
  );
}
