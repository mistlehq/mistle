import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { Button } from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";

import "dockview/dist/styles/dockview.css";
import "./session-terminal-workspace.css";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewGroupPanel,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview";
import {
  createContext,
  forwardRef,
  type FunctionComponent,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSandboxPtyState } from "../sessions/use-sandbox-pty-state.js";
import {
  buildTerminalPtyOpenInput,
  reduceTerminalRecoveryState,
  shouldAttemptTerminalReconnect,
  shouldAutoOpenTerminal,
  shouldHandleTerminalExit,
  shouldObserveTerminalReset,
  type TerminalRecoveryState,
} from "./session-terminal-runtime.js";
import { SessionTerminalSurface } from "./session-terminal-surface.js";
import type { WorkbenchSandboxLifecycleStatus } from "./session-workbench-state.js";

type SessionTerminalWorkspaceProps = {
  cwd: string | null;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
  isConnectionReady: boolean;
  isVisible: boolean;
  onTerminalReset?: (input: { panelId: string }) => void;
  onWorkspaceEmpty: () => void;
  sandboxInstanceId: string;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
};

type SessionTerminalWorkspaceViewProps = {
  cwd: string | null;
  isVisible: boolean;
  onApiReady?: (api: DockviewApi) => void;
  onWorkspaceEmpty: () => void;
  renderTerminalPanel: (input: {
    closePanel: () => void;
    cwd: string | null;
    isPanelVisible: boolean;
    panelId: string;
  }) => ReactElement;
};

export type SessionTerminalWorkspaceHandle = {
  disconnectAllTerminals: () => Promise<void>;
  ensureTerminalWorkspace: () => void;
};

type SessionTerminalDockviewParams = {
  cwd: string | null;
};

type SessionTerminalWorkspaceContextValue = {
  createTerminal: (input: { referenceGroup?: DockviewGroupPanel }) => void;
  renderTerminalPanel: SessionTerminalWorkspaceViewProps["renderTerminalPanel"];
};

type SessionDockviewTerminalPanelProps = IDockviewPanelProps<SessionTerminalDockviewParams>;

const TerminalWorkspaceContext = createContext<SessionTerminalWorkspaceContextValue | null>(null);

function useTerminalWorkspaceContext(): SessionTerminalWorkspaceContextValue {
  const context = useContext(TerminalWorkspaceContext);
  if (context === null) {
    throw new Error("Terminal workspace context is required.");
  }

  return context;
}

function parseTerminalSequenceNumber(id: string): number | null {
  if (id === "terminal") {
    return 1;
  }

  const match = /^terminal-(\d+)$/.exec(id);
  if (match === null) {
    return null;
  }

  const sequenceNumber = Number(match[1]);
  return Number.isInteger(sequenceNumber) && sequenceNumber > 1 ? sequenceNumber : null;
}

export function buildNextTerminalPanelDefinition(existingPanelIds: readonly string[]): {
  id: string;
  title: string;
} {
  let highestSequenceNumber = 0;

  for (const id of existingPanelIds) {
    const sequenceNumber = parseTerminalSequenceNumber(id);
    if (sequenceNumber !== null) {
      highestSequenceNumber = Math.max(highestSequenceNumber, sequenceNumber);
    }
  }

  const nextSequenceNumber = highestSequenceNumber + 1;
  if (nextSequenceNumber === 1) {
    return {
      id: "terminal",
      title: "Terminal",
    };
  }

  return {
    id: `terminal-${String(nextSequenceNumber)}`,
    title: `Terminal ${String(nextSequenceNumber)}`,
  };
}

function DockviewTerminalNewTabAction(input: IDockviewHeaderActionsProps): ReactElement | null {
  const { createTerminal } = useTerminalWorkspaceContext();

  return (
    <div className="flex h-full items-stretch">
      <Button
        aria-label="Open terminal tab"
        className="session-terminal-dockview-new-tab-trigger h-full rounded-none px-3"
        onClick={() => {
          createTerminal({
            referenceGroup: input.group,
          });
        }}
        size="sm"
        title="Open terminal tab"
        type="button"
        variant="ghost"
      >
        <PlusIcon className="size-4" />
      </Button>
    </div>
  );
}

function DockviewTerminalPanel(input: SessionDockviewTerminalPanelProps): ReactElement {
  const { renderTerminalPanel } = useTerminalWorkspaceContext();
  const initialParameters = input.api.getParameters<SessionTerminalDockviewParams>();
  const [cwd, setCwd] = useState<string | null>(
    typeof initialParameters.cwd === "string" ? initialParameters.cwd : null,
  );
  const [isPanelVisible, setIsPanelVisible] = useState(input.api.isVisible);

  useEffect(() => {
    const disposable = input.api.onDidParametersChange((nextParameters) => {
      if (
        typeof nextParameters !== "object" ||
        nextParameters === null ||
        Array.isArray(nextParameters)
      ) {
        setCwd(null);
        return;
      }

      const nextCwd = Reflect.get(nextParameters, "cwd");
      setCwd(typeof nextCwd === "string" ? nextCwd : null);
    });

    return () => {
      disposable.dispose();
    };
  }, [input.api]);

  useEffect(() => {
    const disposable = input.api.onDidVisibilityChange((event) => {
      setIsPanelVisible(event.isVisible);
    });

    return () => {
      disposable.dispose();
    };
  }, [input.api]);

  return renderTerminalPanel({
    closePanel: () => {
      input.api.close();
    },
    cwd,
    isPanelVisible,
    panelId: input.api.id,
  });
}

function PtyBackedDockviewTerminalPanel(input: {
  closePanel: () => void;
  cwd: string | null;
  ensureTransportConnected: SessionTerminalWorkspaceProps["ensureTransportConnected"];
  isConnectionReady: boolean;
  isPanelVisible: boolean;
  isWorkspaceVisible: boolean;
  onTerminalReset?: SessionTerminalWorkspaceProps["onTerminalReset"];
  panelId: string;
  sandboxInstanceId: string;
  sandboxStatus: WorkbenchSandboxLifecycleStatus;
}): ReactElement {
  const ptyState = useSandboxPtyState({
    ensureTransportConnected: input.ensureTransportConnected,
  });
  const { lifecycle, output, actions } = ptyState;
  const { openPty, resizePty, writeInput } = actions;
  const hasAttemptedAutoOpenRef = useRef(false);
  const hasHandledExitRef = useRef(false);
  const isReconnectAttemptInFlightRef = useRef(false);
  const lastHandledResetRef = useRef(lifecycle.resetInfo);
  const [recovery, setRecovery] = useState<TerminalRecoveryState>({
    kind: "idle",
  });
  const isTerminalVisible = input.isWorkspaceVisible && input.isPanelVisible;

  useEffect(() => {
    const resetObservation = {
      isTerminalVisible,
      lastHandledReset: lastHandledResetRef.current,
      nextReset: lifecycle.resetInfo,
    };
    if (!shouldObserveTerminalReset(resetObservation)) {
      return;
    }

    const resetInfo = resetObservation.nextReset;
    lastHandledResetRef.current = resetInfo;
    isReconnectAttemptInFlightRef.current = false;
    input.onTerminalReset?.({
      panelId: input.panelId,
    });
    setRecovery((currentState) =>
      reduceTerminalRecoveryState(currentState, {
        type: "reset_seen",
        resetInfo,
      }),
    );
  }, [isTerminalVisible, lifecycle.resetInfo]);

  useEffect(() => {
    setRecovery((currentState) =>
      reduceTerminalRecoveryState(currentState, {
        type: "sync_observed",
        isReconnectAttemptInFlight: isReconnectAttemptInFlightRef.current,
        lifecycleState: lifecycle.state,
        sandboxStatus: input.sandboxStatus,
      }),
    );
  }, [input.sandboxStatus, lifecycle.state]);

  useEffect(() => {
    if (!shouldAttemptTerminalReconnect({ recovery })) {
      return;
    }

    isReconnectAttemptInFlightRef.current = true;
    setRecovery((currentState) =>
      reduceTerminalRecoveryState(currentState, {
        type: "reopen_requested",
      }),
    );

    void openPty(
      buildTerminalPtyOpenInput({
        cwd: input.cwd,
        ptySessionId: input.panelId,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    )
      .catch((error) => {
        setRecovery((currentState) =>
          reduceTerminalRecoveryState(currentState, {
            type: "reopen_failed",
            message: error instanceof Error ? error.message : "Could not reopen sandbox terminal.",
          }),
        );
      })
      .finally(() => {
        isReconnectAttemptInFlightRef.current = false;
        setRecovery((currentState) =>
          reduceTerminalRecoveryState(currentState, {
            type: "sync_observed",
            isReconnectAttemptInFlight: false,
            lifecycleState: lifecycle.state,
            sandboxStatus: input.sandboxStatus,
          }),
        );
      });
  }, [
    input.cwd,
    input.panelId,
    input.sandboxInstanceId,
    input.sandboxStatus,
    lifecycle.state,
    openPty,
    recovery,
  ]);

  useEffect(() => {
    if (lifecycle.exitInfo === null) {
      hasHandledExitRef.current = false;
      return;
    }

    if (
      !shouldHandleTerminalExit({
        exitInfo: lifecycle.exitInfo,
        hasHandledExit: hasHandledExitRef.current,
      })
    ) {
      return;
    }

    hasHandledExitRef.current = true;
    input.closePanel();
  }, [input.closePanel, lifecycle.exitInfo]);

  useEffect(() => {
    if (
      !shouldAutoOpenTerminal({
        isVisible: isTerminalVisible,
        isConnectionReady: input.isConnectionReady,
        lifecycleState: lifecycle.state,
        hasAttemptedAutoOpen: hasAttemptedAutoOpenRef.current,
      })
    ) {
      return;
    }

    hasAttemptedAutoOpenRef.current = true;
    void openPty(
      buildTerminalPtyOpenInput({
        cwd: input.cwd,
        ptySessionId: input.panelId,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    ).catch(() => {});
  }, [
    input.cwd,
    input.isConnectionReady,
    input.panelId,
    input.sandboxInstanceId,
    isTerminalVisible,
    lifecycle.state,
    openPty,
  ]);

  return (
    <SessionTerminalSurface
      isVisible={isTerminalVisible}
      lifecycleState={lifecycle.state}
      onResize={resizePty}
      onWriteInput={writeInput}
      outputChunks={output.chunks}
    />
  );
}

const DockviewTerminalComponents = {
  terminal: DockviewTerminalPanel,
} satisfies Record<string, FunctionComponent<SessionDockviewTerminalPanelProps>>;

export const SessionTerminalWorkspace = forwardRef<
  SessionTerminalWorkspaceHandle,
  SessionTerminalWorkspaceProps
>(function SessionTerminalWorkspaceInner(props, forwardedRef): ReactElement {
  return (
    <SessionTerminalWorkspaceView
      cwd={props.cwd}
      isVisible={props.isVisible}
      onWorkspaceEmpty={props.onWorkspaceEmpty}
      ref={forwardedRef}
      renderTerminalPanel={({ closePanel, cwd, isPanelVisible, panelId }) => (
        <PtyBackedDockviewTerminalPanel
          closePanel={closePanel}
          cwd={cwd}
          ensureTransportConnected={props.ensureTransportConnected}
          isConnectionReady={props.isConnectionReady}
          isPanelVisible={isPanelVisible}
          isWorkspaceVisible={props.isVisible}
          onTerminalReset={props.onTerminalReset}
          panelId={panelId}
          sandboxInstanceId={props.sandboxInstanceId}
          sandboxStatus={props.sandboxStatus}
        />
      )}
    />
  );
});

export const SessionTerminalWorkspaceView = forwardRef<
  SessionTerminalWorkspaceHandle,
  SessionTerminalWorkspaceViewProps
>(function SessionTerminalWorkspaceView(
  { cwd, isVisible, onApiReady, onWorkspaceEmpty, renderTerminalPanel },
  forwardedRef,
): ReactElement {
  const apiRef = useRef<DockviewApi | null>(null);
  const [readyApi, setReadyApi] = useState<DockviewApi | null>(null);
  const shouldEnsureWorkspaceRef = useRef(false);

  const createTerminal = useCallback(
    (input: { referenceGroup?: DockviewGroupPanel }): void => {
      const api = apiRef.current;
      if (api === null) {
        shouldEnsureWorkspaceRef.current = true;
        return;
      }

      const nextTerminal = buildNextTerminalPanelDefinition(api.panels.map((panel) => panel.id));

      api.addPanel({
        id: nextTerminal.id,
        title: nextTerminal.title,
        component: "terminal",
        params: {
          cwd,
        },
        renderer: "always",
        ...(input.referenceGroup === undefined
          ? {}
          : { position: { referenceGroup: input.referenceGroup } }),
      });
    },
    [cwd],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      disconnectAllTerminals: async (): Promise<void> => {
        const api = apiRef.current;
        if (api === null) {
          shouldEnsureWorkspaceRef.current = false;
          return;
        }

        api.closeAllGroups();
      },
      ensureTerminalWorkspace: (): void => {
        const api = apiRef.current;
        if (api === null) {
          shouldEnsureWorkspaceRef.current = true;
          return;
        }

        if (api.totalPanels === 0) {
          createTerminal({
            ...(api.activeGroup === undefined ? {} : { referenceGroup: api.activeGroup }),
          });
        }
      },
    }),
    [createTerminal],
  );

  useEffect(() => {
    if (readyApi === null) {
      return;
    }

    const layoutChangeDisposable = readyApi.onDidLayoutChange(() => {
      if (readyApi.totalPanels === 0) {
        onWorkspaceEmpty();
      }
    });

    return () => {
      layoutChangeDisposable.dispose();
    };
  }, [onWorkspaceEmpty, readyApi]);

  const contextValue = useMemo<SessionTerminalWorkspaceContextValue>(
    () => ({
      createTerminal,
      renderTerminalPanel,
    }),
    [createTerminal, renderTerminalPanel],
  );

  return (
    <div className="h-full min-h-0 border-t border-stone-300 bg-white">
      <TerminalWorkspaceContext.Provider value={contextValue}>
        <div className="session-terminal-dockview dockview-theme-light h-full min-h-0">
          <DockviewReact
            className="h-full"
            components={DockviewTerminalComponents}
            onReady={(event) => {
              apiRef.current = event.api;
              setReadyApi(event.api);

              if (shouldEnsureWorkspaceRef.current || (isVisible && event.api.totalPanels === 0)) {
                shouldEnsureWorkspaceRef.current = false;
                createTerminal({
                  ...(event.api.activeGroup === undefined
                    ? {}
                    : { referenceGroup: event.api.activeGroup }),
                });
              }

              onApiReady?.(event.api);
            }}
            leftHeaderActionsComponent={DockviewTerminalNewTabAction}
            tabAnimation="smooth"
          />
        </div>
      </TerminalWorkspaceContext.Provider>
    </div>
  );
});
