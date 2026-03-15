import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { WSContext, WSMessageReceive } from "hono/ws";

import { ExecutionLeaseRepository } from "./execution-lease-repository.js";
import { SandboxExecutionLeaseNotFoundError } from "./execution-lease-store.js";
import type { InteractiveStreamRouter } from "./gateway-forwarding/index.js";
import {
  TunnelProtocolTranslator,
  TunnelProtocolViolationError,
} from "./protocol/tunnel-protocol-translator.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { notifyBootstrapPeerOfReleasedInteractiveStreams } from "./tunnel-peer-notifier.js";
import type { RelayPeerSide } from "./types.js";

export { TunnelProtocolViolationError } from "./protocol/tunnel-protocol-translator.js";

/**
 * Normalizes websocket message payloads to the tunnel relay payload types.
 */
export function toTunnelForwardPayload(data: WSMessageReceive): string | ArrayBuffer | undefined {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return data;
  }

  return undefined;
}

/**
 * Applies tunnel protocol translation, delivers the translated payload, and
 * runs any resulting stream-release side effects for a single websocket
 * message.
 */
export async function handleTunnelWebSocketMessage(input: {
  clientSessionId: string;
  currentSocket: Pick<WSContext, "send">;
  db: DataPlaneDatabase;
  executionLeaseRepository: ExecutionLeaseRepository;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string | ArrayBuffer;
  relayCoordinator: TunnelRelayCoordinator;
  sandboxInstanceId: string;
  sourcePeerSide: RelayPeerSide;
  tunnelProtocolTranslator: TunnelProtocolTranslator;
}): Promise<void> {
  const translation = await input.tunnelProtocolTranslator.translateInboundMessage({
    clientSessionId: input.clientSessionId,
    payload: input.payload,
    sandboxInstanceId: input.sandboxInstanceId,
    sourcePeerSide: input.sourcePeerSide,
  });

  if (translation.executionLeaseControlMessage !== undefined) {
    try {
      await input.executionLeaseRepository.applyControlMessage({
        db: input.db,
        message: translation.executionLeaseControlMessage,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    } catch (error) {
      if (error instanceof SandboxExecutionLeaseNotFoundError) {
        throw new TunnelProtocolViolationError(error.message);
      }

      throw error;
    }
  }

  if (translation.delivery.kind === "drop") {
    return;
  }

  if (translation.delivery.kind === "respond") {
    input.currentSocket.send(translation.delivery.payload);
  } else {
    await input.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      fromSide: input.sourcePeerSide,
      payload: translation.delivery.payload,
      targetSessionId: translation.delivery.targetConnectionSessionId,
    });
  }

  if (translation.releaseInteractiveStream !== undefined) {
    await input.interactiveStreamRouter.closeInteractiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: translation.releaseInteractiveStream.clientSessionId,
      clientStreamId: translation.releaseInteractiveStream.clientStreamId,
    });
  }
  if (translation.notifyBootstrapPeerOfReleasedStream !== undefined) {
    await notifyBootstrapPeerOfReleasedInteractiveStreams({
      relayCoordinator: input.relayCoordinator,
      releasedBindings: [translation.notifyBootstrapPeerOfReleasedStream],
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }
}
