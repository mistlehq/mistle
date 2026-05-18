import { metrics, type Attributes } from "@opentelemetry/api";

import { logger } from "../logger.js";
import type { RelayEnvelope, RelayPayload, RelayPeerSide } from "./types.js";

type GatewayRelayBackend = "memory" | "nats";
type GatewayRelayEnvelopeDirection = "published" | "received" | "local_delivered" | "dropped";
type GatewayRelayPayloadKind = "text" | "binary" | "none";
type GatewayRelayPeerLookupPeerSide = RelayPeerSide;
type GatewayRelayPeerLookupOutcome =
  | "local_hit"
  | "remote_hit"
  | "active_bootstrap_hit"
  | "miss"
  | "no_responders"
  | "timeout";
type GatewayRelayLifecycleEvent = "started" | "stopped";

const GatewayRelayMeter = metrics.getMeter("@mistle/data-plane-gateway/gateway-relay");
const GatewayRelayEnvelopeEvents = GatewayRelayMeter.createCounter(
  "mistle.gateway.relay.envelope.events",
  {
    description: "Gateway relay envelope events observed by the data-plane gateway.",
  },
);
const GatewayRelayPayloadBytes = GatewayRelayMeter.createHistogram(
  "mistle.gateway.relay.envelope.payload_bytes",
  {
    description: "Gateway relay frame payload sizes observed by the data-plane gateway.",
    unit: "By",
  },
);
const GatewayRelayPeerLookupEvents = GatewayRelayMeter.createCounter(
  "mistle.gateway.relay.peer_lookup.events",
  {
    description: "Gateway relay peer lookup outcomes observed by the data-plane gateway.",
  },
);
const GatewayRelaySubscriptionFailures = GatewayRelayMeter.createCounter(
  "mistle.gateway.relay.subscription.failures",
  {
    description: "Gateway relay subscription task failures observed by the data-plane gateway.",
  },
);

const TextEncoderInstance = new TextEncoder();

export function describeRelayPayload(payload: RelayPayload): {
  payloadBytes: number;
  payloadKind: GatewayRelayPayloadKind;
} {
  if (typeof payload === "string") {
    return {
      payloadBytes: TextEncoderInstance.encode(payload).byteLength,
      payloadKind: "text",
    };
  }

  return {
    payloadBytes: payload.byteLength,
    payloadKind: "binary",
  };
}

export function recordGatewayRelayEnvelopeEvent(input: {
  backend: GatewayRelayBackend;
  direction: GatewayRelayEnvelopeDirection;
  dropReason?: string;
  envelope: RelayEnvelope;
  localNodeId: string;
}): void {
  const payloadDescription: { payloadBytes: number; payloadKind: GatewayRelayPayloadKind } =
    input.envelope.kind === "frame"
      ? describeRelayPayload(input.envelope.payload)
      : {
          payloadBytes: 0,
          payloadKind: "none",
        };
  GatewayRelayEnvelopeEvents.add(1, buildRelayEnvelopeMetricAttributes(input, payloadDescription));
  if (input.envelope.kind === "frame") {
    GatewayRelayPayloadBytes.record(
      payloadDescription.payloadBytes,
      buildRelayEnvelopePayloadMetricAttributes(input, payloadDescription),
    );
  }

  if (input.direction !== "dropped") {
    return;
  }

  logger.debug(
    buildRelayEnvelopeLogData(input, payloadDescription),
    "Gateway relay envelope was dropped before local websocket delivery",
  );
}

export function recordGatewayRelayPeerLookupEvent(input: {
  backend: GatewayRelayBackend;
  localNodeId: string;
  outcome: GatewayRelayPeerLookupOutcome;
  peerSide: GatewayRelayPeerLookupPeerSide;
  sandboxInstanceId: string;
  sessionId?: string;
  targetNodeId?: string;
}): void {
  GatewayRelayPeerLookupEvents.add(1, buildPeerLookupMetricAttributes(input));

  if (
    input.outcome === "local_hit" ||
    input.outcome === "remote_hit" ||
    input.outcome === "active_bootstrap_hit"
  ) {
    return;
  }

  logger.debug(
    {
      eventName: "gateway.relay.peer_lookup.missed",
      "mistle.gateway.node_id": input.localNodeId,
      "mistle.gateway.relay.backend": input.backend,
      "mistle.gateway.relay.lookup_outcome": input.outcome,
      "mistle.sandbox.instance_id": input.sandboxInstanceId,
      "mistle.sandbox.tunnel.peer_side": input.peerSide,
      ...(input.sessionId === undefined
        ? {}
        : {
            "mistle.tunnel.relay_session_id": input.sessionId,
          }),
      ...(input.targetNodeId === undefined
        ? {}
        : {
            "mistle.gateway.relay.target_node_id": input.targetNodeId,
          }),
    },
    "Gateway relay peer lookup did not find a live peer",
  );
}

export function recordGatewayRelayLifecycleEvent(input: {
  backend: GatewayRelayBackend;
  event: GatewayRelayLifecycleEvent;
  localNodeId: string;
}): void {
  logger.info(
    {
      eventName: `gateway.relay.${input.event}`,
      "mistle.gateway.node_id": input.localNodeId,
      "mistle.gateway.relay.backend": input.backend,
    },
    `Gateway relay ${input.event}`,
  );
}

export function recordGatewayRelaySubscriptionFailure(input: {
  backend: GatewayRelayBackend;
  error: unknown;
  localNodeId: string;
  subscriptionKind: string;
}): void {
  GatewayRelaySubscriptionFailures.add(1, {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.relay.subscription_kind": input.subscriptionKind,
  });
  logger.error(
    {
      eventName: "gateway.relay.subscription.failed",
      error: input.error,
      "mistle.gateway.node_id": input.localNodeId,
      "mistle.gateway.relay.backend": input.backend,
      "mistle.gateway.relay.subscription_kind": input.subscriptionKind,
    },
    "Gateway relay subscription task failed",
  );
}

export function buildRelayEnvelopeMetricAttributes(
  input: {
    backend: GatewayRelayBackend;
    direction: GatewayRelayEnvelopeDirection;
    dropReason?: string;
    envelope: RelayEnvelope;
    localNodeId: string;
  },
  payloadDescription: { payloadBytes: number; payloadKind: GatewayRelayPayloadKind },
): Attributes {
  return {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.relay.direction": input.direction,
    "mistle.gateway.relay.envelope_kind": input.envelope.kind,
    "mistle.gateway.relay.payload_kind": payloadDescription.payloadKind,
    "mistle.gateway.relay.peer_side": input.envelope.target.side,
    "mistle.gateway.relay.target_is_local": input.envelope.target.nodeId === input.localNodeId,
    ...(input.dropReason === undefined
      ? {}
      : {
          "mistle.gateway.relay.drop_reason": input.dropReason,
        }),
  };
}

function buildRelayEnvelopePayloadMetricAttributes(
  input: {
    backend: GatewayRelayBackend;
    direction: GatewayRelayEnvelopeDirection;
    dropReason?: string;
    envelope: RelayEnvelope;
    localNodeId: string;
  },
  payloadDescription: { payloadBytes: number; payloadKind: GatewayRelayPayloadKind },
): Attributes {
  return {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.relay.direction": input.direction,
    "mistle.gateway.relay.payload_kind": payloadDescription.payloadKind,
    "mistle.gateway.relay.peer_side": input.envelope.target.side,
    "mistle.gateway.relay.target_is_local": input.envelope.target.nodeId === input.localNodeId,
    ...(input.dropReason === undefined
      ? {}
      : {
          "mistle.gateway.relay.drop_reason": input.dropReason,
        }),
  };
}

export function buildRelayEnvelopeLogData(
  input: {
    backend: GatewayRelayBackend;
    direction: GatewayRelayEnvelopeDirection;
    dropReason?: string;
    envelope: RelayEnvelope;
    localNodeId: string;
  },
  payloadDescription: { payloadBytes: number; payloadKind: GatewayRelayPayloadKind },
): Record<string, unknown> {
  return {
    eventName: "gateway.relay.envelope.dropped",
    "mistle.gateway.node_id": input.localNodeId,
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.relay.direction": input.direction,
    "mistle.gateway.relay.drop_reason": input.dropReason,
    "mistle.gateway.relay.envelope_kind": input.envelope.kind,
    "mistle.gateway.relay.payload_bytes": payloadDescription.payloadBytes,
    "mistle.gateway.relay.payload_kind": payloadDescription.payloadKind,
    "mistle.gateway.relay.target_node_id": input.envelope.target.nodeId,
    "mistle.sandbox.instance_id": input.envelope.target.sandboxInstanceId,
    "mistle.sandbox.tunnel.peer_side": input.envelope.target.side,
    "mistle.tunnel.relay_session_id": input.envelope.target.sessionId,
  };
}

function buildPeerLookupMetricAttributes(input: {
  backend: GatewayRelayBackend;
  outcome: GatewayRelayPeerLookupOutcome;
  peerSide: GatewayRelayPeerLookupPeerSide;
}): Attributes {
  return {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.relay.lookup_outcome": input.outcome,
    "mistle.sandbox.tunnel.peer_side": input.peerSide,
  };
}
