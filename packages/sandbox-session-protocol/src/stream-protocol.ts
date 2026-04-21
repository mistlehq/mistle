import { z } from "zod";

const PositiveIntegerSchema = z.int().positive();
const NonEmptyStringSchema = z.string().min(1);

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

const ProcessesStreamChannelSchema = z.object({
  kind: z.literal("processes"),
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

const ExecStreamChannelSchema = z.object({
  kind: z.literal("exec"),
  command: NonEmptyStringSchema,
  args: z.array(NonEmptyStringSchema).optional(),
  cwd: NonEmptyStringSchema.optional(),
  timeoutMs: PositiveIntegerSchema.optional(),
  maxOutputBytes: PositiveIntegerSchema.optional(),
});

const StreamChannelSchema = z.discriminatedUnion("kind", [
  AgentStreamChannelSchema,
  ProcessesStreamChannelSchema,
  PTYStreamChannelSchema,
  FileUploadStreamChannelSchema,
  ExecStreamChannelSchema,
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

const ExecResultEventSchema = z.object({
  type: z.literal("exec.result"),
  exitCode: z.int(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
});

const StreamEventSchema = z.discriminatedUnion("type", [
  PTYExitEventSchema,
  FileUploadCompletedEventSchema,
  ExecResultEventSchema,
]);

const ProcessListenerSchema = z.object({
  port: PositiveIntegerSchema,
  bindAddress: NonEmptyStringSchema,
});

const ProcessEntrySchema = z.object({
  pid: PositiveIntegerSchema,
  command: NonEmptyStringSchema.optional(),
  listeners: z.array(ProcessListenerSchema),
});

const ProcessesRefreshSchema = z.object({
  type: z.literal("processes.refresh"),
});

const ProcessesSnapshotSchema = z.object({
  type: z.literal("processes.snapshot"),
  observedAt: NonEmptyStringSchema,
  processes: z.array(ProcessEntrySchema),
});

const ProcessesStreamMessageSchema = z.discriminatedUnion("type", [
  ProcessesRefreshSchema,
  ProcessesSnapshotSchema,
]);

const RepeatedHeaderValuesSchema = z.record(NonEmptyStringSchema, z.array(NonEmptyStringSchema));

const PortAccessTargetSchema = z.object({
  kind: z.literal("port"),
  port: PositiveIntegerSchema,
});

const PortsTargetAuthorizeSchema = z.object({
  type: z.literal("ports.target.authorize"),
  requestId: NonEmptyStringSchema,
  target: PortAccessTargetSchema,
});

const PortsTargetAuthorizeSuccessResultSchema = z.object({
  type: z.literal("ports.target.authorize.result"),
  requestId: NonEmptyStringSchema,
  authorized: z.literal(true),
  upstreamProtocol: z.enum(["http", "https"]),
  websocketCapable: z.boolean(),
});

const PortsTargetAuthorizeFailureResultSchema = z.object({
  type: z.literal("ports.target.authorize.result"),
  requestId: NonEmptyStringSchema,
  authorized: z.literal(false),
  reason: z.enum(["port_unreachable", "unsupported_protocol"]),
});

const PortsTargetAuthorizeResultSchema = z.union([
  PortsTargetAuthorizeSuccessResultSchema,
  PortsTargetAuthorizeFailureResultSchema,
]);

const PortsControlMessageSchema = z.union([
  PortsTargetAuthorizeSchema,
  PortsTargetAuthorizeResultSchema,
]);

const PortsHttpOpenSchema = z.object({
  type: z.literal("ports.http.open"),
  streamId: PositiveIntegerSchema,
  target: PortAccessTargetSchema,
  upstreamProtocol: z.enum(["http", "https"]),
  request: z.object({
    method: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    query: NonEmptyStringSchema.optional(),
    headers: RepeatedHeaderValuesSchema,
  }),
});

const PortsHttpResponseStartSchema = z.object({
  type: z.literal("ports.http.response.start"),
  streamId: PositiveIntegerSchema,
  status: PositiveIntegerSchema,
  headers: RepeatedHeaderValuesSchema,
});

const PortsHttpBodyChunkSchema = z.object({
  type: z.literal("ports.http.body.chunk"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
  bytes: z.string(),
  encoding: z.literal("base64"),
});

const PortsHttpBodyEndSchema = z.object({
  type: z.literal("ports.http.body.end"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
});

const PortsWsOpenSchema = z.object({
  type: z.literal("ports.ws.open"),
  streamId: PositiveIntegerSchema,
  target: PortAccessTargetSchema,
  upstreamProtocol: z.enum(["http", "https"]),
  request: z.object({
    path: NonEmptyStringSchema,
    query: NonEmptyStringSchema.optional(),
    headers: RepeatedHeaderValuesSchema,
  }),
});

const PortsWsAcceptSchema = z.object({
  type: z.literal("ports.ws.accept"),
  streamId: PositiveIntegerSchema,
  headers: RepeatedHeaderValuesSchema,
});

const PortsWsFrameSchema = z.object({
  type: z.literal("ports.ws.frame"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
  opcode: z.enum(["text", "binary", "ping", "pong"]),
  bytes: z.string(),
  encoding: z.literal("base64"),
});

const PortsWsCloseSchema = z
  .object({
    type: z.literal("ports.ws.close"),
    streamId: PositiveIntegerSchema,
    direction: z.enum(["request", "response"]),
    code: PositiveIntegerSchema.optional(),
    reason: NonEmptyStringSchema.optional(),
  })
  .refine((message) => message.reason === undefined || message.code !== undefined, {
    message: "ports.ws.close reason requires a close code",
  });

const PortsStreamCloseSchema = z.object({
  type: z.literal("ports.stream.close"),
  streamId: PositiveIntegerSchema,
});

const PortsStreamErrorSchema = z.object({
  type: z.literal("ports.stream.error"),
  streamId: PositiveIntegerSchema,
  code: z.enum(["upstream_connect_failed", "upstream_handshake_failed", "upstream_io_error"]),
  message: NonEmptyStringSchema,
});

const PortsTransportMessageSchema = z.union([
  PortsHttpOpenSchema,
  PortsHttpResponseStartSchema,
  PortsHttpBodyChunkSchema,
  PortsHttpBodyEndSchema,
  PortsWsOpenSchema,
  PortsWsAcceptSchema,
  PortsWsFrameSchema,
  PortsWsCloseSchema,
  PortsStreamCloseSchema,
  PortsStreamErrorSchema,
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

const TelemetrySignalSchema = z.enum(["logs", "traces"]);
const TelemetryFormatSchema = z.enum(["mistle.sandbox-runtime.log.v1", "otlp.http.traces.v1+json"]);

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

const SigningFormatSchema = z.enum(["ssh"]);

const SigningRequestSchema = z.object({
  type: z.literal("signing.request"),
  requestId: NonEmptyStringSchema,
  organizationId: NonEmptyStringSchema,
  sandboxInstanceId: NonEmptyStringSchema,
  actingUserId: NonEmptyStringSchema,
  providerFamily: NonEmptyStringSchema,
  format: SigningFormatSchema,
  keyRef: NonEmptyStringSchema,
  grant: NonEmptyStringSchema,
  payload: z.string(),
  encoding: z.literal("base64"),
});

const SigningSuccessResultSchema = z.object({
  type: z.literal("signing.result"),
  requestId: NonEmptyStringSchema,
  ok: z.literal(true),
  signature: z.string(),
  encoding: z.literal("base64"),
});

const SigningFailureResultSchema = z.object({
  type: z.literal("signing.result"),
  requestId: NonEmptyStringSchema,
  ok: z.literal(false),
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});

const SigningControlMessageSchema = z.union([
  SigningRequestSchema,
  SigningSuccessResultSchema,
  SigningFailureResultSchema,
]);

const SandboxKeepaliveStateSchema = z.object({
  type: z.literal("keepalive.state"),
  ttlMs: PositiveIntegerSchema,
  active: z.boolean(),
});

const SandboxRuntimeReadySchema = z.object({
  type: z.literal("runtime.ready"),
  ready: z.boolean(),
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
  SandboxRuntimeReadySchema,
]);

export type AgentStreamChannel = z.infer<typeof AgentStreamChannelSchema>;
export type ProcessesStreamChannel = z.infer<typeof ProcessesStreamChannelSchema>;
export type PTYStreamChannel = z.infer<typeof PTYStreamChannelSchema>;
export type FileUploadStreamChannel = z.infer<typeof FileUploadStreamChannelSchema>;
export type ExecStreamChannel = z.infer<typeof ExecStreamChannelSchema>;
export type StreamChannel = z.infer<typeof StreamChannelSchema>;

export type PTYResizeSignal = z.infer<typeof PTYResizeSignalSchema>;
export type StreamSignal = z.infer<typeof StreamSignalSchema>;

export type PTYExitEvent = z.infer<typeof PTYExitEventSchema>;
export type FileUploadCompletedEvent = z.infer<typeof FileUploadCompletedEventSchema>;
export type ExecResultEvent = z.infer<typeof ExecResultEventSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type ProcessListener = z.infer<typeof ProcessListenerSchema>;
export type ProcessEntry = z.infer<typeof ProcessEntrySchema>;
export type ProcessesRefresh = z.infer<typeof ProcessesRefreshSchema>;
export type ProcessesSnapshot = z.infer<typeof ProcessesSnapshotSchema>;
export type ProcessesStreamMessage = z.infer<typeof ProcessesStreamMessageSchema>;
export type PortAccessTarget = z.infer<typeof PortAccessTargetSchema>;
export type PortsTargetAuthorize = z.infer<typeof PortsTargetAuthorizeSchema>;
export type PortsTargetAuthorizeSuccessResult = z.infer<
  typeof PortsTargetAuthorizeSuccessResultSchema
>;
export type PortsTargetAuthorizeFailureResult = z.infer<
  typeof PortsTargetAuthorizeFailureResultSchema
>;
export type PortsTargetAuthorizeResult =
  | PortsTargetAuthorizeSuccessResult
  | PortsTargetAuthorizeFailureResult;
export type PortsControlMessage = z.infer<typeof PortsControlMessageSchema>;
export type PortsHttpOpen = z.infer<typeof PortsHttpOpenSchema>;
export type PortsHttpResponseStart = z.infer<typeof PortsHttpResponseStartSchema>;
export type PortsHttpBodyChunk = z.infer<typeof PortsHttpBodyChunkSchema>;
export type PortsHttpBodyEnd = z.infer<typeof PortsHttpBodyEndSchema>;
export type PortsWsOpen = z.infer<typeof PortsWsOpenSchema>;
export type PortsWsAccept = z.infer<typeof PortsWsAcceptSchema>;
export type PortsWsFrame = z.infer<typeof PortsWsFrameSchema>;
export type PortsWsClose = z.infer<typeof PortsWsCloseSchema>;
export type PortsStreamClose = z.infer<typeof PortsStreamCloseSchema>;
export type PortsStreamError = z.infer<typeof PortsStreamErrorSchema>;
export type PortsTransportMessage = z.infer<typeof PortsTransportMessageSchema>;

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
export type SigningFormat = z.infer<typeof SigningFormatSchema>;
export type SigningRequest = z.infer<typeof SigningRequestSchema>;
export type SigningSuccessResult = z.infer<typeof SigningSuccessResultSchema>;
export type SigningFailureResult = z.infer<typeof SigningFailureResultSchema>;
export type SigningResult = SigningSuccessResult | SigningFailureResult;
export type SigningControlMessage = z.infer<typeof SigningControlMessageSchema>;
export type SandboxKeepaliveState = z.infer<typeof SandboxKeepaliveStateSchema>;
export type SandboxRuntimeReady = z.infer<typeof SandboxRuntimeReadySchema>;
export type KeepaliveControlMessage = SandboxKeepaliveState;
export type RuntimeReadyControlMessage = SandboxRuntimeReady;
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

export function parseTelemetryControlMessage(payload: string): TelemetryControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = TelemetryControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export function parseSigningControlMessage(payload: string): SigningControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = SigningControlMessageSchema.safeParse(parsedPayload);
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

export function parseProcessesStreamMessage(payload: string): ProcessesStreamMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = ProcessesStreamMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export function parsePortsControlMessage(payload: string): PortsControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = PortsControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export function parsePortsTransportMessage(payload: string): PortsTransportMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = PortsTransportMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}
export type SandboxSessionControlMessage =
  | StreamControlMessage
  | TelemetryControlMessage
  | SigningControlMessage
  | KeepaliveControlMessage
  | RuntimeReadyControlMessage;
