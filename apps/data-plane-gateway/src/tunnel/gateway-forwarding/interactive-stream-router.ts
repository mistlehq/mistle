import type { SandboxOwnerResolver } from "../ownership/sandbox-owner-resolver.js";
import { GatewayForwardingClient } from "./gateway-forwarding-client.js";
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
    private readonly gatewayForwardingClient: GatewayForwardingClient,
  ) {}

  public async openInteractiveStream(
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute> {
    const targetNodeId = await this.resolveTargetNodeId(input.sandboxInstanceId);
    return this.gatewayForwardingClient.openInteractiveStream(
      {
        sourceNodeId: this.sourceNodeId,
        targetNodeId,
      },
      input,
    );
  }

  public async findInteractiveStreamByClient(
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const targetNodeId = await this.resolveTargetNodeId(input.sandboxInstanceId);
    return this.gatewayForwardingClient.findInteractiveStreamByClient(
      {
        sourceNodeId: this.sourceNodeId,
        targetNodeId,
      },
      input,
    );
  }

  public async findInteractiveStreamByTunnel(
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const targetNodeId = await this.resolveTargetNodeId(input.sandboxInstanceId);
    return this.gatewayForwardingClient.findInteractiveStreamByTunnel(
      {
        sourceNodeId: this.sourceNodeId,
        targetNodeId,
      },
      input,
    );
  }

  public async closeInteractiveStream(
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const targetNodeId = await this.resolveTargetNodeId(input.sandboxInstanceId);
    return this.gatewayForwardingClient.closeInteractiveStream(
      {
        sourceNodeId: this.sourceNodeId,
        targetNodeId,
      },
      input,
    );
  }

  public async releaseClientSessionStreams(
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    const targetNodeId = await this.resolveTargetNodeId(input.sandboxInstanceId);
    return this.gatewayForwardingClient.releaseClientSessionStreams(
      {
        sourceNodeId: this.sourceNodeId,
        targetNodeId,
      },
      input,
    );
  }

  private async resolveTargetNodeId(sandboxInstanceId: string): Promise<string> {
    const ownerResolution = await this.sandboxOwnerResolver.resolveOwner({
      sandboxInstanceId,
    });
    if (ownerResolution.kind === "missing") {
      throw new Error(`Sandbox '${sandboxInstanceId}' does not have an active owner.`);
    }

    return ownerResolution.owner.nodeId;
  }
}
