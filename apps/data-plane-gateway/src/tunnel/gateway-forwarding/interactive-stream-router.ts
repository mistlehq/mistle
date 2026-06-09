import { BootstrapTunnelNotConnectedError } from "../bootstrap-tunnel-not-connected-error.js";
import type { SandboxOwnerResolver } from "../ownership/sandbox-owner-resolver.js";
import type { SandboxOwnerResolution } from "../ownership/types.js";
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
import { GatewayForwardingUnavailableError, type GatewayForwardingTarget } from "./types.js";

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
    try {
      return await this.gatewayForwardingClient.openInteractiveStream(target, input);
    } catch (error) {
      const retryTarget = await this.resolveRetryTarget({
        currentTarget: target,
        error,
        sandboxInstanceId: input.sandboxInstanceId,
      });
      if (retryTarget === undefined) {
        throw new BootstrapTunnelNotConnectedError(input.sandboxInstanceId);
      }
      return this.gatewayForwardingClient.openInteractiveStream(retryTarget, input);
    }
  }

  public async findInteractiveStreamByClient(
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const target = await this.resolveForwardingTarget(input.sandboxInstanceId);
    try {
      return await this.gatewayForwardingClient.findInteractiveStreamByClient(target, input);
    } catch (error) {
      const retryTarget = await this.resolveRetryTarget({
        currentTarget: target,
        error,
        sandboxInstanceId: input.sandboxInstanceId,
      });
      if (retryTarget === undefined) {
        return undefined;
      }
      return this.gatewayForwardingClient.findInteractiveStreamByClient(retryTarget, input);
    }
  }

  public async findInteractiveStreamByTunnel(
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const target = await this.resolveForwardingTarget(input.sandboxInstanceId);
    try {
      return await this.gatewayForwardingClient.findInteractiveStreamByTunnel(target, input);
    } catch (error) {
      const retryTarget = await this.resolveRetryTarget({
        currentTarget: target,
        error,
        sandboxInstanceId: input.sandboxInstanceId,
      });
      if (retryTarget === undefined) {
        return undefined;
      }
      return this.gatewayForwardingClient.findInteractiveStreamByTunnel(retryTarget, input);
    }
  }

  public async closeInteractiveStream(
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const target = await this.resolveForwardingTarget(input.sandboxInstanceId);
    try {
      return await this.gatewayForwardingClient.closeInteractiveStream(target, input);
    } catch (error) {
      const retryTarget = await this.resolveRetryTarget({
        currentTarget: target,
        error,
        sandboxInstanceId: input.sandboxInstanceId,
      });
      if (retryTarget === undefined) {
        return undefined;
      }
      return this.gatewayForwardingClient.closeInteractiveStream(retryTarget, input);
    }
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

    const target = {
      sourceNodeId: this.sourceNodeId,
      targetNodeId: ownerResolution.owner.nodeId,
      targetBootstrapSessionId: ownerResolution.owner.sessionId,
    };

    try {
      return await this.gatewayForwardingClient.releaseClientSessionStreams(target, input);
    } catch (error) {
      const retryTarget = await this.resolveRetryTarget({
        currentTarget: target,
        error,
        sandboxInstanceId: input.sandboxInstanceId,
      });
      if (retryTarget === undefined) {
        return {
          bootstrapTarget: undefined,
          releasedBindings: [],
        };
      }
      return this.gatewayForwardingClient.releaseClientSessionStreams(retryTarget, input);
    }
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

  private async resolveRetryTarget(input: {
    currentTarget: GatewayForwardingTarget;
    error: unknown;
    sandboxInstanceId: string;
  }): Promise<GatewayForwardingTarget | undefined> {
    if (!(input.error instanceof GatewayForwardingUnavailableError)) {
      throw input.error;
    }

    const retryOwnerResolution = await this.sandboxOwnerResolver.resolveOwner({
      sandboxInstanceId: input.sandboxInstanceId,
    });

    return resolveGatewayForwardingRetryTarget({
      currentTarget: input.currentTarget,
      error: input.error,
      retryOwnerResolution,
      sourceNodeId: this.sourceNodeId,
    });
  }
}

export function resolveGatewayForwardingRetryTarget(input: {
  currentTarget: GatewayForwardingTarget;
  error: unknown;
  retryOwnerResolution: SandboxOwnerResolution;
  sourceNodeId: string;
}): GatewayForwardingTarget | undefined {
  if (!(input.error instanceof GatewayForwardingUnavailableError)) {
    throw input.error;
  }

  if (input.retryOwnerResolution.kind === "missing") {
    return undefined;
  }

  const retryTarget = {
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.retryOwnerResolution.owner.nodeId,
    targetBootstrapSessionId: input.retryOwnerResolution.owner.sessionId,
  };
  if (sameForwardingTarget(input.currentTarget, retryTarget)) {
    return undefined;
  }

  return retryTarget;
}

function sameForwardingTarget(
  left: GatewayForwardingTarget,
  right: GatewayForwardingTarget,
): boolean {
  return (
    left.sourceNodeId === right.sourceNodeId &&
    left.targetNodeId === right.targetNodeId &&
    left.targetBootstrapSessionId === right.targetBootstrapSessionId
  );
}
