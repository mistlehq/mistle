import { useCallback, useState } from "react";

import type {
  CodexThreadLifecycleEvent,
  CodexThreadTokenUsageSnapshot,
  CodexTurnDiffSnapshot,
  CodexTurnPlanSnapshot,
} from "./codex-session-types.js";

export function useCodexSessionDebugState() {
  const [threadLifecycleEvents, setThreadLifecycleEvents] = useState<
    readonly CodexThreadLifecycleEvent[]
  >([]);
  const [turnDiffSnapshots, setTurnDiffSnapshots] = useState<readonly CodexTurnDiffSnapshot[]>([]);
  const [turnPlanSnapshots, setTurnPlanSnapshots] = useState<readonly CodexTurnPlanSnapshot[]>([]);
  const [threadTokenUsageSnapshots, setThreadTokenUsageSnapshots] = useState<
    readonly CodexThreadTokenUsageSnapshot[]
  >([]);
  const [recentNotifications, setRecentNotifications] = useState<string[]>([]);
  const [recentResponses, setRecentResponses] = useState<string[]>([]);
  const [recentServerRequests, setRecentServerRequests] = useState<string[]>([]);
  const [recentUnhandledMessages, setRecentUnhandledMessages] = useState<string[]>([]);

  const recordRecentNotification = useCallback((payload: unknown): void => {
    setRecentNotifications((current) => [JSON.stringify(payload), ...current].slice(0, 20));
  }, []);

  const recordRecentResponse = useCallback((payload: unknown): void => {
    setRecentResponses((current) => [JSON.stringify(payload), ...current].slice(0, 12));
  }, []);

  const recordRecentServerRequest = useCallback((payload: unknown): void => {
    setRecentServerRequests((current) => [JSON.stringify(payload), ...current].slice(0, 12));
  }, []);

  const recordRecentUnhandledMessage = useCallback((payload: unknown): void => {
    setRecentUnhandledMessages((current) => [JSON.stringify(payload), ...current].slice(0, 12));
  }, []);

  const recordThreadLifecycleEvent = useCallback((event: CodexThreadLifecycleEvent): void => {
    setThreadLifecycleEvents((current) =>
      [
        event,
        ...current.filter(
          (entry) => entry.method !== "thread/status/changed" || entry.threadId !== event.threadId,
        ),
      ].slice(0, 20),
    );
  }, []);

  const recordTurnDiffSnapshot = useCallback((snapshot: CodexTurnDiffSnapshot): void => {
    setTurnDiffSnapshots((current) =>
      [snapshot, ...current.filter((entry) => entry.turnId !== snapshot.turnId)].slice(0, 12),
    );
  }, []);

  const recordTurnPlanSnapshot = useCallback((snapshot: CodexTurnPlanSnapshot): void => {
    setTurnPlanSnapshots((current) =>
      [snapshot, ...current.filter((entry) => entry.turnId !== snapshot.turnId)].slice(0, 12),
    );
  }, []);

  const recordThreadTokenUsageSnapshot = useCallback(
    (snapshot: CodexThreadTokenUsageSnapshot): void => {
      setThreadTokenUsageSnapshots((current) =>
        [snapshot, ...current.filter((entry) => entry.threadId !== snapshot.threadId)].slice(0, 12),
      );
    },
    [],
  );

  const resetDebugState = useCallback((): void => {
    setThreadLifecycleEvents([]);
    setTurnDiffSnapshots([]);
    setTurnPlanSnapshots([]);
    setThreadTokenUsageSnapshots([]);
    setRecentNotifications([]);
    setRecentResponses([]);
    setRecentServerRequests([]);
    setRecentUnhandledMessages([]);
  }, []);

  return {
    threadLifecycleEvents,
    turnDiffSnapshots,
    turnPlanSnapshots,
    threadTokenUsageSnapshots,
    recentNotifications,
    recentResponses,
    recentServerRequests,
    recentUnhandledMessages,
    recordRecentNotification,
    recordRecentResponse,
    recordRecentServerRequest,
    recordRecentUnhandledMessage,
    recordThreadLifecycleEvent,
    recordTurnDiffSnapshot,
    recordTurnPlanSnapshot,
    recordThreadTokenUsageSnapshot,
    resetDebugState,
  };
}
