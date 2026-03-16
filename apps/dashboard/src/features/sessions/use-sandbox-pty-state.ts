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

  const [connectedSandboxInstanceId, setConnectedSandboxInstanceId] = useState<string | null>(null);
  const [ptyState, setPtyState] = useState<SandboxPtyState>(SandboxPtyStates.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exitInfo, setExitInfo] = useState<SandboxPtyExitInfo | null>(null);
  const [resetInfo, setResetInfo] = useState<SandboxPtyResetInfo | null>(null);
  const [outputChunks, setOutputChunks] = useState<readonly Uint8Array[]>([]);

  const clearOutput = useCallback((): void => {
    setOutputChunks([]);
  }, []);

  const detachClientListeners = useCallback((): void => {
    for (const unsubscribe of listenerCleanupRef.current) {
      unsubscribe();
    }

    listenerCleanupRef.current = [];
  }, []);

  const bindClient = useCallback(
    (client: SandboxPtyClient): void => {
      detachClientListeners();
      listenerCleanupRef.current = [
        client.onState((nextState) => {
          setPtyState(nextState);
        }),
        client.onData((chunk) => {
          setOutputChunks((currentChunks) => [...currentChunks, chunk]);
        }),
        client.onError((error) => {
          setErrorMessage(error.message);
        }),
        client.onExit((nextExitInfo) => {
          setExitInfo(nextExitInfo);
        }),
        client.onReset((nextResetInfo) => {
          setResetInfo(nextResetInfo);
        }),
      ];
    },
    [detachClientListeners],
  );

  const disconnectPty = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client === null) {
      setPtyState(SandboxPtyStates.CLOSED);
      connectedSandboxInstanceIdRef.current = null;
      setConnectedSandboxInstanceId(null);
      return;
    }

    try {
      await client.disconnect();
    } finally {
      detachClientListeners();
      clientRef.current = null;
      connectedSandboxInstanceIdRef.current = null;
      setConnectedSandboxInstanceId(null);
    }
  }, [detachClientListeners]);

  const openPty = useCallback(
    async (input: { sandboxInstanceId: string } & SandboxPtyOpenOptions): Promise<void> => {
      if (!isNonEmptyString(input.sandboxInstanceId)) {
        throw new Error("Sandbox instance id is required to open a PTY session.");
      }

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

      if (canReuseConnection) {
        await existingClient.open({
          cols: input.cols,
          rows: input.rows,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        });
        return;
      }

      if (existingClient !== null) {
        await disconnectPty();
      }

      const mintedConnection = await mintSandboxInstanceConnectionToken({
        instanceId: input.sandboxInstanceId,
      });
      const client = new SandboxPtyClient({
        connectionUrl: mintedConnection.connectionUrl,
        runtime: createBrowserSandboxSessionRuntime(),
      });

      clientRef.current = client;
      connectedSandboxInstanceIdRef.current = input.sandboxInstanceId;
      setConnectedSandboxInstanceId(input.sandboxInstanceId);
      bindClient(client);

      try {
        await client.connect();
        await client.open({
          cols: input.cols,
          rows: input.rows,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        });
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error("Could not open sandbox PTY session.");
        setErrorMessage(resolvedError.message);
        throw resolvedError;
      }
    },
    [bindClient, disconnectPty],
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
      connectedSandboxInstanceIdRef.current = null;
    };
  }, [detachClientListeners]);

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
