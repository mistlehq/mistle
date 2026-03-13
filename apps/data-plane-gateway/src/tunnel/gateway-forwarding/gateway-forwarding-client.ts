import type { GatewayForwardingClientAdapter } from "./gateway-forwarding-client-adapter.js";
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
 * Forwards interactive stream operations to the gateway node that owns a sandbox.
 */
export class GatewayForwardingClient {
  public constructor(private readonly adapter: GatewayForwardingClientAdapter) {}

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
