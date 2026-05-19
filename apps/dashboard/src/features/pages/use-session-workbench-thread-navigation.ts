import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  projectCodexThreadNavigatorRows,
  resolveDefaultCodexThreadId,
} from "../session-agents/codex/codex-thread-navigator-model.js";
import type { CodexThreadNavigatorRow } from "../session-agents/codex/codex-thread-navigator-model.js";
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
  activeHeaderRow: CodexThreadNavigatorRow | null;
  closePanel: () => void;
  isDiffPanelActive: boolean;
  isPanelVisible: boolean;
  panelThreadNavigatorProps: CodexThreadNavigatorProps | null;
  secondaryPanelKind: "diff" | "threads" | null;
  togglePanel: () => void;
};

export function useSessionWorkbenchThreadNavigation(
  input: SessionWorkbenchThreadNavigationInput,
): SessionWorkbenchThreadNavigationState {
  const [isPanelVisible, setPanelVisible] = useState(false);
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

  const defaultThreadId = useMemo(() => {
    if (input.codexThreadNavigator === null) {
      return null;
    }

    return resolveDefaultCodexThreadId({
      availableThreads: input.codexThreadNavigator.availableThreads,
    });
  }, [input.codexThreadNavigator]);

  const activeHeaderRow = useMemo(() => {
    return threadNavigatorRows.find((row) => row.isActive) ?? null;
  }, [threadNavigatorRows]);

  const pushThreadSearchParams = useCallback(
    (threadId: string): void => {
      const nextSearchParams = new URLSearchParams(input.searchParams);
      if (threadId === defaultThreadId) {
        nextSearchParams.delete("threadId");
      } else {
        nextSearchParams.set("threadId", threadId);
      }

      input.setSearchParams(nextSearchParams);
    },
    [defaultThreadId, input.searchParams, input.setSearchParams],
  );

  const handleSelectThread = useCallback(
    (threadId: string): void => {
      if (input.codexThreadNavigator === null) {
        return;
      }

      const navigationRequestId = threadNavigationRequestSequenceRef.current + 1;
      threadNavigationRequestSequenceRef.current = navigationRequestId;

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

          pushThreadSearchParams(confirmedThreadId);
        })
        .catch(() => {});
    },
    [input.codexThreadNavigator, pushThreadSearchParams],
  );

  const handleStartThread = useCallback((): void => {
    if (input.codexThreadNavigator === null) {
      return;
    }

    const navigationRequestId = threadNavigationRequestSequenceRef.current + 1;
    threadNavigationRequestSequenceRef.current = navigationRequestId;

    void input.codexThreadNavigator
      .startNewThread(
        input.primaryRepositoryPath === null ? undefined : { cwd: input.primaryRepositoryPath },
      )
      .then((threadId) => {
        if (threadNavigationRequestSequenceRef.current !== navigationRequestId) {
          return;
        }

        const nextSearchParams = new URLSearchParams(input.searchParams);
        nextSearchParams.set("threadId", threadId);
        input.setSearchParams(nextSearchParams);
      })
      .catch(() => {});
  }, [
    input.codexThreadNavigator,
    input.primaryRepositoryPath,
    input.searchParams,
    input.setSearchParams,
  ]);

  const handleSelectThreadFromPanel = useCallback(
    (threadId: string): void => {
      setPanelVisible(false);
      handleSelectThread(threadId);
    },
    [handleSelectThread],
  );

  const handleStartThreadFromPanel = useCallback((): void => {
    setPanelVisible(false);
    handleStartThread();
  }, [handleStartThread]);

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
  }, [input.codexThreadNavigator, input.requestedThreadId, input.sandboxInstanceId]);

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
  const panelThreadNavigatorProps: CodexThreadNavigatorProps | null =
    threadNavigatorProps === null
      ? null
      : {
          ...threadNavigatorProps,
          onSelectThread: handleSelectThreadFromPanel,
          onStartThread: handleStartThreadFromPanel,
        };
  const secondaryPanelKind =
    panelThreadNavigatorProps !== null && isPanelVisible
      ? "threads"
      : input.isDiffPanelVisible
        ? "diff"
        : null;
  const isDiffPanelActive = input.isDiffPanelVisible && !isPanelVisible;
  const closePanel = useCallback((): void => {
    setPanelVisible(false);
  }, []);
  const togglePanel = useCallback((): void => {
    setPanelVisible((currentValue) => {
      const nextValue = !currentValue;
      if (nextValue) {
        input.closeDiffPanel();
      }

      return nextValue;
    });
  }, [input.closeDiffPanel]);

  return {
    activeHeaderRow,
    closePanel,
    isDiffPanelActive,
    isPanelVisible,
    panelThreadNavigatorProps,
    secondaryPanelKind,
    togglePanel,
  };
}
