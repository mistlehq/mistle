import type { CompiledRuntimeClient } from "@mistle/integrations-core";
import type { PublishControlMessage } from "@mistle/sandbox-session-protocol";
import WebSocket from "ws";

import { readLiveListenersSnapshot } from "../runtime/live-listeners/read-live-listeners-snapshot.js";
import { type ActiveWsPublishStream, type PublishStreamState } from "./publish-stream-state.js";

const PublishWebSocketHandshakeTimeoutMs = 30_000;

function createPublishWebSocketUrl(input: { path: string; port: number; query?: string }): string {
  const pathname =
    input.query === undefined || input.query.length === 0
      ? input.path
      : `${input.path}?${input.query}`;

  return `ws://127.0.0.1:${String(input.port)}${pathname}`;
}

function createOutgoingHeaders(
  headers: Record<string, string[]>,
): Record<string, string | string[]> {
  const outgoingHeaders: Record<string, string | string[]> = {};
  for (const [name, values] of Object.entries(headers)) {
    const firstValue = values[0];
    if (values.length === 1) {
      if (firstValue === undefined) {
        throw new Error(`Expected websocket header '${name}' to have one value.`);
      }

      outgoingHeaders[name] = firstValue;
      continue;
    }

    outgoingHeaders[name] = values;
  }

  return outgoingHeaders;
}

function encodeChunk(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeChunk(bytes: string): Uint8Array {
  return new Uint8Array(Buffer.from(bytes, "base64"));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSendableWebSocketCloseCode(code: number): boolean {
  return (
    code === 1000 ||
    code === 1001 ||
    code === 1002 ||
    code === 1003 ||
    code === 1007 ||
    code === 1008 ||
    code === 1009 ||
    code === 1010 ||
    code === 1011 ||
    code === 1012 ||
    code === 1013 ||
    code === 1014 ||
    (code >= 3000 && code <= 4999)
  );
}

function normalizeCloseReason(reason: string | undefined): string | undefined {
  if (reason === undefined || reason.length === 0) {
    return undefined;
  }

  const normalizedReason = Buffer.from(reason, "utf8").subarray(0, 123).toString("utf8");
  return normalizedReason.length === 0 ? undefined : normalizedReason;
}

function toUint8Array(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }

  return new Uint8Array(data);
}

async function sendPublishStreamError(input: {
  code: string;
  message: string;
  sendControlMessage: (message: PublishControlMessage) => Promise<void>;
  streamId: number;
}): Promise<void> {
  await input.sendControlMessage({
    type: "publish.stream.error",
    code: input.code,
    message: input.message,
    streamId: input.streamId,
  });
  await input.sendControlMessage({
    type: "publish.stream.close",
    streamId: input.streamId,
  });
}

async function readTargetVisibility(input: {
  port: number;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
}): Promise<"internal" | "not_live" | "user_selectable"> {
  const snapshot = await readLiveListenersSnapshot({
    runtimeClients: input.runtimeClients,
    runtimeListenAddr: input.runtimeListenAddr,
  });
  const matchingListener = snapshot.listeners.find((listener) => listener.port === input.port);
  if (matchingListener === undefined) {
    return "not_live";
  }

  return matchingListener.visibility;
}

async function createActiveWsPublishStream(input: {
  controlMessage: Extract<PublishControlMessage, { type: "publish.ws.open" }>;
  publishStreamState: PublishStreamState;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
  sendControlMessage: (message: PublishControlMessage) => Promise<void>;
}): Promise<ActiveWsPublishStream | undefined> {
  const targetVisibility = await readTargetVisibility({
    port: input.controlMessage.target.port,
    runtimeClients: input.runtimeClients,
    runtimeListenAddr: input.runtimeListenAddr,
  });
  if (targetVisibility !== "user_selectable") {
    await sendPublishStreamError({
      code: targetVisibility === "internal" ? "target_internal" : "target_not_live",
      message:
        targetVisibility === "internal"
          ? `Published target port ${String(input.controlMessage.target.port)} is internal.`
          : `Published target port ${String(input.controlMessage.target.port)} is not live.`,
      sendControlMessage: input.sendControlMessage,
      streamId: input.controlMessage.streamId,
    });
    return undefined;
  }

  const upstreamSocket = new WebSocket(
    createPublishWebSocketUrl({
      path: input.controlMessage.request.path,
      port: input.controlMessage.target.port,
      ...(input.controlMessage.request.query === undefined
        ? {}
        : {
            query: input.controlMessage.request.query,
          }),
    }),
    {
      handshakeTimeout: PublishWebSocketHandshakeTimeoutMs,
      headers: createOutgoingHeaders(input.controlMessage.request.headers),
    },
  );

  let closed = false;
  let accepted = false;

  const closeStream = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    input.publishStreamState.wsStreamsById.delete(input.controlMessage.streamId);
  };

  const failStream = async (code: string, message: string): Promise<void> => {
    if (closed) {
      return;
    }

    closeStream();
    upstreamSocket.terminate();
    await sendPublishStreamError({
      code,
      message,
      sendControlMessage: input.sendControlMessage,
      streamId: input.controlMessage.streamId,
    });
  };

  upstreamSocket.once("open", () => {
    void (async () => {
      accepted = true;
      await input.sendControlMessage({
        type: "publish.ws.accept",
        headers: {},
        streamId: input.controlMessage.streamId,
      });
    })().catch((error: unknown) => {
      void failStream(
        "upstream_accept_failed",
        `Failed acknowledging published websocket accept: ${describeError(error)}`,
      );
    });
  });

  upstreamSocket.on("message", (data, isBinary) => {
    void input
      .sendControlMessage({
        type: "publish.ws.frame",
        bytes: encodeChunk(toUint8Array(data)),
        direction: "response",
        encoding: "base64",
        opcode: isBinary ? "binary" : "text",
        streamId: input.controlMessage.streamId,
      })
      .catch((error: unknown) => {
        void failStream(
          "upstream_frame_forward_failed",
          `Failed forwarding published websocket frame: ${describeError(error)}`,
        );
      });
  });

  upstreamSocket.once("error", (error) => {
    void failStream(
      accepted ? "upstream_socket_failed" : "upstream_connect_failed",
      accepted
        ? `Published websocket upstream failed: ${describeError(error)}`
        : `Failed connecting to published websocket target: ${describeError(error)}`,
    );
  });

  upstreamSocket.once("close", (code, reasonBuffer) => {
    if (closed) {
      return;
    }

    const reason = normalizeCloseReason(reasonBuffer.toString("utf8"));
    closeStream();
    if (accepted && isSendableWebSocketCloseCode(code)) {
      void input
        .sendControlMessage({
          type: "publish.ws.close",
          code,
          direction: "response",
          ...(reason === undefined
            ? {}
            : {
                reason,
              }),
          streamId: input.controlMessage.streamId,
        })
        .catch(() => undefined);
      return;
    }

    void input
      .sendControlMessage({
        type: "publish.stream.close",
        streamId: input.controlMessage.streamId,
      })
      .catch(() => undefined);
  });

  const activeStream: ActiveWsPublishStream = {
    close: () => {
      if (closed) {
        return;
      }

      closeStream();
      upstreamSocket.terminate();
    },
    sendRequestClose: ({ code, reason }) => {
      if (closed) {
        return;
      }

      if (code !== undefined && isSendableWebSocketCloseCode(code)) {
        upstreamSocket.close(code, normalizeCloseReason(reason));
        return;
      }

      upstreamSocket.terminate();
    },
    sendRequestFrame: ({ bytes, opcode }) => {
      if (closed) {
        return;
      }

      upstreamSocket.send(opcode === "text" ? Buffer.from(bytes).toString("utf8") : bytes, {
        binary: opcode === "binary",
      });
    },
    streamId: input.controlMessage.streamId,
  };

  input.publishStreamState.wsStreamsById.set(input.controlMessage.streamId, activeStream);
  return activeStream;
}

export async function handleWsProxyControlMessage(input: {
  controlMessage: PublishControlMessage;
  publishStreamState: PublishStreamState;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
  sendControlMessage: (message: PublishControlMessage) => Promise<void>;
}): Promise<boolean> {
  switch (input.controlMessage.type) {
    case "publish.ws.open": {
      if (input.publishStreamState.wsStreamsById.has(input.controlMessage.streamId)) {
        await sendPublishStreamError({
          code: "stream_already_open",
          message: `Publish stream '${String(input.controlMessage.streamId)}' is already open.`,
          sendControlMessage: input.sendControlMessage,
          streamId: input.controlMessage.streamId,
        });
        return true;
      }

      await createActiveWsPublishStream({
        controlMessage: input.controlMessage,
        publishStreamState: input.publishStreamState,
        runtimeClients: input.runtimeClients,
        runtimeListenAddr: input.runtimeListenAddr,
        sendControlMessage: input.sendControlMessage,
      });
      return true;
    }
    case "publish.ws.frame": {
      if (input.controlMessage.direction !== "request") {
        return true;
      }

      input.publishStreamState.wsStreamsById.get(input.controlMessage.streamId)?.sendRequestFrame({
        bytes: decodeChunk(input.controlMessage.bytes),
        opcode: input.controlMessage.opcode,
      });
      return true;
    }
    case "publish.ws.close": {
      if (input.controlMessage.direction !== "request") {
        return true;
      }

      input.publishStreamState.wsStreamsById.get(input.controlMessage.streamId)?.sendRequestClose({
        code: input.controlMessage.code,
        ...(input.controlMessage.reason === undefined
          ? {}
          : {
              reason: input.controlMessage.reason,
            }),
      });
      return true;
    }
    case "publish.stream.close": {
      input.publishStreamState.wsStreamsById.get(input.controlMessage.streamId)?.close();
      return true;
    }
    default:
      return false;
  }
}
