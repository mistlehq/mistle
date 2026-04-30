import { BootstrapTunnelNotConnectedError } from "../../bootstrap-tunnel-not-connected-error.js";
import { TunnelSessionRegistry } from "../../tunnel-session/index.js";
import type { GatewayForwardingServerAdapter } from "../gateway-forwarding-server-adapter.js";
import type {
  CloseInteractiveStreamInput,
  ClosedInteractiveStreamRoute,
  FindInteractiveStreamByClientInput,
  FindInteractiveStreamByTunnelInput,
  GatewayForwardingTarget,
  InteractiveStreamRoute,
  OpenInteractiveStreamInput,
  ReleaseClientSessionStreamsInput,
  ReleaseClientSessionStreamsResult,
} from "../types.js";

/**
 * Owner-local forwarding server adapter backed by the tunnel session registry.
 */
export class LocalGatewayForwardingServerAdapter implements GatewayForwardingServerAdapter {
  public constructor(private readonly tunnelSessionRegistry: TunnelSessionRegistry) {}

  public async openInteractiveStream(
    target: GatewayForwardingTarget,
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute> {
    const bootstrapTarget = this.requireBootstrapTarget(target, input.sandboxInstanceId);
    const binding = this.tunnelSessionRegistry.bindClientStream({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: input.clientSessionId,
      clientStreamId: input.clientStreamId,
      channelKind: input.channelKind,
    });

    return {
      bootstrapTarget,
      binding,
    };
  }

  public async findInteractiveStreamByClient(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const bootstrapTarget = this.getMatchingBootstrapTarget(target, input.sandboxInstanceId);
    if (bootstrapTarget === undefined) {
      return undefined;
    }

    const binding = this.tunnelSessionRegistry.getBindingByClientStream(input);
    if (binding === undefined) {
      return undefined;
    }

    return {
      bootstrapTarget,
      binding,
    };
  }

  public async findInteractiveStreamByTunnel(
    target: GatewayForwardingTarget,
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const bootstrapTarget = this.getMatchingBootstrapTarget(target, input.sandboxInstanceId);
    if (bootstrapTarget === undefined) {
      return undefined;
    }

    const binding = this.tunnelSessionRegistry.getBindingByTunnelStreamId(input);
    if (binding === undefined) {
      return undefined;
    }

    return {
      bootstrapTarget,
      binding,
    };
  }

  public async closeInteractiveStream(
    target: GatewayForwardingTarget,
    input: CloseInteractiveStreamInput,
  ): Promise<ClosedInteractiveStreamRoute | undefined> {
    const bootstrapTarget = this.getMatchingBootstrapTarget(target, input.sandboxInstanceId);
    if (bootstrapTarget === undefined) {
      return undefined;
    }

    const binding = this.tunnelSessionRegistry.unbindClientStream(input);
    if (binding === undefined) {
      return undefined;
    }

    return {
      bootstrapTarget,
      activePtyBindingCount: this.tunnelSessionRegistry.getBindingCountByChannelKind({
        sandboxInstanceId: input.sandboxInstanceId,
        channelKind: "pty",
      }),
      binding,
      ownerLeaseId: target.ownerLeaseId,
    };
  }

  public async releaseClientSessionStreams(
    target: GatewayForwardingTarget,
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    const bootstrapTarget = this.getMatchingBootstrapTarget(target, input.sandboxInstanceId);
    if (bootstrapTarget === undefined) {
      return {
        activePtyBindingCount: 0,
        bootstrapTarget: undefined,
        ownerLeaseId: undefined,
        releasedBindings: [],
      };
    }

    const releasedBindings = this.tunnelSessionRegistry.releaseClientSessionBindings(input);

    return {
      activePtyBindingCount: this.tunnelSessionRegistry.getBindingCountByChannelKind({
        sandboxInstanceId: input.sandboxInstanceId,
        channelKind: "pty",
      }),
      bootstrapTarget,
      ownerLeaseId: target.ownerLeaseId,
      releasedBindings,
    };
  }

  private getMatchingBootstrapTarget(target: GatewayForwardingTarget, sandboxInstanceId: string) {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({ sandboxInstanceId });
    if (bootstrapTarget === undefined) {
      return undefined;
    }
    if (bootstrapTarget.sessionId !== target.targetBootstrapSessionId) {
      return undefined;
    }

    return bootstrapTarget;
  }

  private requireBootstrapTarget(target: GatewayForwardingTarget, sandboxInstanceId: string) {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({ sandboxInstanceId });
    if (bootstrapTarget === undefined) {
      throw new BootstrapTunnelNotConnectedError(sandboxInstanceId);
    }
    if (bootstrapTarget.sessionId !== target.targetBootstrapSessionId) {
      throw new Error(
        `Resolved bootstrap session is no longer current for sandbox '${sandboxInstanceId}'.`,
      );
    }

    return bootstrapTarget;
  }
}
