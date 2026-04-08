import {
  AgentStreamClient,
  SandboxSessionTransport,
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
  sessionClient: AgentStreamClient;
  sendText: (message: string) => Promise<void>;
  close: (input?: CloseSandboxAgentConnectionInput) => Promise<void>;
};

function formatOpenErrorMessage(client: AgentStreamClient): string {
  const openError = client.openError;
  if (openError === null) {
    return (
      client.errorMessage ?? "Sandbox agent websocket closed before stream.open acknowledgement."
    );
  }

  return `Sandbox agent stream.open request was rejected (${openError.code}): ${openError.message}`;
}

function formatResetErrorMessage(client: AgentStreamClient): string | null {
  const resetInfo = client.resetInfo;
  if (resetInfo === null) {
    return null;
  }

  return `Sandbox agent stream was reset (${resetInfo.code}): ${resetInfo.message}`;
}

export async function connectSandboxAgentConnection(
  input: ConnectSandboxAgentConnectionInput,
): Promise<SandboxAgentConnection> {
  const runtime = createNodeSandboxSessionRuntime();
  const transport = new SandboxSessionTransport({
    runtime,
    connectTimeoutMs: input.connectTimeoutMs ?? DefaultConnectTimeoutMs,
  });
  const client = new AgentStreamClient({
    transport,
  });

  await transport.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    await client.connect();
  } catch (error) {
    client.disconnect();
    transport.disconnect();

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
    transport.disconnect();
    throw new Error("Sandbox session client did not expose streamId after connect.");
  }

  const socket = client.socket;
  if (socket === null) {
    client.disconnect();
    transport.disconnect();
    throw new Error("Sandbox session client did not expose socket after connect.");
  }

  return {
    streamId,
    socket,
    sessionClient: client,
    sendText: async (message) => {
      try {
        await client.sendText(message);
      } catch (error) {
        const resetErrorMessage = formatResetErrorMessage(client);
        if (resetErrorMessage !== null) {
          throw new Error(resetErrorMessage, {
            cause: error,
          });
        }

        throw error;
      }
    },
    close: async (closeInput) =>
      await new Promise<void>((resolve, reject) => {
        if (socket.readyState === SandboxSessionSocketReadyStates.CLOSED) {
          client.disconnect();
          transport.disconnect(
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

        client.disconnect();
        transport.disconnect(
          closeInput?.code ?? DefaultCloseCode,
          closeInput?.reason ?? DefaultCloseReason,
        );
      }),
  };
}
