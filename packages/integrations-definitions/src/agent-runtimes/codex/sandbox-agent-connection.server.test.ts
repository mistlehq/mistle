import { SandboxSessionStreamOpenError } from "@mistle/sandbox-session-client";
import { describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import { connectSandboxAgentConnection } from "./sandbox-agent-connection.server.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type RejectingAgentServer = {
  url: string;
  streamOpenRequest: Promise<void>;
  close: () => Promise<void>;
};

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
  };
}

function toText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function parseStreamOpenMessage(data: RawData): number {
  const payloadText = toText(data);

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    throw new Error("Expected agent connect request payload to be valid JSON.");
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("Expected agent connect request payload to be an object.");
  }

  if (
    !("type" in parsedPayload) ||
    !("streamId" in parsedPayload) ||
    !("channel" in parsedPayload)
  ) {
    throw new Error("Expected agent stream.open payload to include type/streamId/channel.");
  }

  const typeValue = parsedPayload.type;
  const streamIdValue = parsedPayload.streamId;
  const channelValue = parsedPayload.channel;

  if (typeValue !== "stream.open") {
    throw new Error(
      `Expected agent stream open type to be 'stream.open', received '${String(typeValue)}'.`,
    );
  }

  if (typeof streamIdValue !== "number" || !Number.isInteger(streamIdValue) || streamIdValue <= 0) {
    throw new Error("Expected agent stream.open streamId to be a positive integer.");
  }

  if (
    typeof channelValue !== "object" ||
    channelValue === null ||
    Array.isArray(channelValue) ||
    !("kind" in channelValue) ||
    channelValue.kind !== "agent"
  ) {
    throw new Error("Expected connect request channel.kind to be 'agent'.");
  }

  return streamIdValue;
}

async function startRejectingAgentServer(input: {
  code: string;
  message: string;
}): Promise<RejectingAgentServer> {
  const streamOpenRequestDeferred = createDeferred<void>();
  const sockets = new Set<WebSocket>();
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    socket.once("error", (error) => {
      streamOpenRequestDeferred.reject(error);
    });
    socket.once("message", (message) => {
      try {
        const streamId = parseStreamOpenMessage(message);
        socket.send(
          JSON.stringify({
            type: "stream.open.error",
            streamId,
            code: input.code,
            message: input.message,
          }),
        );
        streamOpenRequestDeferred.resolve();
      } catch (error) {
        streamOpenRequestDeferred.reject(error);
      }
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    streamOpenRequest: streamOpenRequestDeferred.promise,
    close: async () => {
      for (const socket of sockets) {
        socket.close();
      }

      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

describe("connectSandboxAgentConnection", () => {
  it("preserves structured stream-open errors from the sandbox session client", async () => {
    const server = await startRejectingAgentServer({
      code: "bootstrap_not_connected",
      message: "Sandbox bootstrap tunnel is not connected",
    });

    try {
      const error = await connectSandboxAgentConnection({
        connectionUrl: server.url,
      }).then(
        () => undefined,
        (caughtError: unknown) => caughtError,
      );

      await server.streamOpenRequest;
      expect(error).toBeInstanceOf(SandboxSessionStreamOpenError);
      if (!(error instanceof SandboxSessionStreamOpenError)) {
        throw new Error("Expected sandbox agent connection to reject with a stream-open error.");
      }

      expect(error.openError.code).toBe("bootstrap_not_connected");
      expect(error.openError.message).toBe("Sandbox bootstrap tunnel is not connected");
    } finally {
      await server.close();
    }
  });
});
