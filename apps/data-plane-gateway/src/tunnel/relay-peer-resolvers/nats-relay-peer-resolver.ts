import type { Clock } from "@mistle/time";
import {
  NoRespondersError,
  TimeoutError,
  type NatsConnection,
  type Subscription,
} from "@nats-io/transport-node";
import { z } from "zod";

import type { ActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import type { LocalPeerRegistryAdapter } from "../local-peer-registry/local-peer-registry-adapter.js";
import type { RelayPeerResolver } from "../relay-peer-resolver.js";
import type { RelayTarget } from "../types.js";

const RequestTimeoutMs = 500;
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
      return localTarget;
    }

    const activeSession = await this.activeBootstrapSessionStore.getActiveSession({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs: this.clock.nowMs(),
    });
    if (activeSession === null) {
      return undefined;
    }
    if (input.targetSessionId !== undefined && activeSession.sessionId !== input.targetSessionId) {
      return undefined;
    }

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
    const localTarget = this.localPeerRegistry.getConnectionPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "connection",
      sessionId: input.sessionId,
    });
    if (localTarget !== undefined) {
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

      return RelayTargetSchema.parse(decodeJson(response.data));
    } catch (error) {
      if (error instanceof NoRespondersError || error instanceof TimeoutError) {
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
        side: "connection",
        sessionId: lookup.sessionId,
      });
      if (target !== undefined) {
        message.respond(encodeJson(target));
      }
    }
  }

  private connectionPeerLookupSubject(input: {
    sandboxInstanceId: string;
    sessionId: string;
  }): string {
    return `${this.subjectPrefix}.peer.connection.${input.sandboxInstanceId}.${input.sessionId}`;
  }

  private connectionPeerLookupSubjectPattern(): string {
    return `${this.subjectPrefix}.peer.connection.*.*`;
  }

  private parseConnectionPeerLookupSubject(subject: string): {
    sandboxInstanceId: string;
    sessionId: string;
  } {
    const prefix = `${this.subjectPrefix}.peer.connection.`;
    if (!subject.startsWith(prefix)) {
      throw new Error(`Unexpected NATS relay peer lookup subject '${subject}'.`);
    }
    const suffix = subject.slice(prefix.length);
    const tokens = suffix.split(".");
    if (tokens.length !== 2 || tokens[0] === undefined || tokens[1] === undefined) {
      throw new Error(`Unexpected NATS relay peer lookup subject '${subject}'.`);
    }

    return {
      sandboxInstanceId: tokens[0],
      sessionId: tokens[1],
    };
  }
}
