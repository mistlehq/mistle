import {
  SandboxSessionSocketReadyStates,
  SandboxSessionTransport,
} from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { useCallback, useEffect, useRef, type RefObject } from "react";

import {
  mintSandboxInstanceConnectionToken,
  type MintSandboxConnectionTokenResult,
} from "../sessions/sessions-service.js";

type SessionWorkbenchTransportConnection = {
  mintedConnection: MintSandboxConnectionTokenResult;
  sandboxInstanceId: string;
  transport: SandboxSessionTransport;
};

type PendingTransportConnection = {
  promise: Promise<SessionWorkbenchTransportConnection>;
  sandboxInstanceId: string;
};

export type SessionWorkbenchTransportManager = {
  transportConnectionRef: RefObject<SessionWorkbenchTransportConnection | null>;
  transportRef: RefObject<SandboxSessionTransport | null>;
  ensureTransportConnected: (input: {
    sandboxInstanceId: string;
  }) => Promise<SessionWorkbenchTransportConnection>;
  disconnectTransport: (reason: string) => void;
};

export function useSessionWorkbenchTransport(input: {
  sandboxInstanceId: string | null;
}): SessionWorkbenchTransportManager {
  const transportRef = useRef<SandboxSessionTransport | null>(null);
  const transportConnectionRef = useRef<SessionWorkbenchTransportConnection | null>(null);
  const pendingTransportConnectionRef = useRef<PendingTransportConnection | null>(null);
  const transportGenerationRef = useRef(0);
  const previousSandboxInstanceIdRef = useRef<string | null>(input.sandboxInstanceId);

  const disconnectTransport = useCallback((reason: string): void => {
    transportGenerationRef.current += 1;
    pendingTransportConnectionRef.current = null;
    transportConnectionRef.current = null;
    const transport = transportRef.current;
    transportRef.current = null;
    transport?.disconnect(1000, reason);
  }, []);

  const ensureTransportConnected = useCallback(
    async (ensureInput: {
      sandboxInstanceId: string;
    }): Promise<SessionWorkbenchTransportConnection> => {
      const currentTransportConnection = transportConnectionRef.current;
      if (
        currentTransportConnection !== null &&
        currentTransportConnection.sandboxInstanceId === ensureInput.sandboxInstanceId &&
        currentTransportConnection.transport.readyState === SandboxSessionSocketReadyStates.OPEN
      ) {
        return currentTransportConnection;
      }

      const pendingTransportConnection = pendingTransportConnectionRef.current;
      if (
        pendingTransportConnection !== null &&
        pendingTransportConnection.sandboxInstanceId === ensureInput.sandboxInstanceId
      ) {
        return await pendingTransportConnection.promise;
      }

      disconnectTransport("Replacing shared sandbox session transport.");
      const connectGeneration = transportGenerationRef.current;
      const transport = new SandboxSessionTransport({
        runtime: createBrowserSandboxSessionRuntime(),
      });
      transportRef.current = transport;

      const promise = (async (): Promise<SessionWorkbenchTransportConnection> => {
        const mintedConnection = await mintSandboxInstanceConnectionToken({
          instanceId: ensureInput.sandboxInstanceId,
        });
        await transport.connect({
          connectionUrl: mintedConnection.connectionUrl,
        });

        if (
          transportGenerationRef.current !== connectGeneration ||
          transportRef.current !== transport
        ) {
          transport.disconnect(1000, "Superseded shared sandbox session transport.");
          throw new Error("Sandbox session transport connection attempt was superseded.");
        }

        const nextConnection = {
          mintedConnection,
          sandboxInstanceId: ensureInput.sandboxInstanceId,
          transport,
        };
        transportConnectionRef.current = nextConnection;
        return nextConnection;
      })();

      pendingTransportConnectionRef.current = {
        promise,
        sandboxInstanceId: ensureInput.sandboxInstanceId,
      };

      try {
        return await promise;
      } catch (error) {
        if (transportRef.current === transport) {
          transportRef.current = null;
        }
        if (transportConnectionRef.current?.transport === transport) {
          transportConnectionRef.current = null;
        }
        transport.disconnect(1000, "Failed shared sandbox session transport.");
        throw error;
      } finally {
        if (pendingTransportConnectionRef.current?.promise === promise) {
          pendingTransportConnectionRef.current = null;
        }
      }
    },
    [disconnectTransport],
  );

  useEffect(() => {
    const previousSandboxInstanceId = previousSandboxInstanceIdRef.current;
    previousSandboxInstanceIdRef.current = input.sandboxInstanceId;

    if (previousSandboxInstanceId === input.sandboxInstanceId) {
      return;
    }

    disconnectTransport("Session workbench sandbox instance changed.");
  }, [disconnectTransport, input.sandboxInstanceId]);

  useEffect(() => {
    return () => {
      disconnectTransport("Session workbench unmounted.");
    };
  }, [disconnectTransport]);

  return {
    transportConnectionRef,
    transportRef,
    ensureTransportConnected,
    disconnectTransport,
  };
}
