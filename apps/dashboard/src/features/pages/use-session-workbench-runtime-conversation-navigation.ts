import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { projectRuntimeConversationNavigatorRows } from "../session-agents/runtime-conversations/runtime-conversation-navigator-model.js";
import type { RuntimeConversationNavigatorProps } from "../session-agents/runtime-conversations/runtime-conversation-navigator.js";
import type { ServerRequestEntry } from "../session-agents/server-requests/index.js";
import type { MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import type { SessionConversationPaneState } from "./use-session-workbench-conversation-runtime.js";

type SetSearchParams = (nextSearchParams: URLSearchParams) => void;

type RequestedRuntimeConversationResumeAttempt = {
  conversationId: string;
  sandboxInstanceId: string | null;
};

type SessionWorkbenchRuntimeConversationNavigationInput = {
  runtimeConversationNavigator: SessionConversationPaneState["runtimeConversationNavigator"];
  closeDiffPanel: () => void;
  isDiffPanelVisible: boolean;
  pendingServerRequests: SessionConversationPaneState["serverRequestsState"]["pendingServerRequests"];
  primaryPanelTransitionState: MainPanelTransitionState;
  primaryRepositoryPath: string | null;
  requestedRuntimeConversationId: string | null;
  sandboxInstanceId: string | null;
  searchParams: URLSearchParams;
  setSearchParams: SetSearchParams;
};

export type SessionWorkbenchRuntimeConversationNavigationState = {
  closePanel: () => void;
  isDiffPanelActive: boolean;
  isPanelVisible: boolean;
  runtimeConversationNavigatorProps: RuntimeConversationNavigatorProps | null;
  secondaryPanelKind: "diff" | "conversations" | null;
  togglePanel: () => void;
};

export function resolveRuntimeConversationNavigatorPanelVisibility(input: {
  explicitPanelVisibility: boolean | null;
  isDiffPanelVisible: boolean;
  conversationCount: number;
}): boolean {
  if (input.explicitPanelVisibility !== null) {
    return input.explicitPanelVisibility;
  }

  return !input.isDiffPanelVisible && input.conversationCount > 1;
}

export function createConfirmedRuntimeConversationSearchParams(input: {
  searchParams: URLSearchParams;
  runtimeConversationId: string;
}): URLSearchParams {
  const nextSearchParams = new URLSearchParams(input.searchParams);
  nextSearchParams.delete("threadId");
  nextSearchParams.set("conversationId", input.runtimeConversationId);
  return nextSearchParams;
}

function shouldAttemptRequestedRuntimeConversationResume(input: {
  activeConversationId: string | null;
  hasInFlightRuntimeConversationNavigation: boolean;
  previousAttempt: RequestedRuntimeConversationResumeAttempt | null;
  providerConversationId: string | null;
  requestedRuntimeConversationId: string | null;
  sandboxInstanceId: string | null;
}): boolean {
  if (input.requestedRuntimeConversationId === null) {
    return false;
  }

  if (input.hasInFlightRuntimeConversationNavigation) {
    return false;
  }

  if (input.requestedRuntimeConversationId === input.activeConversationId) {
    return false;
  }

  if (
    input.providerConversationId !== null &&
    (input.activeConversationId === null ||
      input.activeConversationId === input.providerConversationId)
  ) {
    return false;
  }

  return (
    input.previousAttempt === null ||
    input.previousAttempt.sandboxInstanceId !== input.sandboxInstanceId ||
    input.previousAttempt.conversationId !== input.requestedRuntimeConversationId
  );
}

function getPendingServerRequestConversationId(entry: ServerRequestEntry): string | null {
  if (entry.kind === "command-approval" || entry.kind === "file-change-approval") {
    return entry.threadId;
  }

  if (entry.kind === "opencode-permission") {
    return entry.sessionId;
  }

  return null;
}

export function useSessionWorkbenchRuntimeConversationNavigation(
  input: SessionWorkbenchRuntimeConversationNavigationInput,
): SessionWorkbenchRuntimeConversationNavigationState {
  const [explicitPanelVisibility, setExplicitPanelVisibility] = useState<boolean | null>(null);
  const [hasManualNavigationCommitPending, setManualNavigationCommitPending] = useState(false);
  const [manualNavigationTargetConversationId, setManualNavigationTargetConversationId] = useState<
    string | null
  >(null);
  const requestedConversationResumeAttemptRef =
    useRef<RequestedRuntimeConversationResumeAttempt | null>(null);
  const conversationNavigationRequestSequenceRef = useRef(0);

  const pendingServerRequestConversationIds = useMemo(
    () =>
      input.pendingServerRequests.flatMap((entry) => {
        const conversationId = getPendingServerRequestConversationId(entry);
        return conversationId === null ? [] : [conversationId];
      }),
    [input.pendingServerRequests],
  );

  const navigatorRows = useMemo(() => {
    if (input.runtimeConversationNavigator === null) {
      return [];
    }

    return projectRuntimeConversationNavigatorRows({
      activeConversationId: input.runtimeConversationNavigator.activeConversationId,
      activeConversation:
        input.runtimeConversationNavigator.activeConversationId === null
          ? null
          : {
              id: input.runtimeConversationNavigator.activeConversationId,
              cwd: input.runtimeConversationNavigator.activeConversationCwd,
            },
      availableConversations: input.runtimeConversationNavigator.availableConversations,
      originalConversationId: input.runtimeConversationNavigator.originalConversationId,
      pendingConversationId: input.runtimeConversationNavigator.pendingConversationId,
      pendingServerRequestConversationIds,
    });
  }, [input.runtimeConversationNavigator, pendingServerRequestConversationIds]);
  const refreshConversationList =
    input.runtimeConversationNavigator?.refreshConversationList ?? null;
  const refreshConversationListRef = useRef(refreshConversationList);
  const hasRuntimeConversationNavigator = input.runtimeConversationNavigator !== null;

  useEffect(() => {
    refreshConversationListRef.current = refreshConversationList;
  }, [refreshConversationList]);

  const pushConversationSearchParams = useCallback(
    (conversationId: string): void => {
      input.setSearchParams(
        createConfirmedRuntimeConversationSearchParams({
          searchParams: input.searchParams,
          runtimeConversationId: conversationId,
        }),
      );
    },
    [input.searchParams, input.setSearchParams],
  );

  const handleSelectConversation = useCallback(
    (conversationId: string): void => {
      if (input.runtimeConversationNavigator === null) {
        return;
      }

      const navigationRequestId = conversationNavigationRequestSequenceRef.current + 1;
      conversationNavigationRequestSequenceRef.current = navigationRequestId;
      setManualNavigationCommitPending(true);
      setManualNavigationTargetConversationId(conversationId);
      const selectedRow = navigatorRows.find((row) => row.id === conversationId);

      if (conversationId === input.runtimeConversationNavigator.activeConversationId) {
        pushConversationSearchParams(conversationId);
        return;
      }

      void input.runtimeConversationNavigator
        .resumeConversation(
          conversationId,
          selectedRow === undefined ? undefined : { cwd: selectedRow.cwd },
        )
        .then((confirmedConversationId) => {
          if (conversationNavigationRequestSequenceRef.current !== navigationRequestId) {
            return;
          }

          setManualNavigationTargetConversationId(confirmedConversationId);
          pushConversationSearchParams(confirmedConversationId);
        })
        .catch(() => {
          if (conversationNavigationRequestSequenceRef.current !== navigationRequestId) {
            return;
          }

          setManualNavigationCommitPending(false);
          setManualNavigationTargetConversationId(null);
        });
    },
    [input.runtimeConversationNavigator, navigatorRows, pushConversationSearchParams],
  );

  const handleStartConversation = useCallback((): void => {
    if (input.runtimeConversationNavigator === null) {
      return;
    }

    const navigationRequestId = conversationNavigationRequestSequenceRef.current + 1;
    conversationNavigationRequestSequenceRef.current = navigationRequestId;
    setManualNavigationCommitPending(true);
    setManualNavigationTargetConversationId(null);

    void input.runtimeConversationNavigator
      .startNewConversation(
        input.primaryRepositoryPath === null ? undefined : { cwd: input.primaryRepositoryPath },
      )
      .then((conversationId) => {
        if (conversationNavigationRequestSequenceRef.current !== navigationRequestId) {
          return;
        }

        setManualNavigationTargetConversationId(conversationId);
        pushConversationSearchParams(conversationId);
      })
      .catch(() => {
        if (conversationNavigationRequestSequenceRef.current !== navigationRequestId) {
          return;
        }

        setManualNavigationCommitPending(false);
        setManualNavigationTargetConversationId(null);
      });
  }, [
    input.primaryRepositoryPath,
    input.runtimeConversationNavigator,
    pushConversationSearchParams,
  ]);

  useEffect(() => {
    if (
      manualNavigationTargetConversationId === null ||
      input.requestedRuntimeConversationId !== manualNavigationTargetConversationId
    ) {
      return;
    }

    setManualNavigationCommitPending(false);
    setManualNavigationTargetConversationId(null);
  }, [input.requestedRuntimeConversationId, manualNavigationTargetConversationId]);

  useEffect(() => {
    if (input.requestedRuntimeConversationId === null) {
      requestedConversationResumeAttemptRef.current = null;
      return;
    }

    if (input.runtimeConversationNavigator === null) {
      return;
    }

    if (
      !shouldAttemptRequestedRuntimeConversationResume({
        activeConversationId: input.runtimeConversationNavigator.activeConversationId,
        hasInFlightRuntimeConversationNavigation:
          input.runtimeConversationNavigator.pendingConversationId !== null ||
          input.runtimeConversationNavigator.isStartingNewConversation ||
          hasManualNavigationCommitPending,
        previousAttempt: requestedConversationResumeAttemptRef.current,
        providerConversationId: input.runtimeConversationNavigator.providerConversationId,
        requestedRuntimeConversationId: input.requestedRuntimeConversationId,
        sandboxInstanceId: input.sandboxInstanceId,
      })
    ) {
      return;
    }

    requestedConversationResumeAttemptRef.current = {
      sandboxInstanceId: input.sandboxInstanceId,
      conversationId: input.requestedRuntimeConversationId,
    };
    conversationNavigationRequestSequenceRef.current += 1;
    void input.runtimeConversationNavigator
      .resumeConversation(input.requestedRuntimeConversationId)
      .catch(() => {});
  }, [
    input.runtimeConversationNavigator,
    input.requestedRuntimeConversationId,
    input.sandboxInstanceId,
    hasManualNavigationCommitPending,
  ]);

  useEffect(() => {
    const currentRefreshConversationList = refreshConversationListRef.current;
    if (currentRefreshConversationList === null) {
      return;
    }

    void currentRefreshConversationList({
      cwd: input.primaryRepositoryPath,
    });
  }, [input.primaryRepositoryPath, hasRuntimeConversationNavigator]);

  const runtimeConversationNavigatorProps: RuntimeConversationNavigatorProps | null =
    input.runtimeConversationNavigator !== null &&
    input.primaryPanelTransitionState !== "stable_cli"
      ? {
          isStartingConversation: input.runtimeConversationNavigator.isStartingNewConversation,
          isConversationListLimited:
            input.runtimeConversationNavigator.hasMoreAvailableConversations,
          onRefreshConversations: () => {
            void input.runtimeConversationNavigator?.refreshConversationList({
              cwd: input.primaryRepositoryPath,
            });
          },
          onSelectConversation: handleSelectConversation,
          onStartConversation: handleStartConversation,
          rows: navigatorRows,
        }
      : null;
  const resolvedPanelVisibility = resolveRuntimeConversationNavigatorPanelVisibility({
    explicitPanelVisibility,
    isDiffPanelVisible: input.isDiffPanelVisible,
    conversationCount: input.runtimeConversationNavigator?.availableConversations.length ?? 0,
  });
  const isPanelVisible = runtimeConversationNavigatorProps !== null && resolvedPanelVisibility;
  const secondaryPanelKind = isPanelVisible
    ? "conversations"
    : input.isDiffPanelVisible
      ? "diff"
      : null;
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
    runtimeConversationNavigatorProps,
    secondaryPanelKind,
    togglePanel,
  };
}
