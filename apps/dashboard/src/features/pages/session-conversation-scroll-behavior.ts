import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { ChatEntry } from "../chat/chat-types.js";

export type SessionConversationScrollBehavior =
  | "pin-active-turn-to-top"
  | "follow-streaming-at-bottom"
  | "none";

const PinnedTurnTopInsetPx = 12;
const ScrollFollowBottomThresholdPx = 24;
const InitialBottomScrollMaxFrameAttempts = 30;

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

export function usePinnedTurnToTopScrollBehavior(input: {
  activeTurnId: string | null;
  isTurnInProgress: boolean;
  pendingTurnId: string | null;
  chatEntries: readonly ChatEntry[];
  enabled: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null> | undefined;
}): {
  pinnedTurnId: string | null;
  reservedSpacerHeight: number;
  threadRootRef: RefObject<HTMLDivElement | null>;
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

export function useFollowStreamingAtBottomScrollBehavior(input: {
  chatEntries: readonly ChatEntry[];
  enabled: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null> | undefined;
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

export function useInitialConversationBottomScrollBehavior(input: {
  chatEntries: readonly ChatEntry[];
  contentRootRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  resetKey: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null> | undefined;
}): void {
  const hasAppliedInitialBottomScrollRef = useRef(false);
  const appliedResetKeyRef = useRef<string | null>(input.resetKey);

  if (appliedResetKeyRef.current !== input.resetKey) {
    appliedResetKeyRef.current = input.resetKey;
    hasAppliedInitialBottomScrollRef.current = false;
  }

  useLayoutEffect(() => {
    if (!input.enabled) {
      return;
    }

    if (hasAppliedInitialBottomScrollRef.current) {
      return;
    }

    if (input.chatEntries.length === 0) {
      return;
    }

    let animationFrameId = 0;
    let frameAttemptCount = 0;
    const scrollToBottomIfReady = (): boolean => {
      if (hasAppliedInitialBottomScrollRef.current) {
        return true;
      }

      const scrollContainerElement = input.scrollContainerRef?.current ?? null;
      if (scrollContainerElement === null) {
        return false;
      }

      if (scrollContainerElement.scrollHeight <= scrollContainerElement.clientHeight) {
        return false;
      }

      scrollContainerToBottom(scrollContainerElement);
      hasAppliedInitialBottomScrollRef.current = true;
      return true;
    };
    const requestNextFrameAttempt = (): void => {
      animationFrameId = requestAnimationFrame(() => {
        if (scrollToBottomIfReady()) {
          return;
        }

        frameAttemptCount += 1;
        if (frameAttemptCount < InitialBottomScrollMaxFrameAttempts) {
          requestNextFrameAttempt();
        }
      });
    };

    if (!scrollToBottomIfReady()) {
      requestNextFrameAttempt();
    }

    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelAnimationFrame(animationFrameId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      scrollToBottomIfReady();
    });

    const scrollContainerElement = input.scrollContainerRef?.current ?? null;
    if (scrollContainerElement !== null) {
      resizeObserver.observe(scrollContainerElement);
    }

    const contentRootElement = input.contentRootRef.current;
    if (contentRootElement !== null) {
      resizeObserver.observe(contentRootElement);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [
    input.chatEntries,
    input.contentRootRef,
    input.enabled,
    input.resetKey,
    input.scrollContainerRef,
  ]);
}
