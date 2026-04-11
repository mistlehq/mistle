import type { SandboxSessionStream } from "@mistle/sandbox-session-client";
import {
  parseProcessesStreamMessage,
  PayloadKindWebSocketText,
  type ProcessEntry,
} from "@mistle/sandbox-session-protocol";
import { useEffect, useState } from "react";

import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

type SessionProcessesState = {
  errorMessage: string | null;
  isLoading: boolean;
  observedAt: string | null;
  processes: ProcessEntry[];
};

function createProcessesRefreshPayload(): Uint8Array {
  return textEncoder.encode(
    JSON.stringify({
      type: "processes.refresh",
    }),
  );
}

async function closeProcessesStream(stream: SandboxSessionStream): Promise<void> {
  if (stream.state === "open") {
    await stream.sendControl({
      type: "stream.close",
    });
  }
}

function normalizeProcessesError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not load sandbox processes.";
}

export function useSessionProcesses(input: {
  enabled: boolean;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string | null;
}): SessionProcessesState {
  const [state, setState] = useState<SessionProcessesState>({
    errorMessage: null,
    isLoading: false,
    observedAt: null,
    processes: [],
  });

  useEffect(() => {
    if (!input.enabled || input.sandboxInstanceId === null) {
      setState({
        errorMessage: null,
        isLoading: false,
        observedAt: null,
        processes: [],
      });
      return;
    }

    let isDisposed = false;
    let stream: SandboxSessionStream | null = null;
    let unsubscribe: (() => void) | null = null;
    const sandboxInstanceId = input.sandboxInstanceId;

    if (sandboxInstanceId === null) {
      throw new Error("Session id is required.");
    }

    setState((currentState) => ({
      ...currentState,
      errorMessage: null,
      isLoading: true,
    }));

    void (async () => {
      try {
        const { transport } = await input.ensureTransportConnected({
          sandboxInstanceId,
        });
        if (isDisposed) {
          return;
        }

        stream = await transport.openStream({
          channel: {
            kind: "processes",
          },
        });
        if (isDisposed) {
          await closeProcessesStream(stream);
          stream.dispose();
          return;
        }

        unsubscribe = stream.onEvent((event) => {
          if (isDisposed) {
            return;
          }

          if (event.type === "data" && event.frame.payloadKind === PayloadKindWebSocketText) {
            const message = parseProcessesStreamMessage(textDecoder.decode(event.frame.payload));
            if (message?.type === "processes.snapshot") {
              setState({
                errorMessage: null,
                isLoading: false,
                observedAt: message.observedAt,
                processes: message.processes,
              });
            }
            return;
          }

          if (
            event.type === "state_changed" &&
            event.state !== "open" &&
            event.state !== "opening"
          ) {
            setState((currentState) => ({
              ...currentState,
              errorMessage: event.errorMessage ?? "Sandbox processes stream closed unexpectedly.",
              isLoading: false,
            }));
          }
        });

        await stream.sendDataFrame({
          payload: createProcessesRefreshPayload(),
          payloadKind: PayloadKindWebSocketText,
        });
      } catch (error) {
        if (isDisposed) {
          return;
        }

        setState({
          errorMessage: normalizeProcessesError(error),
          isLoading: false,
          observedAt: null,
          processes: [],
        });
      }
    })();

    return () => {
      isDisposed = true;
      unsubscribe?.();
      if (stream !== null) {
        void closeProcessesStream(stream).catch(() => {
          return;
        });
        stream.dispose();
      }
    };
  }, [input.enabled, input.ensureTransportConnected, input.sandboxInstanceId]);

  return state;
}

export type { SessionProcessesState };
