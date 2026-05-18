import type { Clock } from "@mistle/time";
import {
  NoRespondersError,
  TimeoutError,
  type NatsConnection,
  type Subscription,
} from "@nats-io/transport-node";
import { z } from "zod";

import type { ActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import {
  recordGatewayRelayPeerLookupEvent,
  recordGatewayRelaySubscriptionFailure,
} from "../gateway-relay-observability.js";
import type { LocalPeerRegistryAdapter } from "../local-peer-registry/local-peer-registry-adapter.js";
import type { RelayPeerResolver } from "../relay-peer-resolver.js";
import type { RelayPeerSide, RelayTarget } from "../types.js";

const RequestTimeoutMs = 500;
const TextDecoderInstance = new TextDecoder();
const TextEncoderInstance = new TextEncoder();

const RelayTargetSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    side: z.enum(["bootstrap", "connection", "ptyClient", "ptySandbox"]),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();

function encodeJson(value: object): Uint8Array {
  return TextEncoderInstance.encode(JSON.stringify(value));
}

function decodeJson(data: Uint8Array): unknown {
  return JSON.parse(TextDecoderInstance.decode(data));
}

export class NatsRelayPeerResolver implements RelayPeerResolver {
  private connection: NatsConnection | undefined;
  private subscription: Subscription | undefined;

  public constructor(
    private readonly nodeId: string,
    private readonly subjectPrefix: string,
    private readonly activeBootstrapSessionStore: ActiveBootstrapSessionStore,
    private readonly localPeerRegistry: LocalPeerRegistryAdapter,
    private readonly clock: Clock,
  ) {}

  public start(connection: NatsConnection): void {
    if (this.subscription !== undefined) {
      throw new Error("NATS relay peer resolver is already started.");
    }

    const subscription = connection.subscribe(this.connectionPeerLookupSubjectPattern());
    this.connection = connection;
    this.subscription = subscription;
    void this.processSubscription(subscription).catch((error: unknown) => {
      recordGatewayRelaySubscriptionFailure({
        backend: "nats",
        error,
        localNodeId: this.nodeId,
        subscriptionKind: "peer_lookup",
      });
    });
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

  public async resolveBootstrapPeer(input: {
    sandboxInstanceId: string;
    targetSessionId?: string;
  }): Promise<RelayTarget | undefined> {
    const localTarget = this.localPeerRegistry.getBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (
      localTarget !== undefined &&
      (input.targetSessionId === undefined || input.targetSessionId === localTarget.sessionId)
    ) {
      recordGatewayRelayPeerLookupEvent({
        backend: "nats",
        localNodeId: this.nodeId,
        outcome: "local_hit",
        peerSide: "bootstrap",
        sandboxInstanceId: input.sandboxInstanceId,
        sessionId: localTarget.sessionId,
        targetNodeId: localTarget.nodeId,
      });
      return localTarget;
    }

    const activeSession = await this.activeBootstrapSessionStore.getActiveSession({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs: this.clock.nowMs(),
    });
    if (activeSession === null) {
      recordGatewayRelayPeerLookupEvent({
        backend: "nats",
        localNodeId: this.nodeId,
        outcome: "miss",
        peerSide: "bootstrap",
        sandboxInstanceId: input.sandboxInstanceId,
        ...(input.targetSessionId === undefined ? {} : { sessionId: input.targetSessionId }),
      });
      return undefined;
    }
    if (input.targetSessionId !== undefined && activeSession.sessionId !== input.targetSessionId) {
      recordGatewayRelayPeerLookupEvent({
        backend: "nats",
        localNodeId: this.nodeId,
        outcome: "miss",
        peerSide: "bootstrap",
        sandboxInstanceId: input.sandboxInstanceId,
        sessionId: input.targetSessionId,
        targetNodeId: activeSession.nodeId,
      });
      return undefined;
    }

    recordGatewayRelayPeerLookupEvent({
      backend: "nats",
      localNodeId: this.nodeId,
      outcome: "active_bootstrap_hit",
      peerSide: "bootstrap",
      sandboxInstanceId: activeSession.sandboxInstanceId,
      sessionId: activeSession.sessionId,
      targetNodeId: activeSession.nodeId,
    });
    return {
      sandboxInstanceId: activeSession.sandboxInstanceId,
      side: "bootstrap",
      nodeId: activeSession.nodeId,
      sessionId: activeSession.sessionId,
    };
  }

  public async resolveConnectionPeer(input: {
    sandboxInstanceId: string;
    sessionId: string;
  }): Promise<RelayTarget | undefined> {
    return this.resolveSessionPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "connection",
      sessionId: input.sessionId,
    });
  }

  public async resolveSessionPeer(input: {
    sandboxInstanceId: string;
    side: RelayPeerSide;
    sessionId: string;
  }): Promise<RelayTarget | undefined> {
    const localTarget = this.localPeerRegistry.getConnectionPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: input.side,
      sessionId: input.sessionId,
    });
    if (localTarget !== undefined) {
      recordGatewayRelayPeerLookupEvent({
        backend: "nats",
        localNodeId: this.nodeId,
        outcome: "local_hit",
        peerSide: input.side,
        sandboxInstanceId: input.sandboxInstanceId,
        sessionId: input.sessionId,
        targetNodeId: localTarget.nodeId,
      });
      return localTarget;
    }

    const connection = this.connection;
    if (connection === undefined) {
      throw new Error("NATS relay peer resolver has not been started.");
    }

    try {
      const response = await connection.request(
        this.connectionPeerLookupSubject(input),
        undefined,
        {
          timeout: RequestTimeoutMs,
        },
      );

      const target = RelayTargetSchema.parse(decodeJson(response.data));
      recordGatewayRelayPeerLookupEvent({
        backend: "nats",
        localNodeId: this.nodeId,
        outcome: "remote_hit",
        peerSide: input.side,
        sandboxInstanceId: input.sandboxInstanceId,
        sessionId: input.sessionId,
        targetNodeId: target.nodeId,
      });
      return target;
    } catch (error) {
      if (error instanceof NoRespondersError) {
        recordGatewayRelayPeerLookupEvent({
          backend: "nats",
          localNodeId: this.nodeId,
          outcome: "no_responders",
          peerSide: input.side,
          sandboxInstanceId: input.sandboxInstanceId,
          sessionId: input.sessionId,
        });
        return undefined;
      }
      if (error instanceof TimeoutError) {
        recordGatewayRelayPeerLookupEvent({
          backend: "nats",
          localNodeId: this.nodeId,
          outcome: "timeout",
          peerSide: input.side,
          sandboxInstanceId: input.sandboxInstanceId,
          sessionId: input.sessionId,
        });
        return undefined;
      }

      throw error;
    }
  }

  private async processSubscription(subscription: Subscription): Promise<void> {
    for await (const message of subscription) {
      const lookup = this.parseConnectionPeerLookupSubject(message.subject);
      const target = this.localPeerRegistry.getConnectionPeer({
        sandboxInstanceId: lookup.sandboxInstanceId,
        side: lookup.side,
        sessionId: lookup.sessionId,
      });
      if (target !== undefined) {
        message.respond(encodeJson(target));
      }
    }
  }

  private connectionPeerLookupSubject(input: {
    sandboxInstanceId: string;
    side: RelayPeerSide;
    sessionId: string;
  }): string {
    return `${this.subjectPrefix}.peer.session.${input.side}.${input.sandboxInstanceId}.${input.sessionId}`;
  }

  private connectionPeerLookupSubjectPattern(): string {
    return `${this.subjectPrefix}.peer.session.*.*.*`;
  }

  private parseConnectionPeerLookupSubject(subject: string): {
    sandboxInstanceId: string;
    side: RelayPeerSide;
    sessionId: string;
  } {
    const prefix = `${this.subjectPrefix}.peer.session.`;
    if (!subject.startsWith(prefix)) {
      throw new Error(`Unexpected NATS relay peer lookup subject '${subject}'.`);
    }
    const suffix = subject.slice(prefix.length);
    const tokens = suffix.split(".");
    const side = tokens[0];
    if (
      tokens.length !== 3 ||
      !isRelayPeerSide(side) ||
      tokens[1] === undefined ||
      tokens[2] === undefined
    ) {
      throw new Error(`Unexpected NATS relay peer lookup subject '${subject}'.`);
    }

    return {
      sandboxInstanceId: tokens[1],
      side,
      sessionId: tokens[2],
    };
  }
}

function isRelayPeerSide(value: string | undefined): value is RelayPeerSide {
  return (
    value === "bootstrap" ||
    value === "connection" ||
    value === "ptyClient" ||
    value === "ptySandbox"
  );
}
