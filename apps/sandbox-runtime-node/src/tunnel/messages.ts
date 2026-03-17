import {
  encodeDataFrame,
  type ExecutionLease,
  type LeaseCreate,
  type LeaseRenew,
  type StreamClose,
  type StreamEventMessage,
  type StreamOpenError,
  type StreamOpenOK,
  type StreamReset,
  type StreamWindow,
} from "@mistle/sandbox-session-protocol";
import type WebSocket from "ws";

export const CONNECT_ERROR_CODE_UNSUPPORTED_CHANNEL = "unsupported_channel";
export const CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST = "invalid_connect_request";
export const CONNECT_ERROR_CODE_AGENT_ENDPOINT_UNAVAILABLE = "agent_endpoint_unavailable";
export const CONNECT_ERROR_CODE_UNSUPPORTED_CONNECTION_MODE = "unsupported_connection_mode";
export const CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED = "agent_endpoint_dial_failed";
export const CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE = "pty_session_unavailable";
export const CONNECT_ERROR_CODE_PTY_SESSION_EXISTS = "pty_session_exists";
export const CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED = "pty_session_create_failed";
export const PTY_CONNECT_ERROR_CODE_INVALID_SESSION_SELECTION = "invalid_pty_session_mode";
export const STREAM_RESET_CODE_INVALID_STREAM_SIGNAL = "invalid_stream_signal";
export const STREAM_RESET_CODE_INVALID_STREAM_CLOSE = "invalid_stream_close";
export const STREAM_RESET_CODE_INVALID_STREAM_DATA = "invalid_stream_data";
export const STREAM_RESET_CODE_INVALID_STREAM_WINDOW = "invalid_stream_window";
export const STREAM_RESET_CODE_STREAM_CLOSE_FAILED = "stream_close_failed";
export const STREAM_RESET_CODE_TARGET_CLOSED = "target_closed";
export const STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED = "stream_window_exhausted";

function sendWebSocketPayload(
  socket: WebSocket,
  payload: string | Uint8Array,
  isBinary: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.send(payload, { binary: isBinary }, (error: Error | undefined) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function writeTextJsonMessage(socket: WebSocket, payload: object): Promise<void> {
  await sendWebSocketPayload(socket, JSON.stringify(payload), false);
}

export function writeStreamOpenOk(socket: WebSocket, streamOpenOk: StreamOpenOK): Promise<void> {
  return writeTextJsonMessage(socket, streamOpenOk);
}

export function writeStreamOpenError(
  socket: WebSocket,
  streamOpenError: StreamOpenError,
): Promise<void> {
  return writeTextJsonMessage(socket, streamOpenError);
}

export function writeStreamEvent(
  socket: WebSocket,
  streamEvent: StreamEventMessage,
): Promise<void> {
  return writeTextJsonMessage(socket, streamEvent);
}

export function writeStreamReset(socket: WebSocket, streamReset: StreamReset): Promise<void> {
  return writeTextJsonMessage(socket, streamReset);
}

export function writeStreamWindow(socket: WebSocket, streamWindow: StreamWindow): Promise<void> {
  return writeTextJsonMessage(socket, streamWindow);
}

export function writeLeaseCreate(socket: WebSocket, lease: ExecutionLease): Promise<void> {
  const message: LeaseCreate = {
    type: "lease.create",
    lease,
  };

  return writeTextJsonMessage(socket, message);
}

export function writeLeaseRenew(socket: WebSocket, leaseId: string): Promise<void> {
  const message: LeaseRenew = {
    type: "lease.renew",
    leaseId,
  };

  return writeTextJsonMessage(socket, message);
}

export function writeBinaryDataFrame(
  socket: WebSocket,
  input: {
    streamId: number;
    payloadKind: number;
    payload: Uint8Array;
  },
): Promise<void> {
  return sendWebSocketPayload(
    socket,
    encodeDataFrame({
      streamId: input.streamId,
      payloadKind: input.payloadKind,
      payload: input.payload,
    }),
    true,
  );
}

export function createPtyExitEventMessage(streamId: number, exitCode: number): StreamEventMessage {
  return {
    type: "stream.event",
    streamId,
    event: {
      type: "pty.exit",
      exitCode,
    },
  };
}

export function createStreamClose(streamId: number): StreamClose {
  return {
    type: "stream.close",
    streamId,
  };
}

export function createPtyResizeSignal(
  streamId: number,
  cols: number,
  rows: number,
): {
  type: "stream.signal";
  streamId: number;
  signal: {
    type: "pty.resize";
    cols: number;
    rows: number;
  };
} {
  return {
    type: "stream.signal",
    streamId,
    signal: {
      type: "pty.resize",
      cols,
      rows,
    },
  };
}
