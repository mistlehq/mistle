import { BootstrapTunnelNotConnectedError } from "../bootstrap-tunnel-not-connected-error.js";
import type { SandboxOwnerResolver } from "../ownership/sandbox-owner-resolver.js";
import type { GatewayForwardingClientAdapter } from "./gateway-forwarding-client-adapter.js";
import type {
  CloseInteractiveStreamInput,
  FindInteractiveStreamByClientInput,
  FindInteractiveStreamByTunnelInput,
  InteractiveStreamRoute,
  OpenInteractiveStreamInput,
  ReleaseClientSessionStreamsInput,
  ReleaseClientSessionStreamsResult,
} from "./types.js";

/**
 * Resolves the sandbox owner and forwards interactive stream operations to that node.
 */
export class InteractiveStreamRouter {
  public constructor(
    private readonly sourceNodeId: string,
    private readonly sandboxOwnerResolver: SandboxOwnerResolver,
    private readonly gatewayForwardingClient: GatewayForwardingClientAdapter,
  ) {}

  public async openInteractiveStream(
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute> {
    const target = await this.resolveForwardingTarget(input.sandboxInstanceId);
    return this.gatewayForwardingClient.openInteractiveStream(target, input);
  }

  public async findInteractiveStreamByClient(
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const target = await this.resolveForwardingTarget(input.sandboxInstanceId);
    return this.gatewayForwardingClient.findInteractiveStreamByClient(target, input);
  }

  public async findInteractiveStreamByTunnel(
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const target = await this.resolveForwardingTarget(input.sandboxInstanceId);
    return this.gatewayForwardingClient.findInteractiveStreamByTunnel(target, input);
  }

  public async closeInteractiveStream(
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const target = await this.resolveForwardingTarget(input.sandboxInstanceId);
    return this.gatewayForwardingClient.closeInteractiveStream(target, input);
  }

  public async releaseClientSessionStreams(
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    const ownerResolution = await this.sandboxOwnerResolver.resolveOwner({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (ownerResolution.kind === "missing") {
      return {
        bootstrapTarget: undefined,
        releasedBindings: [],
      };
    }

    return this.gatewayForwardingClient.releaseClientSessionStreams(
      {
        sourceNodeId: this.sourceNodeId,
        targetNodeId: ownerResolution.owner.nodeId,
        targetBootstrapSessionId: ownerResolution.owner.sessionId,
      },
      input,
    );
  }

  private async resolveForwardingTarget(sandboxInstanceId: string) {
    const ownerResolution = await this.sandboxOwnerResolver.resolveOwner({
      sandboxInstanceId,
    });
    if (ownerResolution.kind === "missing") {
      throw new BootstrapTunnelNotConnectedError(sandboxInstanceId);
    }

    return {
      sourceNodeId: this.sourceNodeId,
      targetNodeId: ownerResolution.owner.nodeId,
      targetBootstrapSessionId: ownerResolution.owner.sessionId,
    };
  }
}
