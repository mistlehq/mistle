import { z } from "zod";

const PositiveIntegerSchema = z.int().positive();
const HttpResponseStatusSchema = z.int().min(200).max(599);
const NonEmptyStringSchema = z.string().min(1);

export const PtyTransportWebSocketRoutePath = "/_mistle/pty/connect";
export const PtyTransportTokenQueryParam = "pty_token";

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
  stdin: z.string().optional(),
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

const FileUploadCompletedEventSchema = z.object({
  type: z.literal("fileUpload.completed"),
  kind: z.enum(["image", "file"]),
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

const RepeatedHeaderValuesSchema = z.record(NonEmptyStringSchema, z.array(z.string()));

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
  reason: z.enum(["port_unreachable", "unsupported_protocol", "bootstrap_disconnected"]),
});

const PortsTargetAuthorizeResultSchema = z.union([
  PortsTargetAuthorizeSuccessResultSchema,
  PortsTargetAuthorizeFailureResultSchema,
]);

const PortsControlMessageSchema = z.union([
  PortsTargetAuthorizeSchema,
  PortsTargetAuthorizeResultSchema,
]);

const PortsTcpOpenSchema = z.object({
  type: z.literal("ports.tcp.open"),
  streamId: PositiveIntegerSchema,
  target: PortAccessTargetSchema,
  upstreamProtocol: z.enum(["http", "https"]),
});

const PortsTcpConnectedSchema = z.object({
  type: z.literal("ports.tcp.connected"),
  streamId: PositiveIntegerSchema,
});

const PortsTcpCloseSchema = z.object({
  type: z.literal("ports.tcp.close"),
  streamId: PositiveIntegerSchema,
  direction: z.enum(["request", "response"]),
});

const PortsTcpErrorSchema = z.object({
  type: z.literal("ports.tcp.error"),
  streamId: PositiveIntegerSchema,
  code: z.enum(["upstream_connect_failed", "upstream_handshake_failed", "upstream_io_error"]),
  message: NonEmptyStringSchema,
});

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
  status: HttpResponseStatusSchema,
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
  PortsTcpOpenSchema,
  PortsTcpConnectedSchema,
  PortsTcpCloseSchema,
  PortsTcpErrorSchema,
  PortsHttpOpenSchema,
  PortsHttpResponseStartSchema,
  PortsHttpBodyChunkSchema,
  PortsHttpBodyEndSchema,
  PortsStreamCloseSchema,
  PortsStreamErrorSchema,
]);

const EgressTokenRequestSchema = z.object({
  type: z.literal("egress.token.request"),
  requestId: NonEmptyStringSchema,
});

const EgressTokenResponseSchema = z.object({
  type: z.literal("egress.token.response"),
  requestId: NonEmptyStringSchema,
  token: NonEmptyStringSchema,
  expiresAt: NonEmptyStringSchema,
  ttlMs: PositiveIntegerSchema,
});

const EgressTokenErrorSchema = z.object({
  type: z.literal("egress.token.error"),
  requestId: NonEmptyStringSchema,
  code: z.enum(["invalid_sandbox_state", "internal_error"]),
  message: NonEmptyStringSchema,
});

const EgressTokenControlMessageSchema = z.discriminatedUnion("type", [
  EgressTokenRequestSchema,
  EgressTokenResponseSchema,
  EgressTokenErrorSchema,
]);

const PtySessionLaunchSchema = z.object({
  session: z.enum(["create", "attach"]),
  cols: PositiveIntegerSchema.optional(),
  rows: PositiveIntegerSchema.optional(),
  cwd: NonEmptyStringSchema.optional(),
  command: NonEmptyStringSchema.optional(),
  args: z.array(NonEmptyStringSchema).optional(),
});

const PtySessionOpenSchema = z.object({
  type: z.literal("pty.session.open"),
  requestId: NonEmptyStringSchema,
  ptySessionId: NonEmptyStringSchema,
  transportUrl: z.url(),
  transportToken: NonEmptyStringSchema,
  launch: PtySessionLaunchSchema,
});

const PtySessionOpenedSchema = z.object({
  type: z.literal("pty.session.opened"),
  requestId: NonEmptyStringSchema,
  ptySessionId: NonEmptyStringSchema,
});

const PtySessionErrorSchema = z.object({
  type: z.literal("pty.session.error"),
  requestId: NonEmptyStringSchema,
  ptySessionId: NonEmptyStringSchema,
  code: z.enum([
    "transport_connect_failed",
    "pty_create_failed",
    "pty_attach_failed",
    "internal_error",
  ]),
  message: NonEmptyStringSchema,
});

const PtySessionControlMessageSchema = z.discriminatedUnion("type", [
  PtySessionOpenSchema,
  PtySessionOpenedSchema,
  PtySessionErrorSchema,
]);

const PtyTransportClientOpenSchema = z.object({
  type: z.literal("pty.transport.open"),
  launch: PtySessionLaunchSchema,
});

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

const SandboxOperationKindSchema = z.enum(["start", "resume", "setup_check", "snapshot", "stop"]);

const OperationOpenSchema = z.object({
  type: z.literal("operation.open"),
  streamId: PositiveIntegerSchema,
  operationId: NonEmptyStringSchema,
  operationKind: SandboxOperationKindSchema,
  format: z.literal("mistle.sandbox-operation.v1+jsonl"),
});

const OperationOpenOKSchema = z.object({
  type: z.literal("operation.open.ok"),
  streamId: PositiveIntegerSchema,
  initialWindowBytes: PositiveIntegerSchema,
});

const OperationOpenErrorSchema = z.object({
  type: z.literal("operation.open.error"),
  streamId: PositiveIntegerSchema,
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});

const OperationWindowSchema = z.object({
  type: z.literal("operation.window"),
  streamId: PositiveIntegerSchema,
  bytes: PositiveIntegerSchema,
});

const OperationCloseSchema = z.object({
  type: z.literal("operation.close"),
  streamId: PositiveIntegerSchema,
});

const OperationResetSchema = z.object({
  type: z.literal("operation.reset"),
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

const OperationControlMessageSchema = z.discriminatedUnion("type", [
  OperationOpenSchema,
  OperationOpenOKSchema,
  OperationOpenErrorSchema,
  OperationWindowSchema,
  OperationCloseSchema,
  OperationResetSchema,
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
  OperationOpenSchema,
  OperationCloseSchema,
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
export type PortsTcpOpen = z.infer<typeof PortsTcpOpenSchema>;
export type PortsTcpConnected = z.infer<typeof PortsTcpConnectedSchema>;
export type PortsTcpClose = z.infer<typeof PortsTcpCloseSchema>;
export type PortsTcpError = z.infer<typeof PortsTcpErrorSchema>;
export type PortsHttpOpen = z.infer<typeof PortsHttpOpenSchema>;
export type PortsHttpResponseStart = z.infer<typeof PortsHttpResponseStartSchema>;
export type PortsHttpBodyChunk = z.infer<typeof PortsHttpBodyChunkSchema>;
export type PortsHttpBodyEnd = z.infer<typeof PortsHttpBodyEndSchema>;
export type PortsStreamClose = z.infer<typeof PortsStreamCloseSchema>;
export type PortsStreamError = z.infer<typeof PortsStreamErrorSchema>;
export type PortsTransportMessage = z.infer<typeof PortsTransportMessageSchema>;
export type EgressTokenRequest = z.infer<typeof EgressTokenRequestSchema>;
export type EgressTokenResponse = z.infer<typeof EgressTokenResponseSchema>;
export type EgressTokenError = z.infer<typeof EgressTokenErrorSchema>;
export type EgressTokenControlMessage = z.infer<typeof EgressTokenControlMessageSchema>;
export type PtySessionLaunch = z.infer<typeof PtySessionLaunchSchema>;
export type PtySessionOpen = z.infer<typeof PtySessionOpenSchema>;
export type PtySessionOpened = z.infer<typeof PtySessionOpenedSchema>;
export type PtySessionError = z.infer<typeof PtySessionErrorSchema>;
export type PtySessionControlMessage = z.infer<typeof PtySessionControlMessageSchema>;
export type PtyTransportClientOpen = z.infer<typeof PtyTransportClientOpenSchema>;

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
export type SandboxOperationKind = z.infer<typeof SandboxOperationKindSchema>;
export type OperationOpen = z.infer<typeof OperationOpenSchema>;
export type OperationOpenOK = z.infer<typeof OperationOpenOKSchema>;
export type OperationOpenError = z.infer<typeof OperationOpenErrorSchema>;
export type OperationWindow = z.infer<typeof OperationWindowSchema>;
export type OperationClose = z.infer<typeof OperationCloseSchema>;
export type OperationReset = z.infer<typeof OperationResetSchema>;
export type OperationControlMessage = z.infer<typeof OperationControlMessageSchema>;
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

export function parseOperationControlMessage(payload: string): OperationControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = OperationControlMessageSchema.safeParse(parsedPayload);
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

export function parseEgressTokenControlMessage(
  payload: string,
): EgressTokenControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = EgressTokenControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export function parsePtySessionControlMessage(
  payload: string,
): PtySessionControlMessage | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = PtySessionControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}

export function parsePtyTransportClientOpen(payload: string): PtyTransportClientOpen | undefined {
  const parsedPayload = parseJSON(payload);
  if (parsedPayload === undefined) {
    return undefined;
  }

  const result = PtyTransportClientOpenSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}
export type SandboxSessionControlMessage =
  | StreamControlMessage
  | TelemetryControlMessage
  | OperationControlMessage
  | SigningControlMessage
  | EgressTokenControlMessage
  | PtySessionControlMessage
  | KeepaliveControlMessage
  | RuntimeReadyControlMessage;
