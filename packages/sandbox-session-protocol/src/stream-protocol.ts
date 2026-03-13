import { z } from "zod";

const PositiveIntegerSchema = z.int().positive();
const NonEmptyStringSchema = z.string().min(1);

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

export type AgentStreamChannel = z.infer<typeof AgentStreamChannelSchema>;
export type PTYStreamChannel = z.infer<typeof PTYStreamChannelSchema>;
export type StreamChannel = z.infer<typeof StreamChannelSchema>;

export type PTYResizeSignal = z.infer<typeof PTYResizeSignalSchema>;
export type StreamSignal = z.infer<typeof StreamSignalSchema>;

export type PTYExitEvent = z.infer<typeof PTYExitEventSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export type StreamOpen = z.infer<typeof StreamOpenSchema>;
export type StreamOpenOK = z.infer<typeof StreamOpenOKSchema>;
export type StreamOpenError = z.infer<typeof StreamOpenErrorSchema>;
export type StreamSignalMessage = z.infer<typeof StreamSignalMessageSchema>;
export type StreamEventMessage = z.infer<typeof StreamEventMessageSchema>;
export type StreamClose = z.infer<typeof StreamCloseSchema>;
export type StreamReset = z.infer<typeof StreamResetSchema>;
export type StreamWindow = z.infer<typeof StreamWindowSchema>;
export type StreamControlMessage = z.infer<typeof StreamControlMessageSchema>;

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
