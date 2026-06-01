import {
  PtyTransportClient,
  SandboxPtyStates,
  type SandboxSessionTransport,
  type SandboxPtyExitInfo,
  type SandboxPtyOpenOptions,
  type SandboxPtyResetInfo,
  type SandboxPtyState,
} from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { useCallback, useEffect, useRef, useState } from "react";

import { createSandboxInstancePtySession } from "./sessions-service.js";

type SandboxPtyLifecycleState = {
  connectedSandboxInstanceId: string | null;
  errorMessage: string | null;
  exitInfo: SandboxPtyExitInfo | null;
  resetInfo: SandboxPtyResetInfo | null;
  state: SandboxPtyState;
};

type UseSandboxPtyStateResult = {
  lifecycle: SandboxPtyLifecycleState;
  output: {
    chunks: readonly Uint8Array[];
    clearOutput: () => void;
  };
  actions: {
    closePty: () => Promise<void>;
    disconnectPty: () => Promise<void>;
    openPty: (input: { sandboxInstanceId: string } & SandboxPtyOpenOptions) => Promise<void>;
    resizePty: (input: { cols: number; rows: number }) => Promise<void>;
    writeInput: (data: string | Uint8Array) => Promise<void>;
  };
};

type SandboxPtyOpenInput = { sandboxInstanceId: string } & SandboxPtyOpenOptions;

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

export type { SandboxPtyLifecycleState, UseSandboxPtyStateResult };

export function useSandboxPtyState(_hookInput: {
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
}): UseSandboxPtyStateResult {
  const clientRef = useRef<PtyTransportClient | null>(null);
  const connectedSandboxInstanceIdRef = useRef<string | null>(null);
  const gatewayServiceRestartHandlerRef = useRef<(generation: number) => void>(() => {});
  const lastOpenInputRef = useRef<SandboxPtyOpenInput | null>(null);
  const listenerCleanupRef = useRef<(() => void)[]>([]);
  const openGenerationRef = useRef(0);

  const [connectedSandboxInstanceId, setConnectedSandboxInstanceId] = useState<string | null>(null);
  const [ptyState, setPtyState] = useState<SandboxPtyState>(SandboxPtyStates.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exitInfo, setExitInfo] = useState<SandboxPtyExitInfo | null>(null);
  const [resetInfo, setResetInfo] = useState<SandboxPtyResetInfo | null>(null);
  const [outputChunks, setOutputChunks] = useState<readonly Uint8Array[]>([]);

  const clearOutput = useCallback((): void => {
    setOutputChunks([]);
  }, []);

  const clearLifecycleMetadata = useCallback((): void => {
    setErrorMessage(null);
    setExitInfo(null);
    setResetInfo(null);
  }, []);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return openGenerationRef.current === generation;
  }, []);

  const clearConnectedSandboxInstanceId = useCallback((): void => {
    connectedSandboxInstanceIdRef.current = null;
    setConnectedSandboxInstanceId(null);
  }, []);

  const detachClientListeners = useCallback((): void => {
    for (const unsubscribe of listenerCleanupRef.current) {
      unsubscribe();
    }

    listenerCleanupRef.current = [];
  }, []);

  const bindClient = useCallback(
    (client: PtyTransportClient, generation: number): void => {
      detachClientListeners();
      listenerCleanupRef.current = [
        client.onState((nextState) => {
          if (!isCurrentGeneration(generation)) {
            return;
          }

          setPtyState(nextState);
        }),
        client.onData((chunk) => {
          if (!isCurrentGeneration(generation)) {
            return;
          }

          setOutputChunks((currentChunks) => [...currentChunks, chunk]);
        }),
        client.onError((error) => {
          if (!isCurrentGeneration(generation)) {
            return;
          }

          setErrorMessage(error.message);
        }),
        client.onExit((nextExitInfo) => {
          if (!isCurrentGeneration(generation)) {
            return;
          }

          setExitInfo(nextExitInfo);
        }),
        client.onReset((nextResetInfo) => {
          if (!isCurrentGeneration(generation)) {
            return;
          }

          setResetInfo(nextResetInfo);
        }),
        client.onGatewayServiceRestart(() => {
          if (!isCurrentGeneration(generation)) {
            return;
          }

          gatewayServiceRestartHandlerRef.current(generation);
        }),
      ];
    },
    [detachClientListeners, isCurrentGeneration],
  );

  const disconnectCurrentClient = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client === null) {
      setPtyState(SandboxPtyStates.CLOSED);
      clearLifecycleMetadata();
      setOutputChunks([]);
      clearConnectedSandboxInstanceId();
      return;
    }

    try {
      await client.disconnect();
    } finally {
      detachClientListeners();
      clientRef.current = null;
      clearConnectedSandboxInstanceId();
      clearLifecycleMetadata();
      setOutputChunks([]);
      setPtyState(SandboxPtyStates.CLOSED);
    }
  }, [clearConnectedSandboxInstanceId, clearLifecycleMetadata, detachClientListeners]);

  const disconnectPty = useCallback(async (): Promise<void> => {
    openGenerationRef.current += 1;
    lastOpenInputRef.current = null;
    await disconnectCurrentClient();
  }, [disconnectCurrentClient]);

  const connectPtyClient = useCallback(
    async (openInput: SandboxPtyOpenInput, generation: number): Promise<void> => {
      const ptySession = await createSandboxInstancePtySession({
        instanceId: openInput.sandboxInstanceId,
        ptySessionId: openInput.ptySessionId,
      });
      if (!isCurrentGeneration(generation)) {
        throw new Error("Sandbox PTY connection attempt was superseded.");
      }

      const client = new PtyTransportClient({
        connectionUrl: ptySession.url,
        runtime: createBrowserSandboxSessionRuntime(),
      });

      clientRef.current = client;
      bindClient(client, generation);

      try {
        await client.open({
          ptySessionId: openInput.ptySessionId,
          cols: openInput.cols,
          rows: openInput.rows,
          ...(openInput.cwd === undefined ? {} : { cwd: openInput.cwd }),
          ...(openInput.command === undefined ? {} : { command: openInput.command }),
          ...(openInput.args === undefined ? {} : { args: openInput.args }),
        });
        if (!isCurrentGeneration(generation)) {
          await client.disconnect();
          throw new Error("Sandbox PTY connection attempt was superseded.");
        }

        connectedSandboxInstanceIdRef.current = openInput.sandboxInstanceId;
        setConnectedSandboxInstanceId(openInput.sandboxInstanceId);
        lastOpenInputRef.current = openInput;
      } catch (error) {
        try {
          await client.disconnect();
        } catch {
          // Preserve the original PTY open failure.
        } finally {
          if (clientRef.current === client) {
            clientRef.current = null;
          }
        }

        throw error instanceof Error ? error : new Error("Could not open sandbox PTY session.");
      }
    },
    [bindClient, isCurrentGeneration],
  );

  const reconnectPtyAfterGatewayRestart = useCallback(
    (closedGeneration: number): void => {
      const openInput = lastOpenInputRef.current;
      if (openInput === null) {
        setErrorMessage("Gateway service restarted before the PTY open request was recorded.");
        return;
      }

      const reconnectGeneration = closedGeneration + 1;
      openGenerationRef.current = reconnectGeneration;
      detachClientListeners();
      clientRef.current = null;
      setErrorMessage(null);
      setExitInfo(null);
      setResetInfo(null);

      void connectPtyClient(openInput, reconnectGeneration).catch((error: unknown) => {
        if (!isCurrentGeneration(reconnectGeneration)) {
          return;
        }

        const resolvedError =
          error instanceof Error ? error : new Error("Could not reconnect sandbox PTY session.");
        clearConnectedSandboxInstanceId();
        setErrorMessage(resolvedError.message);
      });
    },
    [clearConnectedSandboxInstanceId, connectPtyClient, detachClientListeners, isCurrentGeneration],
  );

  useEffect(() => {
    gatewayServiceRestartHandlerRef.current = reconnectPtyAfterGatewayRestart;
  }, [reconnectPtyAfterGatewayRestart]);

  const openPty = useCallback(
    async (openInput: SandboxPtyOpenInput): Promise<void> => {
      if (!isNonEmptyString(openInput.sandboxInstanceId)) {
        throw new Error("Sandbox instance id is required to open a PTY session.");
      }

      const generation = openGenerationRef.current + 1;
      openGenerationRef.current = generation;

      const existingClient = clientRef.current;
      setErrorMessage(null);
      setExitInfo(null);
      setResetInfo(null);
      setOutputChunks([]);
      clearConnectedSandboxInstanceId();

      if (existingClient !== null) {
        await disconnectCurrentClient();
        if (!isCurrentGeneration(generation)) {
          throw new Error("Sandbox PTY connection attempt was superseded.");
        }
      }

      try {
        await connectPtyClient(openInput, generation);
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error("Could not open sandbox PTY session.");

        if (isCurrentGeneration(generation)) {
          clearConnectedSandboxInstanceId();
          setErrorMessage(resolvedError.message);
        }

        throw resolvedError;
      }
    },
    [
      clearConnectedSandboxInstanceId,
      connectPtyClient,
      disconnectCurrentClient,
      isCurrentGeneration,
    ],
  );

  const writeInput = useCallback(async (data: string | Uint8Array): Promise<void> => {
    const client = clientRef.current;
    if (client === null) {
      throw new Error("Sandbox PTY client is not connected.");
    }

    await client.write(data);
  }, []);

  const resizePty = useCallback(async (input: { cols: number; rows: number }): Promise<void> => {
    const client = clientRef.current;
    if (client === null) {
      throw new Error("Sandbox PTY client is not connected.");
    }

    await client.resize(input);
  }, []);

  const closePty = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client === null) {
      throw new Error("Sandbox PTY client is not connected.");
    }

    await client.close();
  }, []);

  useEffect(() => {
    return () => {
      const client = clientRef.current;
      if (client !== null) {
        void client.disconnect();
      }

      detachClientListeners();
      clientRef.current = null;
      clearConnectedSandboxInstanceId();
      clearLifecycleMetadata();
      setOutputChunks([]);
    };
  }, [clearConnectedSandboxInstanceId, clearLifecycleMetadata, detachClientListeners]);

  return {
    actions: {
      closePty,
      disconnectPty,
      openPty,
      resizePty,
      writeInput,
    },
    lifecycle: {
      connectedSandboxInstanceId,
      errorMessage,
      exitInfo,
      resetInfo,
      state: ptyState,
    },
    output: {
      chunks: outputChunks,
      clearOutput,
    },
  };
}
