import {
  FileSearchStreamClient,
  type FileSearchResultItem,
  type FileSearchStreamSession,
} from "@mistle/sandbox-session-client";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SessionWorkbenchTransportManager } from "../use-session-workbench-transport.js";

const DefaultContextMentionFileSearchLimit = 20;

export type SessionComposerContextMentionControl = {
  status: "idle" | "loading" | "ready" | "unavailable";
  results: readonly FileSearchResultItem[];
  onQueryChange: (query: string) => void;
  onSelect: (input: { path: string; query: string }) => void;
  onDismiss: () => void;
};

type FileSearchSessionRecord = {
  cwd: string;
  session: FileSearchStreamSession;
  unsubscribe: () => void;
};

type FileSearchSessionConnection = {
  cwd: string;
  session: FileSearchStreamSession;
};

type PendingFileSearchSessionRecord = {
  cwd: string;
  generation: number;
  promise: Promise<FileSearchSessionConnection>;
};

type LatestFileSearchRequest = {
  cwd: string;
  requestId: string;
};

type ActiveFileSearchQuery = {
  cwd: string;
  query: string;
};

export function useSessionComposerContextMentionControl(input: {
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  enabled: boolean;
  sandboxInstanceId: string | null;
}): SessionComposerContextMentionControl | null {
  const fileSearchSessionRef = useRef<FileSearchSessionRecord | null>(null);
  const fileSearchSessionGenerationRef = useRef(0);
  const pendingFileSearchSessionRef = useRef<PendingFileSearchSessionRecord | null>(null);
  const activeQueryRef = useRef<ActiveFileSearchQuery | null>(null);
  const latestRequestRef = useRef<LatestFileSearchRequest | null>(null);
  const [state, setState] = useState<{
    results: readonly FileSearchResultItem[];
    status: SessionComposerContextMentionControl["status"];
  }>({
    results: [],
    status: "idle",
  });

  const disposeFileSearchSession = useCallback((): void => {
    fileSearchSessionGenerationRef.current += 1;
    pendingFileSearchSessionRef.current = null;
    activeQueryRef.current = null;
    const fileSearchSession = fileSearchSessionRef.current;
    fileSearchSessionRef.current = null;
    latestRequestRef.current = null;
    if (fileSearchSession === null) {
      return;
    }

    fileSearchSession.unsubscribe();
    fileSearchSession.session.dispose();
  }, []);

  useEffect(() => {
    disposeFileSearchSession();
    setState({
      results: [],
      status: "idle",
    });
  }, [disposeFileSearchSession, input.cwd, input.enabled, input.sandboxInstanceId]);

  useEffect(() => {
    return () => {
      disposeFileSearchSession();
    };
  }, [disposeFileSearchSession]);

  const onDismiss = useCallback((): void => {
    disposeFileSearchSession();
    setState({
      results: [],
      status: "idle",
    });
  }, [disposeFileSearchSession]);

  const onQueryChange = useCallback(
    (query: string): void => {
      if (!input.enabled) {
        activeQueryRef.current = null;
        setState({
          results: [],
          status: "idle",
        });
        return;
      }

      const trimmedQuery = query.trim();
      if (trimmedQuery.length === 0) {
        activeQueryRef.current = null;
        latestRequestRef.current = null;
        setState({
          results: [],
          status: "idle",
        });
        return;
      }

      const cwd = input.cwd;
      const sandboxInstanceId = input.sandboxInstanceId;
      if (cwd === null || sandboxInstanceId === null) {
        activeQueryRef.current = null;
        setState({
          results: [],
          status: "unavailable",
        });
        return;
      }

      const activeQuery = activeQueryRef.current;
      if (activeQuery !== null && activeQuery.cwd === cwd && activeQuery.query === trimmedQuery) {
        return;
      }
      activeQueryRef.current = {
        cwd,
        query: trimmedQuery,
      };
      latestRequestRef.current = null;

      setState({
        results: [],
        status: "loading",
      });

      void (async (): Promise<void> => {
        try {
          let fileSearchSession = fileSearchSessionRef.current;
          if (fileSearchSession === null || fileSearchSession.cwd !== cwd) {
            const pendingFileSearchSession = pendingFileSearchSessionRef.current;
            let generation = pendingFileSearchSession?.generation ?? null;
            let sessionConnectionPromise =
              pendingFileSearchSession !== null && pendingFileSearchSession.cwd === cwd
                ? pendingFileSearchSession.promise
                : null;

            if (sessionConnectionPromise === null) {
              disposeFileSearchSession();
              generation = fileSearchSessionGenerationRef.current;
              sessionConnectionPromise = openFileSearchSession({
                cwd,
                ensureTransportConnected: input.ensureTransportConnected,
                sandboxInstanceId,
              });
              pendingFileSearchSessionRef.current = {
                cwd,
                generation,
                promise: sessionConnectionPromise,
              };
            }

            const sessionConnection = await sessionConnectionPromise;
            if (generation === null || fileSearchSessionGenerationRef.current !== generation) {
              sessionConnection.session.dispose();
              return;
            }

            if (pendingFileSearchSessionRef.current?.promise === sessionConnectionPromise) {
              pendingFileSearchSessionRef.current = null;
            }

            const currentSessionRecord = fileSearchSessionRef.current;
            if (currentSessionRecord?.session === sessionConnection.session) {
              fileSearchSession = currentSessionRecord;
            } else {
              const unsubscribe = attachFileSearchSessionResultHandler({
                cwd,
                session: sessionConnection.session,
                setState,
                latestRequestRef,
              });
              fileSearchSession = {
                ...sessionConnection,
                unsubscribe,
              };
              fileSearchSessionRef.current = fileSearchSession;
            }
          }

          const requestId = await fileSearchSession.session.query({
            limit: DefaultContextMentionFileSearchLimit,
            query: trimmedQuery,
          });
          latestRequestRef.current = {
            cwd,
            requestId,
          };
        } catch {
          const activeQuery = activeQueryRef.current;
          if (
            activeQuery === null ||
            activeQuery.cwd !== cwd ||
            activeQuery.query !== trimmedQuery
          ) {
            return;
          }

          pendingFileSearchSessionRef.current = null;
          setState({
            results: [],
            status: "unavailable",
          });
        }
      })();
    },
    [
      disposeFileSearchSession,
      input.cwd,
      input.enabled,
      input.ensureTransportConnected,
      input.sandboxInstanceId,
    ],
  );

  const onSelect = useCallback((selectInput: { path: string; query: string }): void => {
    void fileSearchSessionRef.current?.session.select(selectInput);
  }, []);

  const control = useMemo(
    () => ({
      status: state.status,
      results: state.results,
      onQueryChange,
      onSelect,
      onDismiss,
    }),
    [onDismiss, onQueryChange, onSelect, state.results, state.status],
  );

  return input.enabled ? control : null;
}

async function openFileSearchSession(input: {
  cwd: string;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<FileSearchSessionConnection> {
  const { transport } = await input.ensureTransportConnected({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const session = await new FileSearchStreamClient({ transport }).openSession({ cwd: input.cwd });

  return {
    cwd: input.cwd,
    session,
  };
}

function attachFileSearchSessionResultHandler(input: {
  cwd: string;
  latestRequestRef: RefObject<LatestFileSearchRequest | null>;
  session: FileSearchStreamSession;
  setState: Dispatch<
    SetStateAction<{
      results: readonly FileSearchResultItem[];
      status: SessionComposerContextMentionControl["status"];
    }>
  >;
}): () => void {
  return input.session.onEvent((event) => {
    if (event.type === "closed") {
      input.setState({
        results: [],
        status: "unavailable",
      });
      return;
    }

    if (event.type === "error") {
      const latestRequest = input.latestRequestRef.current;
      if (
        latestRequest === null ||
        latestRequest.cwd !== input.cwd ||
        latestRequest.requestId !== event.error.requestId
      ) {
        return;
      }

      input.setState({
        results: [],
        status: "unavailable",
      });
      return;
    }

    const latestRequest = input.latestRequestRef.current;
    if (
      latestRequest === null ||
      latestRequest.cwd !== input.cwd ||
      latestRequest.requestId !== event.results.requestId
    ) {
      return;
    }

    input.setState({
      results: event.results.items,
      status: "ready",
    });
  });
}
