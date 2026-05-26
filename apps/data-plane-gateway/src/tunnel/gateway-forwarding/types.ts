import type {
  PortAccessTarget,
  PortsTargetAuthorizeResult,
  StreamChannel,
} from "@mistle/sandbox-session-protocol";

import type { ClientStreamBinding } from "../tunnel-session/index.js";
import type { RelayTarget } from "../types.js";

export type OpenInteractiveStreamInput = {
  sandboxInstanceId: string;
  clientSessionId: string;
  clientStreamId: number;
  channelKind: StreamChannel["kind"];
};

export type FindInteractiveStreamByClientInput = {
  sandboxInstanceId: string;
  clientSessionId: string;
  clientStreamId: number;
};

export type FindInteractiveStreamByTunnelInput = {
  sandboxInstanceId: string;
  tunnelStreamId: number;
};

export type CloseInteractiveStreamInput = {
  sandboxInstanceId: string;
  clientSessionId: string;
  clientStreamId: number;
};

export type ReleaseClientSessionStreamsInput = {
  sandboxInstanceId: string;
  clientSessionId: string;
};

export type AuthorizePortAccessTargetInput = {
  sandboxInstanceId: string;
  target: PortAccessTarget;
};

export type OpenPortAccessStreamInput = {
  sandboxInstanceId: string;
  sourceConnectionSessionId: string;
};

export type OpenPortAccessStreamResult = {
  bootstrapTarget: RelayTarget;
  streamId: number;
};

export type ReleasePortAccessStreamInput = {
  sandboxInstanceId: string;
  streamId: number;
};

export type GatewayForwardingTarget = {
  sourceNodeId: string;
  targetNodeId: string;
  targetBootstrapSessionId: string;
};

export type InteractiveStreamRoute = {
  bootstrapTarget: RelayTarget;
  binding: ClientStreamBinding;
};

export type ReleaseClientSessionStreamsResult = {
  bootstrapTarget: RelayTarget | undefined;
  releasedBindings: ClientStreamBinding[];
};

export type AuthorizePortAccessTargetResult = PortsTargetAuthorizeResult;

export type GatewayForwardingPortAccessAuthorizationErrorCode =
  | "bootstrap_disconnected"
  | "bootstrap_not_connected"
  | "target_authorize_timed_out";

export const GatewayForwardingPortAccessAuthorizationErrorCodes: {
  readonly BOOTSTRAP_DISCONNECTED: "bootstrap_disconnected";
  readonly BOOTSTRAP_NOT_CONNECTED: "bootstrap_not_connected";
  readonly TARGET_AUTHORIZE_TIMED_OUT: "target_authorize_timed_out";
} = {
  BOOTSTRAP_DISCONNECTED: "bootstrap_disconnected",
  BOOTSTRAP_NOT_CONNECTED: "bootstrap_not_connected",
  TARGET_AUTHORIZE_TIMED_OUT: "target_authorize_timed_out",
};

export class GatewayForwardingPortAccessAuthorizationError extends Error {
  public constructor(
    public readonly code: GatewayForwardingPortAccessAuthorizationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
