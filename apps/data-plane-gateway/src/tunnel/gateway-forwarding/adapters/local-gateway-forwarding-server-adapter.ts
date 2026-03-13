import { TunnelSessionRegistry } from "../../tunnel-session/index.js";
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

/**
 * Owner-local forwarding server adapter backed by the tunnel session registry.
 */
export class LocalGatewayForwardingServerAdapter implements GatewayForwardingServerAdapter {
  public constructor(private readonly tunnelSessionRegistry: TunnelSessionRegistry) {}

  public async openInteractiveStream(
    _target: GatewayForwardingTarget,
    input: OpenInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute> {
    const bootstrapTarget = this.requireBootstrapTarget(input.sandboxInstanceId);
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
    _target: GatewayForwardingTarget,
    input: FindInteractiveStreamByClientInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
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
    _target: GatewayForwardingTarget,
    input: FindInteractiveStreamByTunnelInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
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
    _target: GatewayForwardingTarget,
    input: CloseInteractiveStreamInput,
  ): Promise<InteractiveStreamRoute | undefined> {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      return undefined;
    }

    const binding = this.tunnelSessionRegistry.unbindClientStream(input);
    if (binding === undefined) {
      return undefined;
    }

    return {
      bootstrapTarget,
      binding,
    };
  }

  public async releaseClientSessionStreams(
    _target: GatewayForwardingTarget,
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    return {
      bootstrapTarget: this.tunnelSessionRegistry.getBootstrapTarget({
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      releasedBindings: this.tunnelSessionRegistry.releaseClientSessionBindings(input),
    };
  }

  private requireBootstrapTarget(sandboxInstanceId: string) {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({
      sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      throw new Error(
        `Bootstrap tunnel session is not registered for sandbox '${sandboxInstanceId}'.`,
      );
    }

    return bootstrapTarget;
  }
}
