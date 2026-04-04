import { z } from "zod";

const PositiveIntegerSchema = z.int().positive();
const NonEmptyStringSchema = z.string().min(1);
const HeaderValuesSchema = z.record(z.string(), z.array(z.string()));

export const FileUploadResetCodes = {
  BYTE_COUNT_EXCEEDED: "byte_count_exceeded",
  BYTE_COUNT_MISMATCH: "byte_count_mismatch",
  INVALID_FILE_TYPE: "invalid_file_type",
  MIME_TYPE_MISMATCH: "mime_type_mismatch",
  INVALID_IMAGE_CONTENT: "invalid_image_content",
} as const;

export type FileUploadResetCode = (typeof FileUploadResetCodes)[keyof typeof FileUploadResetCodes];

const AgentStreamChannelSchema = z.object({
  kind: z.literal("agent"),
});

const PTYStreamChannelSchema = z.object({
  kind: z.literal("pty"),
  session: z.enum(["create", "attach"]),
  ptySessionId: NonEmptyStringSchema,
  cols: PositiveIntegerSchema.optional(),
  rows: PositiveIntegerSchema.optional(),
  cwd: NonEmptyStringSchema.optional(),
  command: NonEmptyStringSchema.optional(),
  args: z.array(NonEmptyStringSchema).optional(),
});

const FileUploadStreamChannelSchema = z.object({
  kind: z.literal("fileUpload"),
  threadId: NonEmptyStringSchema,
  mimeType: NonEmptyStringSchema,
  originalFilename: NonEmptyStringSchema,
  sizeBytes: PositiveIntegerSchema,
});

const StreamChannelSchema = z.discriminatedUnion("kind", [
  AgentStreamChannelSchema,
  PTYStreamChannelSchema,
  FileUploadStreamChannelSchema,
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

/**
 * Emitted only after the runtime has accepted the upload as a supported image
 * using lightweight validation and persisted it at the final attachment path.
 *
 * This is not a guarantee that every downstream image decoder or model input
 * pipeline will accept the file.
 */
const FileUploadCompletedEventSchema = z.object({
  type: z.literal("fileUpload.completed"),
  attachmentId: NonEmptyStringSchema,
  threadId: NonEmptyStringSchema,
  originalFilename: NonEmptyStringSchema,
  mimeType: NonEmptyStringSchema,
  sizeBytes: PositiveIntegerSchema,
  path: NonEmptyStringSchema,
});

const StreamEventSchema = z.discriminatedUnion("type", [
  PTYExitEventSchema,
  FileUploadCompletedEventSchema,
]);

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

const StreamCompleteSchema = z.object({
  type: z.literal("stream.complete"),
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

const TelemetrySignalSchema = z.enum(["logs"]);
const TelemetryFormatSchema = z.literal("mistle.sandbox-runtime.log.v1");

const TelemetryOpenSchema = z.object({
  type: z.literal("telemetry.open"),
  streamId: PositiveIntegerSchema,
  signal: TelemetrySignalSchema,
  format: TelemetryFormatSchema,
});

const TelemetryOpenOKSchema = z.object({
  type: z.literal("telemetry.open.ok"),
  streamId: PositiveIntegerSchema,
  initialWindowBytes: PositiveIntegerSchema,
});

const TelemetryOpenErrorSchema = z.object({
  type: z.literal("telemetry.open.error"),
  streamId: PositiveIntegerSchema,
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});

const TelemetryWindowSchema = z.object({
  type: z.literal("telemetry.window"),
  streamId: PositiveIntegerSchema,
  bytes: PositiveIntegerSchema,
});

const TelemetryCloseSchema = z.object({
  type: z.literal("telemetry.close"),
  streamId: PositiveIntegerSchema,
});

const TelemetryResetSchema = z.object({
  type: z.literal("telemetry.reset"),
  streamId: PositiveIntegerSchema,
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
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

const SandboxKeepaliveStateSchema = z.object({
  type: z.literal("keepalive.state"),
  ttlMs: PositiveIntegerSchema,
  active: z.boolean(),
});

const LiveListenerOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sandbox-runtime"),
  }),
  z.object({
    kind: z.literal("managed-runtime-client"),
    clientId: NonEmptyStringSchema,
    endpointKey: NonEmptyStringSchema.optional(),
  }),
  z.object({
    kind: z.literal("unknown-process"),
  }),
]);

const LiveListenerSchema = z.object({
  port: PositiveIntegerSchema,
  bindAddress: NonEmptyStringSchema,
  pid: PositiveIntegerSchema.optional(),
  command: NonEmptyStringSchema.optional(),
  owner: LiveListenerOwnerSchema,
  visibility: z.enum(["internal", "user_selectable"]),
  observedAt: NonEmptyStringSchema,
});

const PublishTargetSchema = z.object({
  kind: z.literal("port"),
  port: PositiveIntegerSchema,
});

const PublishListenersGetSchema = z.object({
  type: z.literal("publish.listeners.get"),
  requestId: NonEmptyStringSchema,
});

const PublishListenersSnapshotSchema = z.object({
  type: z.literal("publish.listeners.snapshot"),
  requestId: NonEmptyStringSchema,
  observedAt: NonEmptyStringSchema,
  listeners: z.array(LiveListenerSchema),
});

const PublishTargetAuthorizeSchema = z.object({
  type: z.literal("publish.target.authorize"),
  requestId: NonEmptyStringSchema,
  target: PublishTargetSchema,
});

const PublishTargetAuthorizeResultSchema = z.object({
  type: z.literal("publish.target.authorize.result"),
  requestId: NonEmptyStringSchema,
  authorized: z.boolean(),
  reason: z.enum(["target_not_found", "target_internal", "target_not_live"]).optional(),
});

const PublishHttpOpenSchema = z.object({
  type: z.literal("publish.http.open"),
  streamId: PositiveIntegerSchema,
  target: PublishTargetSchema,
  request: z.object({
    method: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    query: z.string().optional(),
    headers: HeaderValuesSchema,
  }),
});

const PublishHttpResponseStartSchema = z.object({
  type: z.literal("publish.http.response.start"),
  streamId: PositiveIntegerSchema,
  status: z.int().min(100).max(599),
  headers: HeaderValuesSchema,
});

const PublishWsOpenSchema = z.object({
  type: z.literal("publish.ws.open"),
  streamId: PositiveIntegerSchema,
  target: PublishTargetSchema,
  request: z.object({
    path: NonEmptyStringSchema,
    query: z.string().optional(),
    headers: HeaderValuesSchema,
  }),
});

const PublishWsAcceptSchema = z.object({
  type: z.literal("publish.ws.accept"),
  streamId: PositiveIntegerSchema,
  headers: HeaderValuesSchema,
});

const PublishHttpBodyChunkSchema = z.object({
  type: z.literal("publish.http.body.chunk"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
  bytes: NonEmptyStringSchema,
  encoding: z.literal("base64"),
});

const PublishHttpBodyEndSchema = z.object({
  type: z.literal("publish.http.body.end"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
});

const PublishWsFrameSchema = z.object({
  type: z.literal("publish.ws.frame"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
  opcode: z.enum(["text", "binary"]),
  bytes: NonEmptyStringSchema,
  encoding: z.literal("base64"),
});

const PublishWsCloseSchema = z.object({
  type: z.literal("publish.ws.close"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
  code: z.int(),
  reason: z.string().optional(),
});

const PublishStreamCloseSchema = z.object({
  type: z.literal("publish.stream.close"),
  streamId: PositiveIntegerSchema,
});

const PublishStreamErrorSchema = z.object({
  type: z.literal("publish.stream.error"),
  streamId: PositiveIntegerSchema,
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});

const StreamControlMessageSchema = z.discriminatedUnion("type", [
  StreamOpenSchema,
  StreamOpenOKSchema,
  StreamOpenErrorSchema,
  StreamSignalMessageSchema,
  StreamEventMessageSchema,
  StreamCloseSchema,
  StreamCompleteSchema,
  StreamResetSchema,
  StreamWindowSchema,
]);

const LeaseControlMessageSchema = z.discriminatedUnion("type", [
  LeaseCreateSchema,
  LeaseRenewSchema,
]);

const TelemetryControlMessageSchema = z.discriminatedUnion("type", [
  TelemetryOpenSchema,
  TelemetryOpenOKSchema,
  TelemetryOpenErrorSchema,
  TelemetryWindowSchema,
  TelemetryCloseSchema,
  TelemetryResetSchema,
]);

const BootstrapControlMessageSchema = z.discriminatedUnion("type", [
  StreamOpenOKSchema,
  StreamOpenErrorSchema,
  StreamEventMessageSchema,
  StreamCompleteSchema,
  StreamResetSchema,
  StreamWindowSchema,
  TelemetryOpenSchema,
  TelemetryCloseSchema,
  SandboxKeepaliveStateSchema,
  LeaseCreateSchema,
  LeaseRenewSchema,
]);

const PublishControlMessageSchema = z.discriminatedUnion("type", [
  PublishListenersGetSchema,
  PublishListenersSnapshotSchema,
  PublishTargetAuthorizeSchema,
  PublishTargetAuthorizeResultSchema,
  PublishHttpOpenSchema,
  PublishHttpResponseStartSchema,
  PublishWsOpenSchema,
  PublishWsAcceptSchema,
  PublishHttpBodyChunkSchema,
  PublishHttpBodyEndSchema,
  PublishWsFrameSchema,
  PublishWsCloseSchema,
  PublishStreamCloseSchema,
  PublishStreamErrorSchema,
]);

export type AgentStreamChannel = z.infer<typeof AgentStreamChannelSchema>;
export type PTYStreamChannel = z.infer<typeof PTYStreamChannelSchema>;
export type FileUploadStreamChannel = z.infer<typeof FileUploadStreamChannelSchema>;
export type StreamChannel = z.infer<typeof StreamChannelSchema>;

export type PTYResizeSignal = z.infer<typeof PTYResizeSignalSchema>;
export type StreamSignal = z.infer<typeof StreamSignalSchema>;

export type PTYExitEvent = z.infer<typeof PTYExitEventSchema>;
export type FileUploadCompletedEvent = z.infer<typeof FileUploadCompletedEventSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export type StreamOpen = z.infer<typeof StreamOpenSchema>;
export type StreamOpenOK = z.infer<typeof StreamOpenOKSchema>;
export type StreamOpenError = z.infer<typeof StreamOpenErrorSchema>;
export type StreamSignalMessage = z.infer<typeof StreamSignalMessageSchema>;
export type StreamEventMessage = z.infer<typeof StreamEventMessageSchema>;
export type StreamClose = z.infer<typeof StreamCloseSchema>;
export type StreamComplete = z.infer<typeof StreamCompleteSchema>;
export type StreamReset = z.infer<typeof StreamResetSchema>;
export type StreamWindow = z.infer<typeof StreamWindowSchema>;
export type StreamControlMessage = z.infer<typeof StreamControlMessageSchema>;
export type TelemetrySignal = z.infer<typeof TelemetrySignalSchema>;
export type TelemetryFormat = z.infer<typeof TelemetryFormatSchema>;
export type TelemetryOpen = z.infer<typeof TelemetryOpenSchema>;
export type TelemetryOpenOK = z.infer<typeof TelemetryOpenOKSchema>;
export type TelemetryOpenError = z.infer<typeof TelemetryOpenErrorSchema>;
export type TelemetryWindow = z.infer<typeof TelemetryWindowSchema>;
export type TelemetryClose = z.infer<typeof TelemetryCloseSchema>;
export type TelemetryReset = z.infer<typeof TelemetryResetSchema>;
export type TelemetryControlMessage = z.infer<typeof TelemetryControlMessageSchema>;
export type ExecutionLease = z.infer<typeof ExecutionLeaseSchema>;
export type LeaseCreate = z.infer<typeof LeaseCreateSchema>;
export type LeaseRenew = z.infer<typeof LeaseRenewSchema>;
export type LeaseControlMessage = z.infer<typeof LeaseControlMessageSchema>;
export type SandboxKeepaliveState = z.infer<typeof SandboxKeepaliveStateSchema>;
export type KeepaliveControlMessage = SandboxKeepaliveState;
export type BootstrapControlMessage = z.infer<typeof BootstrapControlMessageSchema>;
export type LiveListenerOwner = z.infer<typeof LiveListenerOwnerSchema>;
export type LiveListener = z.infer<typeof LiveListenerSchema>;
export type PublishTarget = z.infer<typeof PublishTargetSchema>;
export type PublishListenersGet = z.infer<typeof PublishListenersGetSchema>;
export type PublishListenersSnapshot = z.infer<typeof PublishListenersSnapshotSchema>;
export type PublishTargetAuthorize = z.infer<typeof PublishTargetAuthorizeSchema>;
export type PublishTargetAuthorizeResult = z.infer<typeof PublishTargetAuthorizeResultSchema>;
export type PublishHttpOpen = z.infer<typeof PublishHttpOpenSchema>;
export type PublishHttpResponseStart = z.infer<typeof PublishHttpResponseStartSchema>;
export type PublishWsOpen = z.infer<typeof PublishWsOpenSchema>;
export type PublishWsAccept = z.infer<typeof PublishWsAcceptSchema>;
export type PublishHttpBodyChunk = z.infer<typeof PublishHttpBodyChunkSchema>;
export type PublishHttpBodyEnd = z.infer<typeof PublishHttpBodyEndSchema>;
export type PublishWsFrame = z.infer<typeof PublishWsFrameSchema>;
export type PublishWsClose = z.infer<typeof PublishWsCloseSchema>;
export type PublishStreamClose = z.infer<typeof PublishStreamCloseSchema>;
export type PublishStreamError = z.infer<typeof PublishStreamErrorSchema>;

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

export function parseTelemetryControlMessage(payload: string): TelemetryControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = TelemetryControlMessageSchema.safeParse(parsedPayload);
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

export function parsePublishControlMessage(payload: string): PublishControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = PublishControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export type PublishControlMessage = z.infer<typeof PublishControlMessageSchema>;
export type SandboxSessionControlMessage =
  | StreamControlMessage
  | TelemetryControlMessage
  | LeaseControlMessage
  | KeepaliveControlMessage;
