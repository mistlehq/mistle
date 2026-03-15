import {
  createBootstrapDisconnectedStreamResetPayload,
  createReleasedInteractiveStreamResetPayload,
  createStreamClosePayload,
} from "./protocol/tunnel-protocol-translator.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import type { ClientStreamBinding } from "./tunnel-session/index.js";

export async function notifyConnectionPeerOfReleasedInteractiveStreams(input: {
  relayCoordinator: TunnelRelayCoordinator;
  releasedBindings: ClientStreamBinding[];
  sandboxInstanceId: string;
  toPayload?: (binding: ClientStreamBinding) => string;
}): Promise<void> {
  if (input.releasedBindings.length === 0) {
    return;
  }

  await Promise.all(
    input.releasedBindings.map((binding: ClientStreamBinding) =>
      input.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "bootstrap",
        payload: (input.toPayload ?? createReleasedInteractiveStreamResetPayload)(binding),
        targetSessionId: binding.clientSessionId,
      }),
    ),
  );
}

export async function notifyConnectionPeerOfBootstrapDisconnect(input: {
  relayCoordinator: TunnelRelayCoordinator;
  releasedBindings: ClientStreamBinding[];
  sandboxInstanceId: string;
}): Promise<void> {
  await notifyConnectionPeerOfReleasedInteractiveStreams({
    ...input,
    toPayload: createBootstrapDisconnectedStreamResetPayload,
  });
}

export async function notifyBootstrapPeerOfReleasedInteractiveStreams(input: {
  relayCoordinator: TunnelRelayCoordinator;
  releasedBindings: ClientStreamBinding[];
  sandboxInstanceId: string;
}): Promise<void> {
  if (input.releasedBindings.length === 0) {
    return;
  }

  await Promise.all(
    input.releasedBindings.map((binding: ClientStreamBinding) =>
      input.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload: createStreamClosePayload(binding),
      }),
    ),
  );
}
