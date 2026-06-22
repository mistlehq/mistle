import { logger } from "../logger.js";
import type { GatewayDrainRegistry } from "./gateway-drain-registry.js";
import type { GatewayForwardingReplacementReason } from "./gateway-forwarding-recovery-supervisor.js";
import type { GatewayLifecycle } from "./gateway-lifecycle.js";
import { GatewayWebSocketCloseReasons } from "./gateway-websocket-close.js";

export type GatewayForwardingReplacementHandler = (
  reason: GatewayForwardingReplacementReason,
) => void;

type GatewayForwardingReplacementHandlerInput = {
  closeForServiceRestartWaitMs: number;
  drainRegistry: GatewayDrainRegistry;
  lifecycle: GatewayLifecycle;
  localNodeId: string;
  onUnrecoverableForwarding: (reason: GatewayForwardingReplacementReason) => void;
};

export function createGatewayForwardingReplacementHandler(
  input: GatewayForwardingReplacementHandlerInput,
): GatewayForwardingReplacementHandler {
  let replacementPromise: Promise<void> | undefined;

  return (reason) => {
    if (replacementPromise !== undefined) {
      return;
    }

    replacementPromise = replaceGatewayAfterForwardingFailure(input, reason);
  };
}

async function replaceGatewayAfterForwardingFailure(
  input: GatewayForwardingReplacementHandlerInput,
  reason: GatewayForwardingReplacementReason,
): Promise<void> {
  try {
    input.lifecycle.startDrain({
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });
    const closeResult = await input.drainRegistry.closeForServiceRestart({
      waitMs: input.closeForServiceRestartWaitMs,
    });
    logger.error(
      {
        eventName: "data_plane_gateway.runtime.forwarding_replacement_drain_completed",
        ...closeResult,
        "mistle.gateway.node_id": input.localNodeId,
        "mistle.gateway.forwarding.replacement_reason": reason,
      },
      "Data-plane gateway forwarding replacement drain completed.",
    );
  } catch (error: unknown) {
    logger.error(
      {
        err: error,
        eventName: "data_plane_gateway.runtime.forwarding_replacement_drain_failed",
        "mistle.gateway.node_id": input.localNodeId,
        "mistle.gateway.forwarding.replacement_reason": reason,
      },
      "Data-plane gateway forwarding replacement drain failed.",
    );
  } finally {
    input.onUnrecoverableForwarding(reason);
  }
}
