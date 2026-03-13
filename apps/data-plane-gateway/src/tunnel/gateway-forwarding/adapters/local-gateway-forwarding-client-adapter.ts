import type { GatewayForwardingClientAdapter } from "../gateway-forwarding-client-adapter.js";
import { GatewayForwardingServer } from "../gateway-forwarding-server.js";
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

/**
 * In-process forwarding client used when the current node is also the owner node.
 */
export class LocalGatewayForwardingClientAdapter implements GatewayForwardingClientAdapter {
  public constructor(
    private readonly localNodeId: string,
    private readonly gatewayForwardingServer: GatewayForwardingServer,
  ) {}

  public async openInteractiveStream(
    target: GatewayForwardingTarget,
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute> {
    this.assertLocalTarget(target);
    return this.gatewayForwardingServer.openInteractiveStream(target, input);
  }

  public async findInteractiveStreamByClient(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    this.assertLocalTarget(target);
    return this.gatewayForwardingServer.findInteractiveStreamByClient(target, input);
  }

  public async findInteractiveStreamByTunnel(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    this.assertLocalTarget(target);
    return this.gatewayForwardingServer.findInteractiveStreamByTunnel(target, input);
  }

  public async closeInteractiveStream(
    target: GatewayForwardingTarget,
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    this.assertLocalTarget(target);
    return this.gatewayForwardingServer.closeInteractiveStream(target, input);
  }

  public async releaseClientSessionStreams(
    target: GatewayForwardingTarget,
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    this.assertLocalTarget(target);
    return this.gatewayForwardingServer.releaseClientSessionStreams(target, input);
  }

  private assertLocalTarget(target: GatewayForwardingTarget): void {
    if (target.targetNodeId !== this.localNodeId) {
      throw new Error(
        `Local forwarding client can only target node '${this.localNodeId}', received '${target.targetNodeId}'.`,
      );
    }
  }
}
