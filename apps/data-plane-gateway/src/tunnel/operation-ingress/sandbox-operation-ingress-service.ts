import {
  type DataPlaneDatabase,
  type DataPlaneTables,
  insertSandboxOperationEvent,
  type SandboxLifecyclePhase,
  type SandboxLifecycleStatus,
  type SandboxOperationEventSource,
  type SandboxOperationTranscriptStream,
} from "@mistle/db/data-plane";
import {
  decodeDataFrame,
  type OperationOpenError,
  type OperationOpenOK,
  type OperationReset,
  type OperationWindow,
} from "@mistle/sandbox-session-protocol";

import { logger } from "../../logger.js";
import type { OperationDelivery } from "../tunnel-websocket-message-handler.js";
import {
  BootstrapOperationSession,
  type ActiveBootstrapOperationStream,
} from "./bootstrap-operation-session.js";
import { createOperationReset } from "./operation-control-messages.js";

type OperationControlMessage =
  | OperationOpenOK
  | OperationOpenError
  | OperationReset
  | OperationWindow;

type SessionKeyInput = {
  relaySessionId: string;
  sandboxInstanceId: string;
};

type OperationRecord =
  | {
      attributes: Record<string, unknown>;
      kind: "lifecycle";
      message: string;
      observedAt: string;
      phase: SandboxLifecyclePhase;
      source?: SandboxOperationEventSource;
      status: SandboxLifecycleStatus;
    }
  | {
      kind: "transcript";
      observedAt: string;
      payloadBytes: Buffer;
      phase: SandboxLifecyclePhase | null;
      source?: SandboxOperationEventSource;
      stream: SandboxOperationTranscriptStream;
    };

const TextDecoderInstance = new TextDecoder();
const MaxOperationRecordBytes = 64 * 1024;
const MaxPersistedTranscriptBytesPerOperation = 1024 * 1024;

function toSessionKey(input: SessionKeyInput): string {
  return `${input.sandboxInstanceId}:${input.relaySessionId}`;
}

function parseOperationRecord(line: string): OperationRecord {
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed)) {
    throw new Error("Operation record must be a JSON object.");
  }

  const record = parsed;
  if (record.kind === "lifecycle") {
    const source = readOptionalOperationSource(record, "source");
    const lifecycleRecord: OperationRecord = {
      kind: "lifecycle",
      observedAt: readNonEmptyString(record, "observedAt"),
      phase: readLifecyclePhase(record, "phase"),
      status: readLifecycleStatus(record, "status"),
      message: readString(record, "message"),
      attributes: readRecordAttributes(record),
    };
    return source === undefined ? lifecycleRecord : { ...lifecycleRecord, source };
  }

  if (record.kind === "transcript") {
    const phase = record.phase;
    const payloadBase64 = readNonEmptyString(record, "payloadBase64");
    const source = readOptionalOperationSource(record, "source");
    const transcriptRecord: OperationRecord = {
      kind: "transcript",
      observedAt: readNonEmptyString(record, "observedAt"),
      payloadBytes: decodeBase64Payload(payloadBase64),
      phase: phase === null ? null : readLifecyclePhase(record, "phase"),
      stream: readTranscriptStream(record, "stream"),
    };
    return source === undefined ? transcriptRecord : { ...transcriptRecord, source };
  }

  throw new Error("Operation record kind must be lifecycle or transcript.");
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Operation record field '${key}' must be a string.`);
  }
  return value;
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (value.length === 0) {
    throw new Error(`Operation record field '${key}' must be non-empty.`);
  }
  return value;
}

function readOptionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  if (record[key] === undefined) {
    return undefined;
  }

  return readNonEmptyString(record, key);
}

function readLifecyclePhase(record: Record<string, unknown>, key: string): SandboxLifecyclePhase {
  const value = readNonEmptyString(record, key);
  switch (value) {
    case "provider":
    case "storage_provision":
    case "storage_attach":
    case "sandboxd":
    case "operation_stream":
    case "git_identity":
    case "egress":
    case "runtime_plan":
    case "setup_script":
    case "runtime_processes":
    case "runtime_adapters":
    case "agent_endpoint":
    case "ready":
    case "running":
    case "snapshot":
    case "stop":
    case "teardown":
      return value;
  }

  throw new Error(`Operation record field '${key}' is not a supported lifecycle phase.`);
}

function readLifecycleStatus(record: Record<string, unknown>, key: string): SandboxLifecycleStatus {
  const value = readNonEmptyString(record, key);
  switch (value) {
    case "started":
    case "completed":
    case "failed":
    case "warning":
      return value;
  }

  throw new Error(`Operation record field '${key}' is not a supported lifecycle status.`);
}

function readOptionalOperationSource(
  record: Record<string, unknown>,
  key: string,
): SandboxOperationEventSource | undefined {
  const value = readOptionalNonEmptyString(record, key);
  if (value === undefined) {
    return undefined;
  }
  switch (value) {
    case "worker":
    case "gateway":
    case "sandboxd":
      return value;
  }

  throw new Error(`Operation record field '${key}' is not a supported source.`);
}

function readTranscriptStream(
  record: Record<string, unknown>,
  key: string,
): SandboxOperationTranscriptStream {
  const value = readNonEmptyString(record, key);
  switch (value) {
    case "stdout":
    case "stderr":
    case "system":
      return value;
  }

  throw new Error(`Operation record field '${key}' is not a supported transcript stream.`);
}

function readRecordAttributes(record: Record<string, unknown>): Record<string, unknown> {
  const value = record.attributes;
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("Lifecycle operation record attributes must be an object.");
  }

  return value;
}

function decodeBase64Payload(value: string): Buffer {
  const buffer = Buffer.from(value, "base64");
  if (buffer.length === 0 || buffer.toString("base64") !== value) {
    throw new Error("Transcript operation record payloadBase64 must contain valid base64 bytes.");
  }

  return buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class SandboxOperationIngressService {
  readonly #deliveryChains = new Map<string, Promise<void>>();
  readonly #sessions = new Map<string, BootstrapOperationSession>();
  readonly #persistedTranscriptBytesByOperation = new Map<string, number>();

  public async handleDelivery(input: {
    db: DataPlaneDatabase;
    delivery: OperationDelivery;
    relaySessionId: string;
    sandboxInstanceId: string;
    sendControlMessage: (message: OperationControlMessage) => void;
    tables: Pick<DataPlaneTables, "sandboxOperationEvents">;
  }): Promise<void> {
    const sessionKey = toSessionKey(input);
    const previousDelivery = this.#deliveryChains.get(sessionKey) ?? Promise.resolve();
    const currentDelivery = (async () => {
      await previousDelivery.catch(() => undefined);
      await this.processDelivery(input);
    })();
    this.#deliveryChains.set(sessionKey, currentDelivery);
    try {
      await currentDelivery;
    } finally {
      if (this.#deliveryChains.get(sessionKey) === currentDelivery) {
        this.#deliveryChains.delete(sessionKey);
      }
    }
  }

  private async processDelivery(input: {
    db: DataPlaneDatabase;
    delivery: OperationDelivery;
    relaySessionId: string;
    sandboxInstanceId: string;
    sendControlMessage: (message: OperationControlMessage) => void;
    tables: Pick<DataPlaneTables, "sandboxOperationEvents">;
  }): Promise<void> {
    if (input.delivery.kind === "operationOpen") {
      this.handleOpen({
        delivery: input.delivery,
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
        sendControlMessage: input.sendControlMessage,
      });
      return;
    }

    const sessionKey = toSessionKey(input);
    const session = this.#sessions.get(sessionKey);
    if (session === undefined) {
      if (input.delivery.kind === "operationClose") {
        return;
      }

      input.sendControlMessage(
        createOperationReset({
          code: "operation_stream_not_found",
          message: `Operation stream ${String(input.delivery.streamId)} is not open on this bootstrap session.`,
          streamId: input.delivery.streamId,
        }),
      );
      return;
    }

    if (input.delivery.kind === "operationData") {
      await this.handleData({
        db: input.db,
        delivery: input.delivery,
        sandboxInstanceId: input.sandboxInstanceId,
        sendControlMessage: input.sendControlMessage,
        session,
        sessionKey,
        tables: input.tables,
      });
      return;
    }

    if (input.delivery.kind === "operationInvalidData") {
      const closedStream = session.closeStream(input.delivery.streamId);
      if (closedStream !== undefined) {
        this.clearTranscriptBudget(input.sandboxInstanceId, closedStream);
      }
      input.sendControlMessage(
        createOperationReset({
          code: "invalid_operation_payload_kind",
          message: "Operation streams only accept raw-bytes payloads.",
          streamId: input.delivery.streamId,
        }),
      );
      this.deleteSessionIfEmpty(sessionKey, session);
      return;
    }

    const closedStream = session.closeStream(input.delivery.message.streamId);
    if (closedStream !== undefined) {
      this.clearTranscriptBudget(input.sandboxInstanceId, closedStream);
    }
    this.deleteSessionIfEmpty(sessionKey, session);
  }

  public detachBootstrapSession(input: SessionKeyInput): void {
    const sessionKey = toSessionKey(input);
    const session = this.#sessions.get(sessionKey);
    if (session !== undefined) {
      for (const stream of session.closeAllStreams()) {
        this.clearTranscriptBudget(input.sandboxInstanceId, stream);
      }
      this.#sessions.delete(sessionKey);
    }
    this.#deliveryChains.delete(sessionKey);
  }

  public shutdown(): void {
    this.#deliveryChains.clear();
    this.#sessions.clear();
    this.#persistedTranscriptBytesByOperation.clear();
  }

  private handleOpen(input: {
    delivery: Extract<OperationDelivery, { kind: "operationOpen" }>;
    relaySessionId: string;
    sandboxInstanceId: string;
    sendControlMessage: (message: OperationControlMessage) => void;
  }): void {
    const sessionKey = toSessionKey(input);
    const session = this.#sessions.get(sessionKey) ?? new BootstrapOperationSession();
    const openResult = session.openStream({
      format: input.delivery.message.format,
      operationId: input.delivery.message.operationId,
      operationKind: input.delivery.message.operationKind,
      streamId: input.delivery.message.streamId,
    });
    if (openResult.kind === "error") {
      input.sendControlMessage(openResult.response);
      this.deleteSessionIfEmpty(sessionKey, session);
      return;
    }

    this.#sessions.set(sessionKey, session);
    input.sendControlMessage(openResult.response);
  }

  private async handleData(input: {
    db: DataPlaneDatabase;
    delivery: Extract<OperationDelivery, { kind: "operationData" }>;
    sandboxInstanceId: string;
    sendControlMessage: (message: OperationControlMessage) => void;
    session: BootstrapOperationSession;
    sessionKey: string;
    tables: Pick<DataPlaneTables, "sandboxOperationEvents">;
  }): Promise<void> {
    const frame = decodeDataFrame(new Uint8Array(input.delivery.payload));
    const consumeResult = input.session.consumeWindow({
      payloadByteLength: frame.payload.byteLength,
      streamId: input.delivery.streamId,
    });
    if (consumeResult.kind === "reset") {
      if (consumeResult.stream !== undefined) {
        this.clearTranscriptBudget(input.sandboxInstanceId, consumeResult.stream);
      }
      input.sendControlMessage(consumeResult.response);
      this.deleteSessionIfEmpty(input.sessionKey, input.session);
      return;
    }

    try {
      await this.persistRecords({
        db: input.db,
        payload: frame.payload,
        sandboxInstanceId: input.sandboxInstanceId,
        session: input.session,
        stream: consumeResult.stream,
        tables: input.tables,
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: consumeResult.stream.streamId,
        },
        "Failed ingesting sandbox operation stream records",
      );
      const closedStream = input.session.closeStream(consumeResult.stream.streamId);
      if (closedStream !== undefined) {
        this.clearTranscriptBudget(input.sandboxInstanceId, closedStream);
      }
      input.sendControlMessage(
        createOperationReset({
          code: "operation_ingest_failed",
          message: "Gateway failed to ingest operation records.",
          streamId: consumeResult.stream.streamId,
        }),
      );
      this.deleteSessionIfEmpty(input.sessionKey, input.session);
      return;
    }

    const replenishWindow = input.session.grantWindowIfNeeded({
      streamId: consumeResult.stream.streamId,
    });
    if (replenishWindow !== undefined) {
      input.sendControlMessage(replenishWindow);
    }
  }

  private async persistRecords(input: {
    db: DataPlaneDatabase;
    payload: Uint8Array;
    sandboxInstanceId: string;
    session: BootstrapOperationSession;
    stream: ActiveBootstrapOperationStream;
    tables: Pick<DataPlaneTables, "sandboxOperationEvents">;
  }): Promise<void> {
    const text = TextDecoderInstance.decode(input.payload);
    const lines = text.split("\n").filter((line) => line.length > 0);

    for (const line of lines) {
      if (Buffer.byteLength(line, "utf8") > MaxOperationRecordBytes) {
        continue;
      }

      const record = parseOperationRecord(line);
      const transcriptBytes = record.kind === "transcript" ? record.payloadBytes.byteLength : 0;
      if (transcriptBytes > 0) {
        const operationKey = `${input.sandboxInstanceId}:${input.stream.operationId}`;
        const persistedBytes = this.#persistedTranscriptBytesByOperation.get(operationKey) ?? 0;
        if (persistedBytes + transcriptBytes > MaxPersistedTranscriptBytesPerOperation) {
          continue;
        }
        this.#persistedTranscriptBytesByOperation.set(
          operationKey,
          persistedBytes + transcriptBytes,
        );
      }

      await insertSandboxOperationEvent(input.db, {
        sandboxInstanceId: input.sandboxInstanceId,
        operationKind: input.stream.operationKind,
        operationId: input.stream.operationId,
        recordKind: record.kind,
        observedAt: record.observedAt,
        source: record.source ?? "sandboxd",
        phase: record.phase,
        status: record.kind === "lifecycle" ? record.status : null,
        stream: record.kind === "transcript" ? record.stream : null,
        message: record.kind === "lifecycle" ? record.message : "",
        payloadBytes: record.kind === "transcript" ? record.payloadBytes : null,
        attributes: record.kind === "lifecycle" ? record.attributes : {},
      });
    }
  }

  private deleteSessionIfEmpty(sessionKey: string, session: BootstrapOperationSession): void {
    if (session.streamCount === 0) {
      this.#sessions.delete(sessionKey);
    }
  }

  private clearTranscriptBudget(
    sandboxInstanceId: string,
    stream: ActiveBootstrapOperationStream,
  ): void {
    this.#persistedTranscriptBytesByOperation.delete(`${sandboxInstanceId}:${stream.operationId}`);
  }
}
