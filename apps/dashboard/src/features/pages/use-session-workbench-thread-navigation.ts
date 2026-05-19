import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { projectCodexThreadNavigatorRows } from "../session-agents/codex/codex-thread-navigator-model.js";
import type { CodexThreadNavigatorProps } from "../session-agents/codex/codex-thread-navigator.js";
import type { MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import {
  shouldAttemptRequestedThreadResume,
  type RequestedThreadResumeAttempt,
} from "./session-requested-thread-resume-policy.js";
import type { SessionConversationPaneState } from "./use-session-workbench-conversation-runtime.js";

type SetSearchParams = (nextSearchParams: URLSearchParams) => void;

type SessionWorkbenchThreadNavigationInput = {
  codexThreadNavigator: SessionConversationPaneState["codexThreadNavigator"];
  closeDiffPanel: () => void;
  isDiffPanelVisible: boolean;
  pendingServerRequests: SessionConversationPaneState["serverRequestsState"]["pendingServerRequests"];
  primaryPanelTransitionState: MainPanelTransitionState;
  primaryRepositoryPath: string | null;
  requestedThreadId: string | null;
  sandboxInstanceId: string | null;
  searchParams: URLSearchParams;
  setSearchParams: SetSearchParams;
};

export type SessionWorkbenchThreadNavigationState = {
  closePanel: () => void;
  isDiffPanelActive: boolean;
  isPanelVisible: boolean;
  secondaryPanelKind: "diff" | "threads" | null;
  threadNavigatorProps: CodexThreadNavigatorProps | null;
  togglePanel: () => void;
};

export function resolveThreadNavigatorPanelVisibility(input: {
  explicitPanelVisibility: boolean | null;
  isDiffPanelVisible: boolean;
  unarchivedThreadCount: number;
}): boolean {
  if (input.explicitPanelVisibility !== null) {
    return input.explicitPanelVisibility;
  }

  return !input.isDiffPanelVisible && input.unarchivedThreadCount > 1;
}

export function createConfirmedThreadSearchParams(input: {
  searchParams: URLSearchParams;
  threadId: string;
}): URLSearchParams {
  const nextSearchParams = new URLSearchParams(input.searchParams);
  nextSearchParams.set("threadId", input.threadId);
  return nextSearchParams;
}

export function useSessionWorkbenchThreadNavigation(
  input: SessionWorkbenchThreadNavigationInput,
): SessionWorkbenchThreadNavigationState {
  const [explicitPanelVisibility, setExplicitPanelVisibility] = useState<boolean | null>(null);
  const [hasManualNavigationCommitPending, setManualNavigationCommitPending] = useState(false);
  const [manualNavigationTargetThreadId, setManualNavigationTargetThreadId] = useState<
    string | null
  >(null);
  const requestedThreadResumeAttemptRef = useRef<RequestedThreadResumeAttempt | null>(null);
  const threadNavigationRequestSequenceRef = useRef(0);

  const pendingThreadServerRequestThreadIds = useMemo(() => {
    return input.pendingServerRequests.flatMap((entry) => {
      if (entry.kind === "command-approval" || entry.kind === "file-change-approval") {
        return [entry.threadId];
      }

      return [];
    });
  }, [input.pendingServerRequests]);

  const threadNavigatorRows = useMemo(() => {
    if (input.codexThreadNavigator === null) {
      return [];
    }

    return projectCodexThreadNavigatorRows({
      activeThreadId: input.codexThreadNavigator.activeThreadId,
      activeThread:
        input.codexThreadNavigator.activeThreadId === null
          ? null
          : {
              id: input.codexThreadNavigator.activeThreadId,
              cwd: input.codexThreadNavigator.activeThreadCwd,
            },
      availableThreads: input.codexThreadNavigator.availableThreads,
      pendingThreadId: input.codexThreadNavigator.pendingThreadId,
      pendingServerRequestThreadIds: pendingThreadServerRequestThreadIds,
    });
  }, [input.codexThreadNavigator, pendingThreadServerRequestThreadIds]);

  const pushThreadSearchParams = useCallback(
    (threadId: string): void => {
      input.setSearchParams(
        createConfirmedThreadSearchParams({
          searchParams: input.searchParams,
          threadId,
        }),
      );
    },
    [input.searchParams, input.setSearchParams],
  );

  const handleSelectThread = useCallback(
    (threadId: string): void => {
      if (input.codexThreadNavigator === null) {
        return;
      }

      const navigationRequestId = threadNavigationRequestSequenceRef.current + 1;
      threadNavigationRequestSequenceRef.current = navigationRequestId;
      setManualNavigationCommitPending(true);
      setManualNavigationTargetThreadId(threadId);

      if (threadId === input.codexThreadNavigator.activeThreadId) {
        pushThreadSearchParams(threadId);
        return;
      }

      void input.codexThreadNavigator
        .resumeThread(threadId)
        .then((confirmedThreadId) => {
          if (threadNavigationRequestSequenceRef.current !== navigationRequestId) {
            return;
          }

          setManualNavigationTargetThreadId(confirmedThreadId);
          pushThreadSearchParams(confirmedThreadId);
        })
        .catch(() => {
          if (threadNavigationRequestSequenceRef.current !== navigationRequestId) {
            return;
          }

          setManualNavigationCommitPending(false);
          setManualNavigationTargetThreadId(null);
        });
    },
    [input.codexThreadNavigator, pushThreadSearchParams],
  );

  const handleStartThread = useCallback((): void => {
    if (input.codexThreadNavigator === null) {
      return;
    }

    const navigationRequestId = threadNavigationRequestSequenceRef.current + 1;
    threadNavigationRequestSequenceRef.current = navigationRequestId;
    setManualNavigationCommitPending(true);
    setManualNavigationTargetThreadId(null);

    void input.codexThreadNavigator
      .startNewThread(
        input.primaryRepositoryPath === null ? undefined : { cwd: input.primaryRepositoryPath },
      )
      .then((threadId) => {
        if (threadNavigationRequestSequenceRef.current !== navigationRequestId) {
          return;
        }

        setManualNavigationTargetThreadId(threadId);
        input.setSearchParams(
          createConfirmedThreadSearchParams({
            searchParams: input.searchParams,
            threadId,
          }),
        );
      })
      .catch(() => {
        if (threadNavigationRequestSequenceRef.current !== navigationRequestId) {
          return;
        }

        setManualNavigationCommitPending(false);
        setManualNavigationTargetThreadId(null);
      });
  }, [
    input.codexThreadNavigator,
    input.primaryRepositoryPath,
    input.searchParams,
    input.setSearchParams,
  ]);

  useEffect(() => {
    if (
      manualNavigationTargetThreadId === null ||
      input.requestedThreadId !== manualNavigationTargetThreadId
    ) {
      return;
    }

    setManualNavigationCommitPending(false);
    setManualNavigationTargetThreadId(null);
  }, [input.requestedThreadId, manualNavigationTargetThreadId]);

  useEffect(() => {
    if (input.requestedThreadId === null) {
      requestedThreadResumeAttemptRef.current = null;
      return;
    }

    if (input.codexThreadNavigator === null) {
      return;
    }

    if (
      !shouldAttemptRequestedThreadResume({
        activeThreadId: input.codexThreadNavigator.activeThreadId,
        hasInFlightThreadNavigation:
          input.codexThreadNavigator.pendingThreadId !== null ||
          input.codexThreadNavigator.isStartingNewThread ||
          hasManualNavigationCommitPending,
        previousAttempt: requestedThreadResumeAttemptRef.current,
        providerThreadId: input.codexThreadNavigator.providerThreadId,
        requestedThreadId: input.requestedThreadId,
        sandboxInstanceId: input.sandboxInstanceId,
      })
    ) {
      return;
    }

    requestedThreadResumeAttemptRef.current = {
      sandboxInstanceId: input.sandboxInstanceId,
      threadId: input.requestedThreadId,
    };
    threadNavigationRequestSequenceRef.current += 1;
    void input.codexThreadNavigator.resumeThread(input.requestedThreadId).catch(() => {});
  }, [
    input.codexThreadNavigator,
    input.requestedThreadId,
    input.sandboxInstanceId,
    hasManualNavigationCommitPending,
  ]);

  const threadNavigatorProps: CodexThreadNavigatorProps | null =
    input.codexThreadNavigator !== null && input.primaryPanelTransitionState !== "stable_cli"
      ? {
          isStartingThread: input.codexThreadNavigator.isStartingNewThread,
          isThreadListLimited: input.codexThreadNavigator.hasMoreAvailableThreads,
          onRefreshThreads: input.codexThreadNavigator.refreshThreadList,
          onSelectThread: handleSelectThread,
          onStartThread: handleStartThread,
          rows: threadNavigatorRows,
        }
      : null;
  const resolvedThreadPanelVisibility = resolveThreadNavigatorPanelVisibility({
    explicitPanelVisibility,
    isDiffPanelVisible: input.isDiffPanelVisible,
    unarchivedThreadCount: input.codexThreadNavigator?.availableThreads.length ?? 0,
  });
  const isPanelVisible = threadNavigatorProps !== null && resolvedThreadPanelVisibility;
  const secondaryPanelKind = isPanelVisible ? "threads" : input.isDiffPanelVisible ? "diff" : null;
  const isDiffPanelActive = input.isDiffPanelVisible && !isPanelVisible;
  const closePanel = useCallback((): void => {
    setExplicitPanelVisibility(false);
  }, []);
  const togglePanel = useCallback((): void => {
    const nextValue = !isPanelVisible;
    if (nextValue) {
      input.closeDiffPanel();
    }

    setExplicitPanelVisibility(nextValue);
  }, [input.closeDiffPanel, isPanelVisible]);

  return {
    closePanel,
    isDiffPanelActive,
    isPanelVisible,
    secondaryPanelKind,
    threadNavigatorProps,
    togglePanel,
  };
}
