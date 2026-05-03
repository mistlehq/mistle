import type { WSContext, WSMessageReceive } from "hono/ws";

import type { InteractiveStreamRouter } from "./gateway-forwarding/index.js";
import {
  TunnelProtocolTranslator,
  TunnelProtocolViolationError,
  type TunnelProtocolDelivery,
} from "./protocol/tunnel-protocol-translator.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { SandboxKeepaliveRepository } from "./sandbox-keepalive-repository.js";
import { SandboxRuntimeReadinessRepository } from "./sandbox-runtime-readiness-repository.js";
import { notifyBootstrapPeerOfReleasedInteractiveStreams } from "./tunnel-peer-notifier.js";
import type { RelayPeerSide } from "./types.js";

export { TunnelProtocolViolationError } from "./protocol/tunnel-protocol-translator.js";

export type TelemetryDelivery = Extract<
  TunnelProtocolDelivery,
  {
    kind: "telemetryOpen" | "telemetryClose" | "telemetryData" | "telemetryInvalidData";
  }
>;

export type SigningDelivery = Extract<
  TunnelProtocolDelivery,
  {
    kind: "signingRequest";
  }
>;

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
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer;
  }

  return undefined;
}

/**
 * Applies tunnel protocol translation, delivers the translated payload, and
 * runs any resulting stream-release side effects for a single websocket
 * message.
 */
export async function handleTunnelWebSocketMessage(input: {
  bootstrapOwnerLeaseId?: string;
  clientSessionId: string;
  currentSocket: Pick<WSContext, "send">;
  handleSigningDelivery?: ((delivery: SigningDelivery) => Promise<void>) | undefined;
  sandboxKeepaliveRepository: SandboxKeepaliveRepository;
  sandboxRuntimeReadinessRepository: SandboxRuntimeReadinessRepository;
  handleTelemetryDelivery?: ((delivery: TelemetryDelivery) => Promise<void>) | undefined;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string | ArrayBuffer;
  relayCoordinator: TunnelRelayCoordinator;
  sandboxInstanceId: string;
  sourcePeerSide: RelayPeerSide;
  testEnvironmentId?: string;
  tunnelProtocolTranslator: TunnelProtocolTranslator;
}): Promise<void> {
  const translation = await input.tunnelProtocolTranslator.translateInboundMessage({
    clientSessionId: input.clientSessionId,
    payload: input.payload,
    sandboxInstanceId: input.sandboxInstanceId,
    sourcePeerSide: input.sourcePeerSide,
  });

  if (translation.keepaliveControlMessage !== undefined) {
    if (input.bootstrapOwnerLeaseId === undefined) {
      throw new Error(
        "Bootstrap owner lease id is required when applying keepalive control messages.",
      );
    }

    await input.sandboxKeepaliveRepository.applyControlMessage({
      message: translation.keepaliveControlMessage,
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.bootstrapOwnerLeaseId,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
  }

  if (translation.runtimeReadyControlMessage !== undefined) {
    if (input.bootstrapOwnerLeaseId === undefined) {
      throw new Error(
        "Bootstrap owner lease id is required when applying runtime readiness control messages.",
      );
    }

    await input.sandboxRuntimeReadinessRepository.applyControlMessage({
      message: translation.runtimeReadyControlMessage,
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.bootstrapOwnerLeaseId,
    });
  }

  if (translation.delivery.kind === "drop") {
    return;
  }

  if (
    translation.delivery.kind === "telemetryOpen" ||
    translation.delivery.kind === "telemetryClose" ||
    translation.delivery.kind === "telemetryData" ||
    translation.delivery.kind === "telemetryInvalidData"
  ) {
    if (input.handleTelemetryDelivery === undefined) {
      throw new Error("Telemetry delivery requires a telemetry handler.");
    }

    await input.handleTelemetryDelivery(translation.delivery);
  } else if (translation.delivery.kind === "signingRequest") {
    if (input.handleSigningDelivery === undefined) {
      throw new Error("Signing delivery requires a signing handler.");
    }

    await input.handleSigningDelivery(translation.delivery);
  } else if (translation.delivery.kind === "respond") {
    input.currentSocket.send(translation.delivery.payload);
  } else {
    await input.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      fromSide: input.sourcePeerSide,
      payload: translation.delivery.payload,
      targetSessionId:
        input.sourcePeerSide === "connection"
          ? translation.delivery.targetBootstrapSessionId
          : translation.delivery.targetConnectionSessionId,
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
      releasedBindings: [translation.notifyBootstrapPeerOfReleasedStream.binding],
      sandboxInstanceId: input.sandboxInstanceId,
      targetBootstrapSessionId:
        translation.notifyBootstrapPeerOfReleasedStream.targetBootstrapSessionId,
    });
  }
}
