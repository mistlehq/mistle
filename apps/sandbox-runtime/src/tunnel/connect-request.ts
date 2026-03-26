import type {
  StreamClose,
  StreamOpen,
  StreamSignalMessage,
} from "@mistle/sandbox-session-protocol";
import { parseStreamControlMessage } from "@mistle/sandbox-session-protocol";

export type TunnelSocketMessage =
  | {
      kind: "text";
      payload: string;
    }
  | {
      kind: "binary";
      payload: Uint8Array;
    };

export type ConnectRequest = {
  type: "stream.open";
  streamId: number;
  channelKind: string;
  rawPayload: string;
};

function parseJsonObject(payload: string, label: string): Record<string, unknown> {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error(`${label} must be valid JSON: expected object`);
  }

  return Object.fromEntries(Object.entries(parsedPayload));
}

function readStringField(payload: Record<string, unknown>, fieldName: string): string {
  const fieldValue = payload[fieldName];
  if (typeof fieldValue !== "string") {
    return "";
  }

  return fieldValue.trim();
}

function readPositiveIntegerField(payload: Record<string, unknown>, fieldName: string): number {
  const fieldValue = payload[fieldName];
  if (typeof fieldValue !== "number" || !Number.isInteger(fieldValue) || fieldValue <= 0) {
    return 0;
  }

  return fieldValue;
}

export function parseConnectRequestMessage(message: TunnelSocketMessage): ConnectRequest {
  if (message.kind !== "text") {
    throw new Error("expected connect request websocket text message, got binary");
  }

  const payload = parseJsonObject(message.payload, "stream.open request");
  const type = readStringField(payload, "type");
  const streamId = readPositiveIntegerField(payload, "streamId");
  const channel =
    typeof payload.channel === "object" &&
    payload.channel !== null &&
    !Array.isArray(payload.channel)
      ? Object.fromEntries(Object.entries(payload.channel))
      : undefined;
  const channelKind = channel === undefined ? "" : readStringField(channel, "kind");

  if (type !== "stream.open") {
    throw new Error("stream.open request type must be 'stream.open'");
  }
  if (streamId === 0) {
    throw new Error("stream.open request streamId must be a positive integer");
  }
  if (channelKind.length === 0) {
    throw new Error("stream.open request channel.kind is required");
  }

  return {
    type: "stream.open",
    streamId,
    channelKind,
    rawPayload: message.payload,
  };
}

export function parseControlMessageType(payload: string): string {
  const parsedPayload = parseJsonObject(payload, "control message");
  const messageType = readStringField(parsedPayload, "type");
  if (messageType.length === 0) {
    throw new Error("control message type is required");
  }

  return messageType;
}

export function parsePtyConnectRequest(payload: string): StreamOpen {
  const parsedPayload = parseJsonObject(payload, "pty stream.open request");
  const type = readStringField(parsedPayload, "type");
  const streamId = readPositiveIntegerField(parsedPayload, "streamId");
  const channel =
    typeof parsedPayload.channel === "object" &&
    parsedPayload.channel !== null &&
    !Array.isArray(parsedPayload.channel)
      ? Object.fromEntries(Object.entries(parsedPayload.channel))
      : undefined;

  const kind = channel === undefined ? "" : readStringField(channel, "kind");
  const session = channel === undefined ? "" : readStringField(channel, "session");
  const cwdValue = channel?.cwd;
  const cwd =
    typeof cwdValue === "string" && cwdValue.trim().length > 0 ? cwdValue.trim() : undefined;
  const colsValue = channel?.cols;
  const rowsValue = channel?.rows;
  const cols = typeof colsValue === "number" && Number.isInteger(colsValue) ? colsValue : undefined;
  const rows = typeof rowsValue === "number" && Number.isInteger(rowsValue) ? rowsValue : undefined;

  if (type !== "stream.open") {
    throw new Error("pty stream.open request type must be 'stream.open'");
  }
  if (streamId === 0) {
    throw new Error("pty stream.open request streamId must be a positive integer");
  }
  if (kind !== "pty") {
    throw new Error("pty stream.open request channel.kind must be 'pty'");
  }
  if (session !== "create" && session !== "attach") {
    throw new Error(`invalid_pty_session_mode '${session}'`);
  }
  if ((cols !== undefined && cols < 0) || (rows !== undefined && rows < 0)) {
    throw new Error("pty stream.open request cols and rows must be greater than or equal to 0");
  }
  if ((cols !== undefined && cols > 65_535) || (rows !== undefined && rows > 65_535)) {
    throw new Error("pty stream.open request cols and rows must be less than or equal to 65535");
  }
  if ((cols === undefined) !== (rows === undefined)) {
    throw new Error(
      "pty stream.open request cols and rows must both be provided when either is set",
    );
  }

  return {
    type: "stream.open",
    streamId,
    channel: {
      kind: "pty",
      session,
      ...(cols === undefined ? {} : { cols }),
      ...(rows === undefined ? {} : { rows }),
      ...(cwd === undefined ? {} : { cwd }),
    },
  };
}

export function parseFileUploadConnectRequest(payload: string): StreamOpen {
  const message = parseStreamControlMessage(payload);
  if (message?.type !== "stream.open" || message.channel.kind !== "fileUpload") {
    throw new Error("file upload stream.open request must declare a valid fileUpload channel");
  }

  return message;
}

export function parsePtyResizeSignal(payload: string): StreamSignalMessage {
  const parsedPayload = parseJsonObject(payload, "stream.signal");
  const type = readStringField(parsedPayload, "type");
  const streamId = readPositiveIntegerField(parsedPayload, "streamId");
  const signal =
    typeof parsedPayload.signal === "object" &&
    parsedPayload.signal !== null &&
    !Array.isArray(parsedPayload.signal)
      ? Object.fromEntries(Object.entries(parsedPayload.signal))
      : undefined;
  const signalType = signal === undefined ? "" : readStringField(signal, "type");
  const cols = typeof signal?.cols === "number" ? signal.cols : 0;
  const rows = typeof signal?.rows === "number" ? signal.rows : 0;

  if (type !== "stream.signal") {
    throw new Error("stream.signal request type must be 'stream.signal'");
  }
  if (streamId === 0) {
    throw new Error("stream.signal request streamId must be a positive integer");
  }
  if (signalType !== "pty.resize") {
    throw new Error("stream.signal signal.type must be 'pty.resize'");
  }
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error("pty resize signal cols and rows must be greater than or equal to 1");
  }
  if (cols > 65_535 || rows > 65_535) {
    throw new Error("pty resize signal cols and rows must be less than or equal to 65535");
  }

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

export function parseStreamCloseMessage(payload: string): StreamClose {
  const parsedPayload = parseJsonObject(payload, "stream.close");
  const type = readStringField(parsedPayload, "type");
  const streamId = readPositiveIntegerField(parsedPayload, "streamId");
  if (type !== "stream.close") {
    throw new Error("stream.close request type must be 'stream.close'");
  }
  if (streamId === 0) {
    throw new Error("stream.close request streamId must be a positive integer");
  }

  return {
    type: "stream.close",
    streamId,
  };
}
