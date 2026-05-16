import type { NatsConnection, Subscription } from "@nats-io/transport-node";
import { z } from "zod";

import { recordGatewayRelaySubscriptionFailure } from "../../gateway-relay-observability.js";
import type { GatewayForwardingClientAdapter } from "../gateway-forwarding-client-adapter.js";
import type { GatewayForwardingServerAdapter } from "../gateway-forwarding-server-adapter.js";
import type {
  CloseInteractiveStreamInput,
  FindInteractiveStreamByClientInput,
  FindInteractiveStreamByTunnelInput,
  GatewayForwardingTarget,
  InteractiveStreamRoute,
  OpenInteractiveStreamInput,
  ReleaseClientSessionStreamsInput,
  ReleaseClientSessionStreamsResult,
} from "../types.js";

const RequestTimeoutMs = 5_000;
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

const StreamChannelKindSchema = z.enum(["agent", "processes", "pty", "fileUpload", "exec"]);

const ClientStreamBindingSchema = z
  .object({
    channelKind: StreamChannelKindSchema,
    clientSessionId: z.string().min(1),
    clientStreamId: z.number().int().positive(),
    tunnelStreamId: z.number().int().positive(),
  })
  .strict();

const InteractiveStreamRouteSchema = z
  .object({
    bootstrapTarget: RelayTargetSchema,
    binding: ClientStreamBindingSchema,
  })
  .strict();

const ReleaseClientSessionStreamsResultSchema = z
  .object({
    bootstrapTarget: z.union([RelayTargetSchema, z.undefined()]),
    releasedBindings: z.array(ClientStreamBindingSchema),
  })
  .strict();

const GatewayForwardingTargetSchema = z
  .object({
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
    targetBootstrapSessionId: z.string().min(1),
  })
  .strict();

const GatewayForwardingRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("openInteractiveStream"),
      target: GatewayForwardingTargetSchema,
      input: z
        .object({
          sandboxInstanceId: z.string().min(1),
          clientSessionId: z.string().min(1),
          clientStreamId: z.number().int().positive(),
          channelKind: StreamChannelKindSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("findInteractiveStreamByClient"),
      target: GatewayForwardingTargetSchema,
      input: z
        .object({
          sandboxInstanceId: z.string().min(1),
          clientSessionId: z.string().min(1),
          clientStreamId: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("findInteractiveStreamByTunnel"),
      target: GatewayForwardingTargetSchema,
      input: z
        .object({
          sandboxInstanceId: z.string().min(1),
          tunnelStreamId: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("closeInteractiveStream"),
      target: GatewayForwardingTargetSchema,
      input: z
        .object({
          sandboxInstanceId: z.string().min(1),
          clientSessionId: z.string().min(1),
          clientStreamId: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("releaseClientSessionStreams"),
      target: GatewayForwardingTargetSchema,
      input: z
        .object({
          sandboxInstanceId: z.string().min(1),
          clientSessionId: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);

const GatewayForwardingResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("route"),
      route: InteractiveStreamRouteSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("releaseResult"),
      result: ReleaseClientSessionStreamsResultSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("missing"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("error"),
      message: z.string().min(1),
    })
    .strict(),
]);

type GatewayForwardingRequest = z.infer<typeof GatewayForwardingRequestSchema>;
type GatewayForwardingResponse = z.infer<typeof GatewayForwardingResponseSchema>;

function encodeJson(value: object): Uint8Array {
  return TextEncoderInstance.encode(JSON.stringify(value));
}

function decodeJson(data: Uint8Array): unknown {
  return JSON.parse(TextDecoderInstance.decode(data));
}

export class NatsGatewayForwardingAdapter implements GatewayForwardingClientAdapter {
  private connection: NatsConnection | undefined;
  private subscription: Subscription | undefined;

  public constructor(
    private readonly nodeId: string,
    private readonly subjectPrefix: string,
    private readonly localServer: GatewayForwardingServerAdapter,
  ) {}

  public start(connection: NatsConnection): void {
    if (this.subscription !== undefined) {
      throw new Error("NATS gateway forwarding adapter is already started.");
    }

    const subscription = connection.subscribe(this.localForwardingSubject());
    this.connection = connection;
    this.subscription = subscription;
    void this.processSubscription(subscription).catch((error: unknown) => {
      recordGatewayRelaySubscriptionFailure({
        backend: "nats",
        error,
        localNodeId: this.nodeId,
        subscriptionKind: "gateway_forwarding",
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

  public async openInteractiveStream(
    target: GatewayForwardingTarget,
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute> {
    if (target.targetNodeId === this.nodeId) {
      return this.localServer.openInteractiveStream(target, input);
    }

    const response = await this.request({
      operation: "openInteractiveStream",
      target,
      input,
    });
    if (response.kind === "route") {
      return response.route;
    }
    if (response.kind === "error") {
      throw new Error(response.message);
    }

    throw new Error("Remote gateway forwarding openInteractiveStream returned no route.");
  }

  public async findInteractiveStreamByClient(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    if (target.targetNodeId === this.nodeId) {
      return this.localServer.findInteractiveStreamByClient(target, input);
    }

    const response = await this.request({
      operation: "findInteractiveStreamByClient",
      target,
      input,
    });
    return this.optionalRouteResponse(response);
  }

  public async findInteractiveStreamByTunnel(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    if (target.targetNodeId === this.nodeId) {
      return this.localServer.findInteractiveStreamByTunnel(target, input);
    }

    const response = await this.request({
      operation: "findInteractiveStreamByTunnel",
      target,
      input,
    });
    return this.optionalRouteResponse(response);
  }

  public async closeInteractiveStream(
    target: GatewayForwardingTarget,
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    if (target.targetNodeId === this.nodeId) {
      return this.localServer.closeInteractiveStream(target, input);
    }

    const response = await this.request({
      operation: "closeInteractiveStream",
      target,
      input,
    });
    return this.optionalRouteResponse(response);
  }

  public async releaseClientSessionStreams(
    target: GatewayForwardingTarget,
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    if (target.targetNodeId === this.nodeId) {
      return this.localServer.releaseClientSessionStreams(target, input);
    }

    const response = await this.request({
      operation: "releaseClientSessionStreams",
      target,
      input,
    });
    if (response.kind === "releaseResult") {
      return response.result;
    }
    if (response.kind === "error") {
      throw new Error(response.message);
    }

    throw new Error("Remote gateway forwarding releaseClientSessionStreams returned no result.");
  }

  private async request(request: GatewayForwardingRequest): Promise<GatewayForwardingResponse> {
    const connection = this.connection;
    if (connection === undefined) {
      throw new Error("NATS gateway forwarding adapter has not been started.");
    }

    const response = await connection.request(
      this.forwardingSubject(request.target.targetNodeId),
      encodeJson(request),
      {
        timeout: RequestTimeoutMs,
      },
    );

    return GatewayForwardingResponseSchema.parse(decodeJson(response.data));
  }

  private optionalRouteResponse(
    response: GatewayForwardingResponse,
  ): InteractiveStreamRoute | undefined {
    if (response.kind === "route") {
      return response.route;
    }
    if (response.kind === "missing") {
      return undefined;
    }
    if (response.kind === "error") {
      throw new Error(response.message);
    }

    throw new Error("Remote gateway forwarding returned an unexpected release result.");
  }

  private async processSubscription(subscription: Subscription): Promise<void> {
    for await (const message of subscription) {
      const response = await this.handleRequest(message.data);
      message.respond(encodeJson(response));
    }
  }

  private async handleRequest(data: Uint8Array): Promise<GatewayForwardingResponse> {
    try {
      const request = GatewayForwardingRequestSchema.parse(decodeJson(data));
      if (request.operation === "openInteractiveStream") {
        return {
          kind: "route",
          route: await this.localServer.openInteractiveStream(request.target, request.input),
        };
      }
      if (request.operation === "findInteractiveStreamByClient") {
        return this.toOptionalRouteResponse(
          await this.localServer.findInteractiveStreamByClient(request.target, request.input),
        );
      }
      if (request.operation === "findInteractiveStreamByTunnel") {
        return this.toOptionalRouteResponse(
          await this.localServer.findInteractiveStreamByTunnel(request.target, request.input),
        );
      }
      if (request.operation === "closeInteractiveStream") {
        return this.toOptionalRouteResponse(
          await this.localServer.closeInteractiveStream(request.target, request.input),
        );
      }

      return {
        kind: "releaseResult",
        result: await this.localServer.releaseClientSessionStreams(request.target, request.input),
      };
    } catch (error) {
      return {
        kind: "error",
        message: error instanceof Error ? error.message : "Gateway forwarding request failed.",
      };
    }
  }

  private toOptionalRouteResponse(
    route: InteractiveStreamRoute | undefined,
  ): GatewayForwardingResponse {
    if (route === undefined) {
      return {
        kind: "missing",
      };
    }

    return {
      kind: "route",
      route,
    };
  }

  private localForwardingSubject(): string {
    return this.forwardingSubject(this.nodeId);
  }

  private forwardingSubject(nodeId: string): string {
    return `${this.subjectPrefix}.forward.${nodeId}`;
  }
}
