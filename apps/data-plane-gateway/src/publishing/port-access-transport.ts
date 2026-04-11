import {
  type PortAccessTarget,
  type PortsHttpBodyChunk,
  type PortsHttpBodyEnd,
  type PortsHttpOpen,
  type PortsHttpResponseStart,
  type PortsStreamError,
  type PortsTransportMessage,
} from "@mistle/sandbox-session-protocol";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import { PortAccessSessionCookieName } from "./auth/port-access-session.js";

const HopByHopHeaderNames = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type RepeatedHeaderValues = Record<string, string[]>;

type ActivePortAccessHttpStream = {
  responseStarted: boolean;
  rejectResponseStart: (error: Error) => void;
  resolveResponseStart: (responseStart: PortsHttpResponseStart) => void;
  responseBodyWriter: WritableStreamDefaultWriter<Uint8Array>;
};

export type PortAccessHttpRequestHandle = {
  close: () => Promise<void>;
  finishRequestBody: () => Promise<void>;
  responseBody: ReadableStream<Uint8Array>;
  responseStart: Promise<PortsHttpResponseStart>;
  sendRequestBodyChunk: (bytes: Uint8Array) => Promise<void>;
};

export class PortAccessTransportBootstrapDisconnectedError extends Error {
  public constructor(sandboxInstanceId: string) {
    super(
      `Sandbox bootstrap tunnel disconnected before port access transport completed for sandbox '${sandboxInstanceId}'.`,
    );
  }
}

export class PortAccessTransportStreamError extends Error {
  public readonly code: PortsStreamError["code"];

  public constructor(input: { code: PortsStreamError["code"]; message: string }) {
    super(input.message);
    this.code = input.code;
  }
}

function stripPortAccessSessionCookie(cookieHeader: string): string | undefined {
  const remainingSegments = cookieHeader
    .split(";")
    .map((segment) => segment.trim())
    .filter(
      (segment) => segment.length > 0 && !segment.startsWith(`${PortAccessSessionCookieName}=`),
    );
  if (remainingSegments.length === 0) {
    return undefined;
  }

  return remainingSegments.join("; ");
}

export function buildPortAccessRequestHeaders(input: {
  browserEdgePort: string;
  browserEdgeProto: "http" | "https";
  browserVisibleHost: string;
  requestHeaders: Headers;
  targetPort: number;
  upstreamProtocol: "http" | "https";
}): RepeatedHeaderValues {
  const tunneledHeaders: RepeatedHeaderValues = {};

  for (const [headerName, value] of input.requestHeaders.entries()) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (HopByHopHeaderNames.has(normalizedHeaderName) || normalizedHeaderName === "host") {
      continue;
    }

    if (normalizedHeaderName === "cookie") {
      const sanitizedCookieHeader = stripPortAccessSessionCookie(value);
      if (sanitizedCookieHeader === undefined) {
        continue;
      }

      tunneledHeaders.cookie = [sanitizedCookieHeader];
      continue;
    }

    if (normalizedHeaderName === "origin") {
      tunneledHeaders.origin = [
        `${input.upstreamProtocol}://127.0.0.1:${String(input.targetPort)}`,
      ];
      continue;
    }

    tunneledHeaders[normalizedHeaderName] = [value];
  }

  tunneledHeaders.host = [`127.0.0.1:${String(input.targetPort)}`];
  tunneledHeaders["x-forwarded-host"] = [input.browserVisibleHost];
  tunneledHeaders["x-forwarded-proto"] = [input.browserEdgeProto];
  tunneledHeaders["x-forwarded-port"] = [input.browserEdgePort];

  return tunneledHeaders;
}

export function toPortAccessResponseHeaders(headers: PortsHttpResponseStart["headers"]): Headers {
  const responseHeaders = new Headers();
  for (const [headerName, values] of Object.entries(headers)) {
    for (const value of values) {
      responseHeaders.append(headerName, value);
    }
  }

  return responseHeaders;
}

export class PortAccessTransportService {
  readonly #activeHttpStreamsBySandboxInstanceId = new Map<
    string,
    Map<number, ActivePortAccessHttpStream>
  >();
  #nextStreamId = 1;

  public constructor(
    private readonly relayCoordinator: Pick<
      TunnelRelayCoordinator,
      "forwardPeerMessage" | "getBootstrapPeer"
    >,
  ) {}

  public async openHttpStream(input: {
    request: PortsHttpOpen["request"];
    sandboxInstanceId: string;
    target: PortAccessTarget;
    upstreamProtocol: "http" | "https";
  }): Promise<PortAccessHttpRequestHandle> {
    if (
      this.relayCoordinator.getBootstrapPeer({
        sandboxInstanceId: input.sandboxInstanceId,
      }) === undefined
    ) {
      throw new BootstrapTunnelNotConnectedError(input.sandboxInstanceId);
    }

    const streamId = this.allocateStreamId();
    const responseStream = new TransformStream<Uint8Array, Uint8Array>();
    const responseBodyWriter = responseStream.writable.getWriter();
    let resolveResponseStart: ((responseStart: PortsHttpResponseStart) => void) | undefined;
    let rejectResponseStart: ((error: Error) => void) | undefined;
    const responseStart = new Promise<PortsHttpResponseStart>((resolve, reject) => {
      resolveResponseStart = resolve;
      rejectResponseStart = reject;
    });
    if (resolveResponseStart === undefined || rejectResponseStart === undefined) {
      throw new Error("Port access responseStart promise callbacks were not initialized.");
    }

    this.setActiveHttpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId,
      stream: {
        responseStarted: false,
        rejectResponseStart,
        resolveResponseStart,
        responseBodyWriter,
      },
    });

    try {
      await this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        payload: JSON.stringify({
          type: "ports.http.open",
          streamId,
          target: input.target,
          upstreamProtocol: input.upstreamProtocol,
          request: input.request,
        } satisfies PortsHttpOpen),
      });
    } catch (error) {
      this.deleteActiveHttpStream({
        sandboxInstanceId: input.sandboxInstanceId,
        streamId,
      });
      await responseBodyWriter.abort(error);
      throw error;
    }

    return {
      close: async () => {
        this.deleteActiveHttpStream({
          sandboxInstanceId: input.sandboxInstanceId,
          streamId,
        });
        await responseBodyWriter.abort();
        await this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          payload: JSON.stringify({
            type: "ports.stream.close",
            streamId,
          }),
        });
      },
      finishRequestBody: async () => {
        await this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          payload: JSON.stringify({
            type: "ports.http.body.end",
            streamId,
            direction: "request",
          } satisfies PortsHttpBodyEnd),
        });
      },
      responseBody: responseStream.readable,
      responseStart,
      sendRequestBodyChunk: async (bytes) => {
        await this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          payload: JSON.stringify({
            type: "ports.http.body.chunk",
            streamId,
            direction: "request",
            bytes: Buffer.from(bytes).toString("base64"),
            encoding: "base64",
          } satisfies PortsHttpBodyChunk),
        });
      },
    };
  }

  public async handleBootstrapTransportMessage(input: {
    message: PortsTransportMessage;
    sandboxInstanceId: string;
  }): Promise<boolean> {
    const activeStream = this.getActiveHttpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId: input.message.streamId,
    });
    if (activeStream === undefined) {
      return false;
    }

    switch (input.message.type) {
      case "ports.http.response.start": {
        activeStream.responseStarted = true;
        activeStream.resolveResponseStart(input.message);
        return true;
      }
      case "ports.http.body.chunk": {
        if (input.message.direction !== "response") {
          await this.failHttpStream({
            error: new PortAccessTransportStreamError({
              code: "upstream_io_error",
              message: "Gateway received a non-response body chunk from sandboxd.",
            }),
            sandboxInstanceId: input.sandboxInstanceId,
            streamId: input.message.streamId,
          });
          return true;
        }

        await activeStream.responseBodyWriter.write(
          Uint8Array.from(Buffer.from(input.message.bytes, "base64")),
        );
        return true;
      }
      case "ports.http.body.end": {
        this.deleteActiveHttpStream({
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: input.message.streamId,
        });
        await activeStream.responseBodyWriter.close();
        return true;
      }
      case "ports.stream.error": {
        await this.failHttpStream({
          error: new PortAccessTransportStreamError({
            code: input.message.code,
            message: input.message.message,
          }),
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: input.message.streamId,
        });
        return true;
      }
      case "ports.http.open":
      case "ports.ws.open":
      case "ports.ws.accept":
      case "ports.ws.frame":
      case "ports.ws.close":
      case "ports.stream.close": {
        return false;
      }
    }
  }

  public rejectPendingStreamsForSandbox(input: { sandboxInstanceId: string }): void {
    const activeStreams = this.#activeHttpStreamsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (activeStreams === undefined) {
      return;
    }

    this.#activeHttpStreamsBySandboxInstanceId.delete(input.sandboxInstanceId);
    for (const [streamId, stream] of activeStreams) {
      const disconnectError = new PortAccessTransportBootstrapDisconnectedError(
        input.sandboxInstanceId,
      );
      if (!stream.responseStarted) {
        stream.rejectResponseStart(disconnectError);
      }
      void stream.responseBodyWriter.abort(disconnectError);
      void this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        payload: JSON.stringify({
          type: "ports.stream.close",
          streamId,
        }),
      }).catch(() => undefined);
    }
  }

  private allocateStreamId(): number {
    const streamId = this.#nextStreamId;
    this.#nextStreamId += 1;
    return streamId;
  }

  private deleteActiveHttpStream(input: { sandboxInstanceId: string; streamId: number }): void {
    const sandboxStreams = this.#activeHttpStreamsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (sandboxStreams === undefined) {
      return;
    }

    sandboxStreams.delete(input.streamId);
    if (sandboxStreams.size === 0) {
      this.#activeHttpStreamsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
  }

  private async failHttpStream(input: {
    error: Error;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const activeStream = this.getActiveHttpStream(input);
    if (activeStream === undefined) {
      return;
    }

    this.deleteActiveHttpStream(input);
    if (!activeStream.responseStarted) {
      activeStream.rejectResponseStart(input.error);
    }
    await activeStream.responseBodyWriter.abort(input.error);
  }

  private async forwardMessage(input: {
    payload: string;
    sandboxInstanceId: string;
  }): Promise<void> {
    await this.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      fromSide: "connection",
      payload: input.payload,
    });
  }

  private getActiveHttpStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): ActivePortAccessHttpStream | undefined {
    return this.#activeHttpStreamsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.get(input.streamId);
  }

  private setActiveHttpStream(input: {
    sandboxInstanceId: string;
    stream: ActivePortAccessHttpStream;
    streamId: number;
  }): void {
    const sandboxStreams =
      this.#activeHttpStreamsBySandboxInstanceId.get(input.sandboxInstanceId) ?? new Map();
    sandboxStreams.set(input.streamId, input.stream);
    this.#activeHttpStreamsBySandboxInstanceId.set(input.sandboxInstanceId, sandboxStreams);
  }
}
