import { randomUUID } from "node:crypto";

import type { NatsConnection, Subscription } from "@nats-io/transport-node";
import { WebSocket } from "ws";
import { z } from "zod";

import {
  recordGatewayRelayEnvelopeEvent,
  recordGatewayRelayLifecycleEvent,
  recordGatewayRelayPublishEvent,
  recordGatewayRelaySubscriptionFailure,
} from "../../gateway-relay-observability.js";
import type { RelayEnvelope, RelayPayload, RelayPeerSocket, RelayTarget } from "../../types.js";
import type { RelayTransportAdapter } from "../relay-transport-adapter.js";

const TextDecoderInstance = new TextDecoder();
const TextEncoderInstance = new TextEncoder();
const MaxDirectNatsRelayEncodedBytes = 900_000;
const MaxChunkPayloadBytes = 512 * 1024;
const MaxReassembledPayloadBytes = 64 * 1024 * 1024;
const ReassemblyTimeoutMs = 30_000;

const RelayTargetSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    side: z.enum(["bootstrap", "connection", "ptyClient", "ptySandbox"]),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();

const WireRelayEnvelopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("frame"),
      target: RelayTargetSchema,
      payload: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("text"),
            value: z.string(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("base64"),
            value: z.string(),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("close"),
      target: RelayTargetSchema,
      closeCode: z.number().int().min(1000).max(4999),
      closeReason: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("frame_chunk"),
      target: RelayTargetSchema,
      messageId: z.string().min(1),
      payloadKind: z.enum(["text", "binary"]),
      chunkIndex: z.number().int().min(0),
      chunkCount: z.number().int().min(1),
      originalPayloadBytes: z.number().int().min(0).max(MaxReassembledPayloadBytes),
      value: z.string(),
    })
    .strict(),
]);

type WireRelayEnvelope = z.infer<typeof WireRelayEnvelopeSchema>;
type WireRelayFrameEnvelope = Extract<WireRelayEnvelope, { kind: "frame" }>;
type WireRelayFrameChunkEnvelope = Extract<WireRelayEnvelope, { kind: "frame_chunk" }>;
type WireRelayPayloadKind = WireRelayFrameChunkEnvelope["payloadKind"];
type ReassemblyState = {
  chunkCount: number;
  chunks: Map<number, Uint8Array>;
  createdAtMs: number;
  originalPayloadBytes: number;
  payloadKind: WireRelayPayloadKind;
  receivedBytes: number;
  target: RelayTarget;
};

function toRelayPayload(wirePayload: WireRelayFrameEnvelope): RelayPayload {
  if (wirePayload.payload.kind === "text") {
    return wirePayload.payload.value;
  }

  const buffer = Buffer.from(wirePayload.payload.value, "base64");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function toWireEnvelope(envelope: RelayEnvelope): WireRelayEnvelope {
  if (envelope.kind === "close") {
    return envelope;
  }

  return {
    kind: "frame",
    target: envelope.target,
    payload:
      typeof envelope.payload === "string"
        ? {
            kind: "text",
            value: envelope.payload,
          }
        : {
            kind: "base64",
            value: Buffer.from(envelope.payload).toString("base64"),
          },
  };
}

function encodeJson(value: object): Uint8Array {
  return TextEncoderInstance.encode(JSON.stringify(value));
}

function decodeJson(data: Uint8Array): unknown {
  return JSON.parse(TextDecoderInstance.decode(data));
}

export class NatsRelayTransportAdapter implements RelayTransportAdapter {
  private readonly chunkReassemblyByKey = new Map<string, ReassemblyState>();
  private readonly socketsByPeerKey = new Map<string, RelayPeerSocket>();
  private connection: NatsConnection | undefined;
  private subscription: Subscription | undefined;

  public constructor(
    private readonly nodeId: string,
    private readonly subjectPrefix: string,
  ) {}

  public start(connection: NatsConnection): void {
    if (this.subscription !== undefined) {
      throw new Error("NATS relay transport adapter is already started.");
    }

    const subscription = connection.subscribe(this.localRelaySubject());
    this.connection = connection;
    this.subscription = subscription;
    void this.processSubscription(subscription).catch((error: unknown) => {
      recordGatewayRelaySubscriptionFailure({
        backend: "nats",
        error,
        localNodeId: this.nodeId,
        subscriptionKind: "relay_transport",
      });
    });
    recordGatewayRelayLifecycleEvent({
      backend: "nats",
      event: "started",
      localNodeId: this.nodeId,
    });
  }

  public async stop(): Promise<void> {
    const subscription = this.subscription;
    if (subscription === undefined) {
      return;
    }

    this.subscription = undefined;
    this.connection = undefined;
    this.chunkReassemblyByKey.clear();
    await subscription.drain();
    recordGatewayRelayLifecycleEvent({
      backend: "nats",
      event: "stopped",
      localNodeId: this.nodeId,
    });
  }

  public registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void {
    if (input.target.nodeId !== this.nodeId) {
      throw new Error("Expected local peer registration to target current gateway node.");
    }

    this.socketsByPeerKey.set(createPeerKey(input.target), input.socket);
  }

  public unregisterLocalPeer(input: { target: RelayTarget }): void {
    if (input.target.nodeId !== this.nodeId) {
      return;
    }
    this.socketsByPeerKey.delete(createPeerKey(input.target));
    this.deleteReassemblyStatesForTarget(input.target);
  }

  public async deliverEnvelope(envelope: RelayEnvelope): Promise<void> {
    if (envelope.target.nodeId === this.nodeId) {
      this.deliverLocalEnvelope(envelope);
      return;
    }

    const connection = this.connection;
    if (connection === undefined) {
      throw new Error("NATS relay transport adapter has not been started.");
    }

    const wireEnvelope = toWireEnvelope(envelope);
    const encodedEnvelope = encodeJson(wireEnvelope);
    if (envelope.kind === "frame" && encodedEnvelope.byteLength > MaxDirectNatsRelayEncodedBytes) {
      this.publishChunkedFrameEnvelope({
        connection,
        envelope,
      });
      recordGatewayRelayEnvelopeEvent({
        backend: "nats",
        direction: "published",
        envelope,
        localNodeId: this.nodeId,
      });
      return;
    }

    this.publishEncodedEnvelope({
      connection,
      encodedEnvelope,
      envelope,
    });
    recordGatewayRelayEnvelopeEvent({
      backend: "nats",
      direction: "published",
      envelope,
      localNodeId: this.nodeId,
    });
  }

  private publishChunkedFrameEnvelope(input: {
    connection: NatsConnection;
    envelope: RelayEnvelope & { kind: "frame" };
  }): void {
    const messageId = randomUUID();
    const payloadDescription = describeRelayFramePayload(input.envelope.payload);
    if (payloadDescription.bytes.byteLength > MaxReassembledPayloadBytes) {
      throw new Error(
        `Relay frame payload is too large for NATS chunk reassembly: ${String(payloadDescription.bytes.byteLength)} bytes exceeds ${String(MaxReassembledPayloadBytes)} bytes.`,
      );
    }

    const chunkCount = Math.ceil(payloadDescription.bytes.byteLength / MaxChunkPayloadBytes);

    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const start = chunkIndex * MaxChunkPayloadBytes;
      const end = Math.min(start + MaxChunkPayloadBytes, payloadDescription.bytes.byteLength);
      const wireChunk: WireRelayFrameChunkEnvelope = {
        kind: "frame_chunk",
        target: input.envelope.target,
        messageId,
        payloadKind: payloadDescription.payloadKind,
        chunkIndex,
        chunkCount,
        originalPayloadBytes: payloadDescription.bytes.byteLength,
        value: Buffer.from(payloadDescription.bytes.subarray(start, end)).toString("base64"),
      };

      this.publishEncodedEnvelope({
        connection: input.connection,
        encodedEnvelope: encodeJson(wireChunk),
        envelope: input.envelope,
      });
    }
  }

  private publishEncodedEnvelope(input: {
    connection: NatsConnection;
    encodedEnvelope: Uint8Array;
    envelope: RelayEnvelope;
  }): void {
    try {
      input.connection.publish(
        this.relaySubject(input.envelope.target.nodeId),
        input.encodedEnvelope,
      );
    } catch (error) {
      recordGatewayRelayPublishEvent({
        backend: "nats",
        encodedBytes: input.encodedEnvelope.byteLength,
        envelope: input.envelope,
        error,
        localNodeId: this.nodeId,
        outcome: "failed",
      });
      throw error;
    }
    recordGatewayRelayPublishEvent({
      backend: "nats",
      encodedBytes: input.encodedEnvelope.byteLength,
      envelope: input.envelope,
      localNodeId: this.nodeId,
      outcome: "succeeded",
    });
  }

  private async processSubscription(subscription: Subscription): Promise<void> {
    for await (const message of subscription) {
      const envelope = this.decodeEnvelope(message.data);
      if (envelope === undefined) {
        continue;
      }
      recordGatewayRelayEnvelopeEvent({
        backend: "nats",
        direction: "received",
        envelope,
        localNodeId: this.nodeId,
      });
      this.deliverLocalEnvelope(envelope);
    }
  }

  private decodeEnvelope(data: Uint8Array): RelayEnvelope | undefined {
    const parsed = WireRelayEnvelopeSchema.parse(decodeJson(data));
    if (parsed.kind === "close") {
      return parsed;
    }
    if (parsed.kind === "frame_chunk") {
      return this.receiveFrameChunk(parsed);
    }

    return {
      kind: "frame",
      target: parsed.target,
      payload: toRelayPayload(parsed),
    };
  }

  private receiveFrameChunk(chunk: WireRelayFrameChunkEnvelope): RelayEnvelope | undefined {
    this.deleteExpiredReassemblyStates();

    if (chunk.chunkIndex >= chunk.chunkCount) {
      return undefined;
    }

    const key = createChunkReassemblyKey(chunk);
    const existing = this.chunkReassemblyByKey.get(key);
    const state =
      existing ??
      ({
        chunkCount: chunk.chunkCount,
        chunks: new Map<number, Uint8Array>(),
        createdAtMs: Date.now(),
        originalPayloadBytes: chunk.originalPayloadBytes,
        payloadKind: chunk.payloadKind,
        receivedBytes: 0,
        target: chunk.target,
      } satisfies ReassemblyState);

    if (!isCompatibleChunkState(state, chunk)) {
      this.chunkReassemblyByKey.delete(key);
      return undefined;
    }
    if (state.chunks.has(chunk.chunkIndex)) {
      return undefined;
    }

    const chunkBytes = Buffer.from(chunk.value, "base64");
    const nextReceivedBytes = state.receivedBytes + chunkBytes.byteLength;
    if (nextReceivedBytes > state.originalPayloadBytes) {
      this.chunkReassemblyByKey.delete(key);
      return undefined;
    }

    state.chunks.set(
      chunk.chunkIndex,
      new Uint8Array(
        chunkBytes.buffer.slice(
          chunkBytes.byteOffset,
          chunkBytes.byteOffset + chunkBytes.byteLength,
        ),
      ),
    );
    state.receivedBytes = nextReceivedBytes;
    this.chunkReassemblyByKey.set(key, state);

    if (state.chunks.size !== state.chunkCount) {
      return undefined;
    }

    this.chunkReassemblyByKey.delete(key);
    return {
      kind: "frame",
      target: state.target,
      payload: reassemblePayload(state),
    };
  }

  private deleteExpiredReassemblyStates(): void {
    const cutoffMs = Date.now() - ReassemblyTimeoutMs;
    for (const [key, state] of this.chunkReassemblyByKey) {
      if (state.createdAtMs < cutoffMs) {
        this.chunkReassemblyByKey.delete(key);
      }
    }
  }

  private deleteReassemblyStatesForTarget(target: RelayTarget): void {
    for (const [key, state] of this.chunkReassemblyByKey) {
      if (isSameRelayTarget(state.target, target)) {
        this.chunkReassemblyByKey.delete(key);
      }
    }
  }

  private deliverLocalEnvelope(envelope: RelayEnvelope): void {
    if (envelope.target.nodeId !== this.nodeId) {
      throw new Error("Expected local relay envelope to target current gateway node.");
    }

    const socket = this.socketsByPeerKey.get(createPeerKey(envelope.target));
    if (socket === undefined) {
      recordGatewayRelayEnvelopeEvent({
        backend: "nats",
        direction: "dropped",
        dropReason: "missing_local_socket",
        envelope,
        localNodeId: this.nodeId,
      });
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      recordGatewayRelayEnvelopeEvent({
        backend: "nats",
        direction: "dropped",
        dropReason: "local_socket_not_open",
        envelope,
        localNodeId: this.nodeId,
      });
      return;
    }

    if (envelope.kind === "frame") {
      socket.send(envelope.payload);
      recordGatewayRelayEnvelopeEvent({
        backend: "nats",
        direction: "local_delivered",
        envelope,
        localNodeId: this.nodeId,
      });
      return;
    }

    socket.close(envelope.closeCode, envelope.closeReason);
    recordGatewayRelayEnvelopeEvent({
      backend: "nats",
      direction: "local_delivered",
      envelope,
      localNodeId: this.nodeId,
    });
  }

  private localRelaySubject(): string {
    return this.relaySubject(this.nodeId);
  }

  private relaySubject(nodeId: string): string {
    return `${this.subjectPrefix}.relay.${nodeId}`;
  }
}

function createPeerKey(target: RelayTarget): string {
  return `${target.side}:${target.sessionId}`;
}

function createChunkReassemblyKey(chunk: WireRelayFrameChunkEnvelope): string {
  return `${createPeerKey(chunk.target)}:${chunk.messageId}`;
}

function describeRelayFramePayload(payload: RelayPayload): {
  bytes: Uint8Array;
  payloadKind: WireRelayPayloadKind;
} {
  if (typeof payload === "string") {
    return {
      bytes: TextEncoderInstance.encode(payload),
      payloadKind: "text",
    };
  }

  return {
    bytes: new Uint8Array(payload),
    payloadKind: "binary",
  };
}

function isCompatibleChunkState(
  state: ReassemblyState,
  chunk: WireRelayFrameChunkEnvelope,
): boolean {
  return (
    state.chunkCount === chunk.chunkCount &&
    state.originalPayloadBytes === chunk.originalPayloadBytes &&
    state.payloadKind === chunk.payloadKind &&
    isSameRelayTarget(state.target, chunk.target)
  );
}

function isSameRelayTarget(left: RelayTarget, right: RelayTarget): boolean {
  return (
    left.nodeId === right.nodeId &&
    left.sandboxInstanceId === right.sandboxInstanceId &&
    left.sessionId === right.sessionId &&
    left.side === right.side
  );
}

function reassemblePayload(state: ReassemblyState): RelayPayload {
  const payload = new Uint8Array(state.originalPayloadBytes);
  let offset = 0;

  for (let chunkIndex = 0; chunkIndex < state.chunkCount; chunkIndex += 1) {
    const chunk = state.chunks.get(chunkIndex);
    if (chunk === undefined) {
      throw new Error("Cannot reassemble relay payload with a missing chunk.");
    }
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (state.payloadKind === "text") {
    return TextDecoderInstance.decode(payload);
  }

  return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
}
