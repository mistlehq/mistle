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

const LeaseMetadataSchema = z.record(z.string(), z.unknown());

const ExecutionLeaseSchema = z.object({
  id: NonEmptyStringSchema,
  kind: NonEmptyStringSchema,
  source: NonEmptyStringSchema,
  externalExecutionId: NonEmptyStringSchema.optional(),
  metadata: LeaseMetadataSchema.optional(),
});

const LeaseCreateSchema = z.object({
  type: z.literal("lease.create"),
  lease: ExecutionLeaseSchema,
});

const LeaseRenewSchema = z.object({
  type: z.literal("lease.renew"),
  leaseId: NonEmptyStringSchema,
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

const LeaseControlMessageSchema = z.discriminatedUnion("type", [
  LeaseCreateSchema,
  LeaseRenewSchema,
]);

const BootstrapControlMessageSchema = z.discriminatedUnion("type", [
  StreamOpenOKSchema,
  StreamOpenErrorSchema,
  StreamEventMessageSchema,
  StreamResetSchema,
  StreamWindowSchema,
  LeaseCreateSchema,
  LeaseRenewSchema,
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
export type ExecutionLease = z.infer<typeof ExecutionLeaseSchema>;
export type LeaseCreate = z.infer<typeof LeaseCreateSchema>;
export type LeaseRenew = z.infer<typeof LeaseRenewSchema>;
export type LeaseControlMessage = z.infer<typeof LeaseControlMessageSchema>;
export type BootstrapControlMessage = z.infer<typeof BootstrapControlMessageSchema>;

function parseJSON(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/**
 * Parses one JSON control frame carried over the tunnel websocket.
 */
export function parseStreamControlMessage(payload: string): StreamControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }
  const result = StreamControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export function parseLeaseControlMessage(payload: string): LeaseControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = LeaseControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export function parseBootstrapControlMessage(payload: string): BootstrapControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = BootstrapControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export type SandboxSessionControlMessage = StreamControlMessage | LeaseControlMessage;
