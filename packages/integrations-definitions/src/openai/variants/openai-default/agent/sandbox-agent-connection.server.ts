import {
  SandboxSessionClient,
  type SandboxSessionSocket,
  SandboxSessionSocketReadyStates,
} from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";

const DefaultConnectTimeoutMs = 15_000;
const DefaultCloseCode = 1000;
const DefaultCloseReason = "automation payload delivered";

export type ConnectSandboxAgentConnectionInput = {
  connectionUrl: string;
  connectTimeoutMs?: number;
};

export type CloseSandboxAgentConnectionInput = {
  code?: number;
  reason?: string;
};

export type SandboxAgentConnection = {
  streamId: number;
  socket: SandboxSessionSocket;
  sessionClient: SandboxSessionClient;
  sendText: (message: string) => Promise<void>;
  close: (input?: CloseSandboxAgentConnectionInput) => Promise<void>;
};

function formatOpenErrorMessage(client: SandboxSessionClient): string {
  const openError = client.openError;
  if (openError === null) {
    return (
      client.errorMessage ?? "Sandbox agent websocket closed before stream.open acknowledgement."
    );
  }

  return `Sandbox agent stream.open request was rejected (${openError.code}): ${openError.message}`;
}

export async function connectSandboxAgentConnection(
  input: ConnectSandboxAgentConnectionInput,
): Promise<SandboxAgentConnection> {
  const client = new SandboxSessionClient({
    connectionUrl: input.connectionUrl,
    runtime: createNodeSandboxSessionRuntime(),
    connectTimeoutMs: input.connectTimeoutMs ?? DefaultConnectTimeoutMs,
  });

  try {
    await client.connect();
  } catch (error) {
    client.disconnect();

    if (client.openError !== null) {
      throw new Error(formatOpenErrorMessage(client), {
        cause: error,
      });
    }

    throw error;
  }

  const streamId = client.streamId;
  if (streamId === null) {
    client.disconnect();
    throw new Error("Sandbox session client did not expose streamId after connect.");
  }

  const socket = client.socket;
  if (socket === null) {
    client.disconnect();
    throw new Error("Sandbox session client did not expose socket after connect.");
  }

  return {
    streamId,
    socket,
    sessionClient: client,
    sendText: (message) => client.sendText(message),
    close: async (closeInput) =>
      await new Promise<void>((resolve, reject) => {
        if (socket.readyState === SandboxSessionSocketReadyStates.CLOSED) {
          client.disconnect(
            closeInput?.code ?? DefaultCloseCode,
            closeInput?.reason ?? DefaultCloseReason,
          );
          resolve();
          return;
        }

        const handleClose = (): void => {
          cleanup();
          resolve();
        };

        const handleError = (error: unknown): void => {
          cleanup();
          reject(
            error instanceof Error ? error : new Error("Sandbox agent websocket close failed."),
          );
        };

        const cleanup = (): void => {
          socket.removeEventListener("close", handleClose);
          socket.removeEventListener("error", handleError);
        };

        socket.addEventListener("close", handleClose);
        socket.addEventListener("error", handleError);

        client.disconnect(
          closeInput?.code ?? DefaultCloseCode,
          closeInput?.reason ?? DefaultCloseReason,
        );
      }),
  };
}
