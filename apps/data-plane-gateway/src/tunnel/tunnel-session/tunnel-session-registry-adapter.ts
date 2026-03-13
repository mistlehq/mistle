import type { StreamChannel } from "@mistle/sandbox-session-protocol";

import type { RelayTarget } from "../types.js";
import type { ClientStreamBinding } from "./sandbox-tunnel-session.js";

/**
 * Describes the observable effects of attaching a bootstrap session for a sandbox.
 *
 * Tunnel sessions are owner-node local. Replacing a bootstrap session also invalidates
 * any client-to-tunnel bindings that were associated with the previous live tunnel.
 */
export type AttachBootstrapSessionResult = {
  replacedBootstrapTarget: RelayTarget | undefined;
  releasedBindings: ClientStreamBinding[];
};

/**
 * Describes the observable effects of detaching a bootstrap session for a sandbox.
 */
export type DetachBootstrapSessionResult = {
  bootstrapTarget: RelayTarget;
  releasedBindings: ClientStreamBinding[];
};

/**
 * Stores owner-local tunnel session state for the current gateway node.
 *
 * Implementations intentionally operate on stable identifiers and bindings instead of
 * exposing the live session object, so owner-forwarding can treat the registry as a
 * node-local service behind a consistent boundary.
 */
export interface TunnelSessionRegistryAdapter {
  attachBootstrapSession(input: RelayTarget): AttachBootstrapSessionResult;
  getBootstrapTarget(input: { sandboxInstanceId: string }): RelayTarget | undefined;
  detachBootstrapSession(input: RelayTarget): DetachBootstrapSessionResult | undefined;
  bindClientStream(input: {
    sandboxInstanceId: string;
    channelKind: StreamChannel["kind"];
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding;
  getBindingByClientStream(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined;
  getBindingByTunnelStreamId(input: {
    sandboxInstanceId: string;
    tunnelStreamId: number;
  }): ClientStreamBinding | undefined;
  unbindClientStream(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined;
  releaseClientSessionBindings(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
  }): ClientStreamBinding[];
}
