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
 * Owner-node adapter for interactive stream operations.
 */
export interface GatewayForwardingServerAdapter {
  openInteractiveStream(
    target: GatewayForwardingTarget,
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute>;
  findInteractiveStreamByClient(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined>;
  findInteractiveStreamByTunnel(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined>;
  closeInteractiveStream(
    target: GatewayForwardingTarget,
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined>;
  releaseClientSessionStreams(
    target: GatewayForwardingTarget,
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult>;
}
