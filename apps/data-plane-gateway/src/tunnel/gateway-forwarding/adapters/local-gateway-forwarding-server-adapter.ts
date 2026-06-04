import { BootstrapTunnelNotConnectedError } from "../../bootstrap-tunnel-not-connected-error.js";
import { TunnelSessionRegistry } from "../../tunnel-session/index.js";
import type { GatewayForwardingServerAdapter } from "../gateway-forwarding-server-adapter.js";
import type {
  AuthorizePortAccessTargetInput,
  AuthorizePortAccessTargetResult,
  CloseInteractiveStreamInput,
  FindInteractiveStreamByClientInput,
  FindInteractiveStreamByTunnelInput,
  GatewayForwardingTarget,
  InteractiveStreamRoute,
  OpenInteractiveStreamInput,
  OpenPortAccessStreamInput,
  OpenPortAccessStreamResult,
  ReleasePortAccessStreamInput,
  ReleaseClientSessionStreamsInput,
  ReleaseClientSessionStreamsResult,
} from "../types.js";

/**
 * Owner-local forwarding server adapter backed by the tunnel session registry.
 */
export class LocalGatewayForwardingServerAdapter implements GatewayForwardingServerAdapter {
  public constructor(
    private readonly tunnelSessionRegistry: TunnelSessionRegistry,
    private readonly authorizePortAccessTargetHandler?: (
      target: GatewayForwardingTarget,
      input: AuthorizePortAccessTargetInput,
    ) => Promise<AuthorizePortAccessTargetResult>,
    private readonly portAccessStreamHandler?: {
      open: (
        target: GatewayForwardingTarget,
        input: OpenPortAccessStreamInput,
      ) => Promise<OpenPortAccessStreamResult>;
      release: (
        target: GatewayForwardingTarget,
        input: ReleasePortAccessStreamInput,
      ) => Promise<void>;
    },
  ) {}

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
  ): Promise<InteractiveStreamRoute | undefined> {
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
      binding,
    };
  }

  public async releaseClientSessionStreams(
    target: GatewayForwardingTarget,
    input: ReleaseClientSessionStreamsInput,
  ): Promise<ReleaseClientSessionStreamsResult> {
    const bootstrapTarget = this.getMatchingBootstrapTarget(target, input.sandboxInstanceId);
    if (bootstrapTarget === undefined) {
      return {
        bootstrapTarget: undefined,
        releasedBindings: [],
      };
    }

    return {
      bootstrapTarget,
      releasedBindings: this.tunnelSessionRegistry.releaseClientSessionBindings(input),
    };
  }

  public async authorizePortAccessTarget(
    target: GatewayForwardingTarget,
    input: AuthorizePortAccessTargetInput,
  ): Promise<AuthorizePortAccessTargetResult> {
    if (this.authorizePortAccessTargetHandler === undefined) {
      throw new Error("Port Access target authorization handler is not configured.");
    }

    this.requireBootstrapTarget(target, input.sandboxInstanceId);
    return this.authorizePortAccessTargetHandler(target, input);
  }

  public async openPortAccessStream(
    target: GatewayForwardingTarget,
    input: OpenPortAccessStreamInput,
  ): Promise<OpenPortAccessStreamResult> {
    if (this.portAccessStreamHandler === undefined) {
      throw new Error("Port Access stream forwarding handler is not configured.");
    }

    this.requireBootstrapTarget(target, input.sandboxInstanceId);
    return this.portAccessStreamHandler.open(target, input);
  }

  public async releasePortAccessStream(
    target: GatewayForwardingTarget,
    input: ReleasePortAccessStreamInput,
  ): Promise<void> {
    if (this.portAccessStreamHandler === undefined) {
      throw new Error("Port Access stream forwarding handler is not configured.");
    }

    await this.portAccessStreamHandler.release(target, input);
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
    if (!this.tunnelSessionRegistry.isBootstrapSessionAvailable(bootstrapTarget)) {
      throw new BootstrapTunnelNotConnectedError(sandboxInstanceId);
    }

    return bootstrapTarget;
  }
}
