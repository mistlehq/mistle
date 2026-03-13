import type { StreamChannel } from "@mistle/sandbox-session-protocol";

import type { RelayTarget } from "../types.js";
import type { ClientStreamBinding } from "./sandbox-tunnel-session.js";
import type {
  AttachBootstrapSessionResult,
  DetachBootstrapSessionResult,
  TunnelSessionRegistryAdapter,
} from "./tunnel-session-registry-adapter.js";

/**
 * Coordinates owner-local tunnel session state for the current gateway node.
 *
 * This wrapper exists so callers depend on stable registry operations instead of the
 * underlying live session implementation. That keeps the owner-local session model
 * compatible with gateway-to-gateway forwarding.
 */
export class TunnelSessionRegistry {
  public constructor(private readonly adapter: TunnelSessionRegistryAdapter) {}

  /**
   * Registers the live bootstrap tunnel for a sandbox on this node.
   */
  public attachBootstrapSession(input: RelayTarget): AttachBootstrapSessionResult {
    return this.adapter.attachBootstrapSession(input);
  }

  /**
   * Returns the currently attached bootstrap target for a sandbox on this node.
   */
  public getBootstrapTarget(input: { sandboxInstanceId: string }): RelayTarget | undefined {
    return this.adapter.getBootstrapTarget(input);
  }

  /**
   * Removes the bootstrap tunnel only if the supplied target still matches the live one.
   */
  public detachBootstrapSession(input: RelayTarget): DetachBootstrapSessionResult | undefined {
    return this.adapter.detachBootstrapSession(input);
  }

  /**
   * Allocates a tunnel stream binding for a client stream against the local bootstrap tunnel.
   */
  public bindClientStream(input: {
    sandboxInstanceId: string;
    channelKind: StreamChannel["kind"];
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding {
    return this.adapter.bindClientStream(input);
  }

  /**
   * Looks up a tunnel stream binding by the client-visible stream identity.
   */
  public getBindingByClientStream(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined {
    return this.adapter.getBindingByClientStream(input);
  }

  /**
   * Looks up a tunnel stream binding by the owner-local tunnel stream id.
   */
  public getBindingByTunnelStreamId(input: {
    sandboxInstanceId: string;
    tunnelStreamId: number;
  }): ClientStreamBinding | undefined {
    return this.adapter.getBindingByTunnelStreamId(input);
  }

  /**
   * Removes a client-to-tunnel stream binding if it is still registered.
   */
  public unbindClientStream(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined {
    return this.adapter.unbindClientStream(input);
  }

  /**
   * Removes every stream binding associated with a single client websocket session.
   */
  public releaseClientSessionBindings(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
  }): ClientStreamBinding[] {
    return this.adapter.releaseClientSessionBindings(input);
  }
}
