import {
  SandboxPtyClient,
  SandboxPtyStates,
  type SandboxPtyExitInfo,
  type SandboxPtyOpenOptions,
  type SandboxPtyResetInfo,
  type SandboxPtyState,
} from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { useCallback, useEffect, useRef, useState } from "react";

import { mintSandboxInstanceConnectionToken } from "./sessions-service.js";

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

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

export type { SandboxPtyLifecycleState, UseSandboxPtyStateResult };

export function useSandboxPtyState(): UseSandboxPtyStateResult {
  const clientRef = useRef<SandboxPtyClient | null>(null);
  const connectedSandboxInstanceIdRef = useRef<string | null>(null);
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
    (client: SandboxPtyClient, generation: number): void => {
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
      ];
    },
    [detachClientListeners, isCurrentGeneration],
  );

  const disconnectPty = useCallback(async (): Promise<void> => {
    openGenerationRef.current += 1;
    const client = clientRef.current;
    if (client === null) {
      setPtyState(SandboxPtyStates.CLOSED);
      clearConnectedSandboxInstanceId();
      return;
    }

    try {
      await client.disconnect();
    } finally {
      detachClientListeners();
      clientRef.current = null;
      clearConnectedSandboxInstanceId();
      setPtyState(SandboxPtyStates.CLOSED);
    }
  }, [clearConnectedSandboxInstanceId, detachClientListeners]);

  const openPty = useCallback(
    async (input: { sandboxInstanceId: string } & SandboxPtyOpenOptions): Promise<void> => {
      if (!isNonEmptyString(input.sandboxInstanceId)) {
        throw new Error("Sandbox instance id is required to open a PTY session.");
      }

      const generation = openGenerationRef.current + 1;
      openGenerationRef.current = generation;

      const existingClient = clientRef.current;
      const existingSandboxInstanceId = connectedSandboxInstanceIdRef.current;
      const canReuseConnection =
        existingClient !== null &&
        existingSandboxInstanceId === input.sandboxInstanceId &&
        existingClient.state === SandboxPtyStates.CONNECTED;

      setErrorMessage(null);
      setExitInfo(null);
      setResetInfo(null);
      setOutputChunks([]);
      clearConnectedSandboxInstanceId();

      if (canReuseConnection) {
        await existingClient.open({
          cols: input.cols,
          rows: input.rows,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        });

        if (isCurrentGeneration(generation)) {
          connectedSandboxInstanceIdRef.current = input.sandboxInstanceId;
          setConnectedSandboxInstanceId(input.sandboxInstanceId);
        }

        return;
      }

      if (existingClient !== null) {
        await disconnectPty();
        if (!isCurrentGeneration(generation)) {
          throw new Error("Sandbox PTY connection attempt was superseded.");
        }
      }

      const mintedConnection = await mintSandboxInstanceConnectionToken({
        instanceId: input.sandboxInstanceId,
      });
      if (!isCurrentGeneration(generation)) {
        throw new Error("Sandbox PTY connection attempt was superseded.");
      }

      const client = new SandboxPtyClient({
        connectionUrl: mintedConnection.connectionUrl,
        runtime: createBrowserSandboxSessionRuntime(),
      });

      clientRef.current = client;
      bindClient(client, generation);

      try {
        await client.connect();
        if (!isCurrentGeneration(generation)) {
          await client.disconnect();
          throw new Error("Sandbox PTY connection attempt was superseded.");
        }

        await client.open({
          cols: input.cols,
          rows: input.rows,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        });
        if (!isCurrentGeneration(generation)) {
          await client.disconnect();
          throw new Error("Sandbox PTY connection attempt was superseded.");
        }

        connectedSandboxInstanceIdRef.current = input.sandboxInstanceId;
        setConnectedSandboxInstanceId(input.sandboxInstanceId);
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

        const resolvedError =
          error instanceof Error ? error : new Error("Could not open sandbox PTY session.");

        if (isCurrentGeneration(generation)) {
          clearConnectedSandboxInstanceId();
          setErrorMessage(resolvedError.message);
        }

        throw resolvedError;
      }
    },
    [bindClient, clearConnectedSandboxInstanceId, disconnectPty, isCurrentGeneration],
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
    };
  }, [clearConnectedSandboxInstanceId, detachClientListeners]);

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
