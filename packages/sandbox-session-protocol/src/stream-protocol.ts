import { z } from "zod";

const PositiveIntegerSchema = z.int().positive();
const NonEmptyStringSchema = z.string().min(1);

export type AgentStreamChannel = {
  kind: "agent";
};

export type PTYStreamChannel = {
  kind: "pty";
  session: "create" | "attach";
  cols?: number | undefined;
  rows?: number | undefined;
  cwd?: string | undefined;
};

export type StreamChannel = AgentStreamChannel | PTYStreamChannel;

export type PTYResizeSignal = {
  type: "pty.resize";
  cols: number;
  rows: number;
};

export type StreamSignal = PTYResizeSignal;

export type PTYExitEvent = {
  type: "pty.exit";
  exitCode: number;
};

export type StreamEvent = PTYExitEvent;

export type StreamOpen = {
  type: "stream.open";
  streamId: number;
  channel: StreamChannel;
};

export type StreamOpenOK = {
  type: "stream.open.ok";
  streamId: number;
};

export type StreamOpenError = {
  type: "stream.open.error";
  streamId: number;
  code: string;
  message: string;
};

export type StreamSignalMessage = {
  type: "stream.signal";
  streamId: number;
  signal: StreamSignal;
};

export type StreamEventMessage = {
  type: "stream.event";
  streamId: number;
  event: StreamEvent;
};

export type StreamClose = {
  type: "stream.close";
  streamId: number;
};

export type StreamReset = {
  type: "stream.reset";
  streamId: number;
  code: string;
  message: string;
};

export type StreamWindow = {
  type: "stream.window";
  streamId: number;
  bytes: number;
};

export type StreamControlMessage =
  | StreamOpen
  | StreamOpenOK
  | StreamOpenError
  | StreamSignalMessage
  | StreamEventMessage
  | StreamClose
  | StreamReset
  | StreamWindow;

const AgentStreamChannelSchema = z.object({
  kind: z.literal("agent"),
});

const PTYStreamChannelSchema = z.object({
  kind: z.literal("pty"),
  session: z.enum(["create", "attach"]),
  cols: PositiveIntegerSchema.optional(),
  rows: PositiveIntegerSchema.optional(),
  cwd: NonEmptyStringSchema.optional(),
});

const StreamChannelSchema = z.discriminatedUnion("kind", [
  AgentStreamChannelSchema,
  PTYStreamChannelSchema,
]);

const PTYResizeSignalSchema = z.object({
  type: z.literal("pty.resize"),
  cols: PositiveIntegerSchema,
  rows: PositiveIntegerSchema,
});

const StreamSignalSchema = z.discriminatedUnion("type", [PTYResizeSignalSchema]);

const PTYExitEventSchema = z.object({
  type: z.literal("pty.exit"),
  exitCode: z.int(),
});

const StreamEventSchema = z.discriminatedUnion("type", [PTYExitEventSchema]);

const StreamOpenSchema = z.object({
  type: z.literal("stream.open"),
  streamId: PositiveIntegerSchema,
  channel: StreamChannelSchema,
});

const StreamOpenOKSchema = z.object({
  type: z.literal("stream.open.ok"),
  streamId: PositiveIntegerSchema,
});

const StreamOpenErrorSchema = z.object({
  type: z.literal("stream.open.error"),
  streamId: PositiveIntegerSchema,
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});

const StreamSignalMessageSchema = z.object({
  type: z.literal("stream.signal"),
  streamId: PositiveIntegerSchema,
  signal: StreamSignalSchema,
});

const StreamEventMessageSchema = z.object({
  type: z.literal("stream.event"),
  streamId: PositiveIntegerSchema,
  event: StreamEventSchema,
});

const StreamCloseSchema = z.object({
  type: z.literal("stream.close"),
  streamId: PositiveIntegerSchema,
});

const StreamResetSchema = z.object({
  type: z.literal("stream.reset"),
  streamId: PositiveIntegerSchema,
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});

const StreamWindowSchema = z.object({
  type: z.literal("stream.window"),
  streamId: PositiveIntegerSchema,
  bytes: PositiveIntegerSchema,
});

const StreamControlMessageSchema = z.discriminatedUnion("type", [
  StreamOpenSchema,
  StreamOpenOKSchema,
  StreamOpenErrorSchema,
  StreamSignalMessageSchema,
  StreamEventMessageSchema,
  StreamCloseSchema,
  StreamResetSchema,
  StreamWindowSchema,
]);

/**
 * Parses one JSON control frame carried over the tunnel websocket.
 */
export function parseStreamControlMessage(payload: string): StreamControlMessage | undefined {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return undefined;
  }

  const result = StreamControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export type SandboxSessionControlMessage = StreamControlMessage;
