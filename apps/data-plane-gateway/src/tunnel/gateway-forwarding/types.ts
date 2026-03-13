import type { StreamChannel } from "@mistle/sandbox-session-protocol";

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

export type GatewayForwardingTarget = {
  sourceNodeId: string;
  targetNodeId: string;
};

export type InteractiveStreamRoute = {
  bootstrapTarget: RelayTarget;
  binding: ClientStreamBinding;
};

export type ReleaseClientSessionStreamsResult = {
  bootstrapTarget: RelayTarget | undefined;
  releasedBindings: ClientStreamBinding[];
};
