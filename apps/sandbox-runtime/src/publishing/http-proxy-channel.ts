import { once } from "node:events";
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";

import type { CompiledRuntimeClient } from "@mistle/integrations-core";
import type { PublishControlMessage } from "@mistle/sandbox-session-protocol";

import { readLiveListenersSnapshot } from "../runtime/live-listeners/read-live-listeners-snapshot.js";
import {
  closeAllPublishStreams,
  type ActiveHttpPublishStream,
  type PublishStreamState,
} from "./publish-stream-state.js";

const PublishHttpChunkSizeBytes = 32 * 1024;
const PublishHttpIdleTimeoutMs = 30_000;

function createPublishHttpPath(input: { path: string; query?: string }): string {
  return input.query === undefined || input.query.length === 0
    ? input.path
    : `${input.path}?${input.query}`;
}

function createOutgoingHeaders(headers: Record<string, string[]>): OutgoingHttpHeaders {
  const outgoingHeaders: OutgoingHttpHeaders = {};
  for (const [name, values] of Object.entries(headers)) {
    outgoingHeaders[name] = values.length === 1 ? values[0] : values;
  }

  return outgoingHeaders;
}

function createHeaderMapFromRawHeaders(rawHeaders: readonly string[]): Record<string, string[]> {
  const headers: Record<string, string[]> = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name === undefined || value === undefined) {
      continue;
    }

    const normalizedName = name.toLowerCase();
    const existingValues = headers[normalizedName];
    if (existingValues === undefined) {
      headers[normalizedName] = [value];
      continue;
    }

    existingValues.push(value);
  }

  return headers;
}

function encodeChunk(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeChunk(bytes: string): Uint8Array {
  return new Uint8Array(Buffer.from(bytes, "base64"));
}

function splitChunks(bytes: Uint8Array): Uint8Array[] {
  if (bytes.byteLength <= PublishHttpChunkSizeBytes) {
    return [bytes];
  }

  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const endOffset = Math.min(offset + PublishHttpChunkSizeBytes, bytes.byteLength);
    chunks.push(bytes.subarray(offset, endOffset));
    offset = endOffset;
  }

  return chunks;
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeRequestChunk(input: {
  bytes: Uint8Array;
  request: ReturnType<typeof httpRequest>;
}): Promise<void> {
  const drained = input.request.write(input.bytes);
  if (drained) {
    return;
  }

  await once(input.request, "drain");
}

async function streamUpstreamResponse(input: {
  response: IncomingMessage;
  sendControlMessage: (message: PublishControlMessage) => Promise<void>;
  streamId: number;
}): Promise<void> {
  await input.sendControlMessage({
    type: "publish.http.response.start",
    headers: createHeaderMapFromRawHeaders(input.response.rawHeaders),
    status: input.response.statusCode ?? 502,
    streamId: input.streamId,
  });

  for await (const rawChunk of input.response) {
    const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(Buffer.from(rawChunk));
    for (const responseChunk of splitChunks(chunk)) {
      await input.sendControlMessage({
        type: "publish.http.body.chunk",
        bytes: encodeChunk(responseChunk),
        direction: "response",
        encoding: "base64",
        streamId: input.streamId,
      });
    }
  }

  await input.sendControlMessage({
    type: "publish.http.body.end",
    direction: "response",
    streamId: input.streamId,
  });
  await input.sendControlMessage({
    type: "publish.stream.close",
    streamId: input.streamId,
  });
}

async function createActiveHttpPublishStream(input: {
  controlMessage: Extract<PublishControlMessage, { type: "publish.http.open" }>;
  publishStreamState: PublishStreamState;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
  sendControlMessage: (message: PublishControlMessage) => Promise<void>;
}): Promise<ActiveHttpPublishStream | undefined> {
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

  const request = httpRequest({
    headers: createOutgoingHeaders(input.controlMessage.request.headers),
    host: "127.0.0.1",
    method: input.controlMessage.request.method,
    path: createPublishHttpPath({
      path: input.controlMessage.request.path,
      ...(input.controlMessage.request.query === undefined
        ? {}
        : {
            query: input.controlMessage.request.query,
          }),
    }),
    port: input.controlMessage.target.port,
  });
  request.setTimeout(PublishHttpIdleTimeoutMs);

  let closed = false;
  let requestEnded = false;

  const failStream = async (code: string, message: string): Promise<void> => {
    if (closed) {
      return;
    }

    closed = true;
    input.publishStreamState.httpStreamsById.delete(input.controlMessage.streamId);
    request.destroy();
    await sendPublishStreamError({
      code,
      message,
      sendControlMessage: input.sendControlMessage,
      streamId: input.controlMessage.streamId,
    });
  };

  request.once("timeout", () => {
    void failStream(
      "upstream_request_timeout",
      `Published HTTP upstream request timed out for stream '${String(input.controlMessage.streamId)}'.`,
    );
  });
  request.once("error", (error) => {
    void failStream(
      "upstream_connect_failed",
      `Failed connecting to published HTTP target: ${describeError(error)}`,
    );
  });
  request.once("response", (response) => {
    void (async () => {
      try {
        await streamUpstreamResponse({
          response,
          sendControlMessage: input.sendControlMessage,
          streamId: input.controlMessage.streamId,
        });
        if (closed) {
          return;
        }

        closed = true;
        input.publishStreamState.httpStreamsById.delete(input.controlMessage.streamId);
      } catch (error) {
        await failStream(
          "upstream_response_failed",
          `Failed streaming published HTTP response: ${describeError(error)}`,
        );
      }
    })();
  });

  const activeStream: ActiveHttpPublishStream = {
    close: () => {
      if (closed) {
        return;
      }

      closed = true;
      input.publishStreamState.httpStreamsById.delete(input.controlMessage.streamId);
      request.destroy();
    },
    endRequestBody: () => {
      if (closed || requestEnded) {
        return;
      }

      requestEnded = true;
      request.end();
    },
    streamId: input.controlMessage.streamId,
    writeRequestChunk: async (bytes: Uint8Array) => {
      if (closed) {
        throw new Error(
          `Published HTTP request stream '${String(input.controlMessage.streamId)}' is closed.`,
        );
      }
      if (requestEnded) {
        throw new Error(
          `Published HTTP request stream '${String(input.controlMessage.streamId)}' is already ended.`,
        );
      }

      await writeRequestChunk({
        bytes,
        request,
      });
    },
  };

  input.publishStreamState.httpStreamsById.set(input.controlMessage.streamId, activeStream);
  return activeStream;
}

export async function handleHttpProxyControlMessage(input: {
  controlMessage: PublishControlMessage;
  publishStreamState: PublishStreamState;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
  sendControlMessage: (message: PublishControlMessage) => Promise<void>;
}): Promise<boolean> {
  switch (input.controlMessage.type) {
    case "publish.http.open": {
      if (input.publishStreamState.httpStreamsById.has(input.controlMessage.streamId)) {
        await sendPublishStreamError({
          code: "stream_already_open",
          message: `Publish stream '${String(input.controlMessage.streamId)}' is already open.`,
          sendControlMessage: input.sendControlMessage,
          streamId: input.controlMessage.streamId,
        });
        return true;
      }

      await createActiveHttpPublishStream({
        controlMessage: input.controlMessage,
        publishStreamState: input.publishStreamState,
        runtimeClients: input.runtimeClients,
        runtimeListenAddr: input.runtimeListenAddr,
        sendControlMessage: input.sendControlMessage,
      });
      return true;
    }
    case "publish.http.body.chunk": {
      if (input.controlMessage.direction !== "request") {
        return true;
      }

      const activeStream = input.publishStreamState.httpStreamsById.get(
        input.controlMessage.streamId,
      );
      if (activeStream === undefined) {
        return true;
      }

      try {
        await activeStream.writeRequestChunk(decodeChunk(input.controlMessage.bytes));
      } catch (error) {
        activeStream.close();
        await sendPublishStreamError({
          code: "request_body_write_failed",
          message: `Failed writing published HTTP request body: ${describeError(error)}`,
          sendControlMessage: input.sendControlMessage,
          streamId: input.controlMessage.streamId,
        });
      }

      return true;
    }
    case "publish.http.body.end": {
      if (input.controlMessage.direction !== "request") {
        return true;
      }

      input.publishStreamState.httpStreamsById.get(input.controlMessage.streamId)?.endRequestBody();
      return true;
    }
    case "publish.stream.close": {
      input.publishStreamState.httpStreamsById.get(input.controlMessage.streamId)?.close();
      return true;
    }
    default:
      return false;
  }
}

export { closeAllPublishStreams };
