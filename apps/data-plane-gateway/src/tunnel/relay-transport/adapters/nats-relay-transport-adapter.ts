import type { NatsConnection, Subscription } from "@nats-io/transport-node";
import { WebSocket } from "ws";
import { z } from "zod";

import type { RelayEnvelope, RelayPayload, RelayPeerSocket, RelayTarget } from "../../types.js";
import type { RelayTransportAdapter } from "../relay-transport-adapter.js";

const TextDecoderInstance = new TextDecoder();
const TextEncoderInstance = new TextEncoder();

const RelayTargetSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    side: z.enum(["bootstrap", "connection"]),
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
]);

type WireRelayEnvelope = z.infer<typeof WireRelayEnvelopeSchema>;

function toRelayPayload(wirePayload: WireRelayEnvelope & { kind: "frame" }): RelayPayload {
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
  private readonly socketsBySessionId = new Map<string, RelayPeerSocket>();
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
    void this.processSubscription(subscription);
  }

  public async stop(): Promise<void> {
    const subscription = this.subscription;
    if (subscription === undefined) {
      return;
    }

    this.subscription = undefined;
    this.connection = undefined;
    await subscription.drain();
  }

  public registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void {
    if (input.target.nodeId !== this.nodeId) {
      throw new Error("Expected local peer registration to target current gateway node.");
    }

    this.socketsBySessionId.set(input.target.sessionId, input.socket);
  }

  public unregisterLocalPeer(input: { target: RelayTarget }): void {
    if (input.target.nodeId !== this.nodeId) {
      return;
    }
    this.socketsBySessionId.delete(input.target.sessionId);
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

    connection.publish(
      this.relaySubject(envelope.target.nodeId),
      encodeJson(toWireEnvelope(envelope)),
    );
  }

  private async processSubscription(subscription: Subscription): Promise<void> {
    for await (const message of subscription) {
      const envelope = this.decodeEnvelope(message.data);
      this.deliverLocalEnvelope(envelope);
    }
  }

  private decodeEnvelope(data: Uint8Array): RelayEnvelope {
    const parsed = WireRelayEnvelopeSchema.parse(decodeJson(data));
    if (parsed.kind === "close") {
      return parsed;
    }

    return {
      kind: "frame",
      target: parsed.target,
      payload: toRelayPayload(parsed),
    };
  }

  private deliverLocalEnvelope(envelope: RelayEnvelope): void {
    if (envelope.target.nodeId !== this.nodeId) {
      throw new Error("Expected local relay envelope to target current gateway node.");
    }

    const socket = this.socketsBySessionId.get(envelope.target.sessionId);
    if (socket === undefined) {
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (envelope.kind === "frame") {
      socket.send(envelope.payload);
      return;
    }

    socket.close(envelope.closeCode, envelope.closeReason);
  }

  private localRelaySubject(): string {
    return this.relaySubject(this.nodeId);
  }

  private relaySubject(nodeId: string): string {
    return `${this.subjectPrefix}.relay.${nodeId}`;
  }
}
