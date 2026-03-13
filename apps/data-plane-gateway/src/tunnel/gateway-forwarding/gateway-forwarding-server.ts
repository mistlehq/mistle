import type { GatewayForwardingServerAdapter } from "./gateway-forwarding-server-adapter.js";
import type {
  CloseInteractiveStreamInput,
  FindInteractiveStreamByClientInput,
  FindInteractiveStreamByTunnelInput,
  GatewayForwardingTarget,
  InteractiveStreamRoute,
  OpenInteractiveStreamInput,
  ReleaseClientSessionStreamsInput,
  ReleaseClientSessionStreamsResult,
} from "./types.js";

/**
 * Handles interactive stream operations on the gateway node that owns the sandbox.
 */
export class GatewayForwardingServer {
  public constructor(private readonly adapter: GatewayForwardingServerAdapter) {}

  public openInteractiveStream(
    target: GatewayForwardingTarget,
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute> {
    return this.adapter.openInteractiveStream(target, input);
  }

  public findInteractiveStreamByClient(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    return this.adapter.findInteractiveStreamByClient(target, input);
  }

  public findInteractiveStreamByTunnel(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    return this.adapter.findInteractiveStreamByTunnel(target, input);
  }

  public closeInteractiveStream(
    target: GatewayForwardingTarget,
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    return this.adapter.closeInteractiveStream(target, input);
  }

  public releaseClientSessionStreams(
    target: GatewayForwardingTarget,
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    return this.adapter.releaseClientSessionStreams(target, input);
  }
}
