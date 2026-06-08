import { metrics, type Attributes, type Counter, type Histogram } from "@opentelemetry/api";

import { logger } from "../logger.js";
import type { RelayEnvelope, RelayPayload, RelayPeerSide } from "./types.js";

type GatewayRelayBackend = "memory" | "nats";
type GatewayRelayEnvelopeDirection = "published" | "received" | "local_delivered" | "dropped";
type GatewayRelayPayloadKind = "text" | "binary" | "none";
type GatewayRelayPublishOutcome = "succeeded" | "failed";
type GatewayRelayPeerLookupPeerSide = RelayPeerSide;
type GatewayRelayPeerLookupOutcome =
  | "local_hit"
  | "remote_hit"
  | "active_bootstrap_hit"
  | "miss"
  | "no_responders"
  | "timeout";
type GatewayRelayLifecycleEvent = "started" | "stopped";
type GatewayNatsConnectionStatus =
  | "close"
  | "disconnect"
  | "error"
  | "forceReconnect"
  | "ldm"
  | "ping"
  | "reconnect"
  | "reconnecting"
  | "slowConsumer"
  | "staleConnection"
  | "update";
type GatewayForwardingRequestOutcome = "succeeded" | "failed";
type GatewayForwardingSelfCheckOutcome = "succeeded" | "failed";
type GatewayForwardingPortAccessAuthorizationOutcome =
  | "authorized"
  | "rejected"
  | "started"
  | "error";

type GatewayRelayInstruments = {
  envelopeEvents: Counter;
  forwardingPortAccessAuthorizationDuration: Histogram;
  forwardingPortAccessAuthorizationEvents: Counter;
  forwardingRequestDuration: Histogram;
  forwardingRequestEvents: Counter;
  forwardingSelfCheckEvents: Counter;
  payloadBytes: Histogram;
  peerLookupEvents: Counter;
  publishEncodedBytes: Histogram;
  publishEvents: Counter;
  natsConnectionStatusEvents: Counter;
  subscriptionFailures: Counter;
};

let gatewayRelayInstruments: GatewayRelayInstruments | undefined;

function getGatewayRelayInstruments(): GatewayRelayInstruments {
  if (gatewayRelayInstruments !== undefined) {
    return gatewayRelayInstruments;
  }

  const meter = metrics.getMeter("@mistle/data-plane-gateway/gateway-relay");
  gatewayRelayInstruments = {
    envelopeEvents: meter.createCounter("mistle.gateway.relay.envelope.events", {
      description: "Gateway relay envelope events observed by the data-plane gateway.",
    }),
    payloadBytes: meter.createHistogram("mistle.gateway.relay.envelope.payload_bytes", {
      description: "Gateway relay frame payload sizes observed by the data-plane gateway.",
      unit: "By",
    }),
    publishEvents: meter.createCounter("mistle.gateway.relay.publish.events", {
      description: "Gateway relay publish outcomes observed by the data-plane gateway.",
    }),
    publishEncodedBytes: meter.createHistogram("mistle.gateway.relay.publish.encoded_bytes", {
      description: "Encoded gateway relay envelope sizes attempted for publish.",
      unit: "By",
    }),
    peerLookupEvents: meter.createCounter("mistle.gateway.relay.peer_lookup.events", {
      description: "Gateway relay peer lookup outcomes observed by the data-plane gateway.",
    }),
    subscriptionFailures: meter.createCounter("mistle.gateway.relay.subscription.failures", {
      description: "Gateway relay subscription task failures observed by the data-plane gateway.",
    }),
    forwardingPortAccessAuthorizationEvents: meter.createCounter(
      "mistle.gateway.forwarding.port_access_authorization.events",
      {
        description:
          "Gateway forwarding events for distributed Port Access target authorization requests.",
      },
    ),
    forwardingPortAccessAuthorizationDuration: meter.createHistogram(
      "mistle.gateway.forwarding.port_access_authorization.duration_ms",
      {
        description:
          "Duration of distributed Port Access target authorization requests forwarded to another gateway.",
        unit: "ms",
      },
    ),
    forwardingRequestEvents: meter.createCounter("mistle.gateway.forwarding.request.events", {
      description: "Gateway forwarding NATS request outcomes observed by the data-plane gateway.",
    }),
    forwardingRequestDuration: meter.createHistogram(
      "mistle.gateway.forwarding.request.duration_ms",
      {
        description: "Duration of gateway forwarding NATS requests.",
        unit: "ms",
      },
    ),
    forwardingSelfCheckEvents: meter.createCounter("mistle.gateway.forwarding.self_check.events", {
      description: "Gateway forwarding local responder self-check outcomes.",
    }),
    natsConnectionStatusEvents: meter.createCounter("mistle.gateway.relay.nats.status.events", {
      description: "NATS connection status events observed by the data-plane gateway.",
    }),
  };

  return gatewayRelayInstruments;
}

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
  const instruments = getGatewayRelayInstruments();
  instruments.envelopeEvents.add(1, buildRelayEnvelopeMetricAttributes(input, payloadDescription));
  if (input.envelope.kind === "frame") {
    instruments.payloadBytes.record(
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

export function recordGatewayRelayPublishEvent(input: {
  backend: GatewayRelayBackend;
  encodedBytes: number;
  envelope: RelayEnvelope;
  error?: unknown;
  localNodeId: string;
  outcome: GatewayRelayPublishOutcome;
}): void {
  const payloadDescription: { payloadBytes: number; payloadKind: GatewayRelayPayloadKind } =
    input.envelope.kind === "frame"
      ? describeRelayPayload(input.envelope.payload)
      : {
          payloadBytes: 0,
          payloadKind: "none",
        };
  const attributes = buildRelayPublishMetricAttributes(input, payloadDescription);
  const instruments = getGatewayRelayInstruments();
  instruments.publishEvents.add(1, attributes);
  instruments.publishEncodedBytes.record(input.encodedBytes, attributes);

  if (input.outcome === "succeeded") {
    return;
  }

  logger.warn(
    buildRelayPublishLogData(input, payloadDescription),
    "Gateway relay envelope publish failed",
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
  getGatewayRelayInstruments().peerLookupEvents.add(1, buildPeerLookupMetricAttributes(input));

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

export function recordGatewayRelayNatsConnectionStatusEvent(input: {
  error?: unknown;
  localNodeId: string;
  role: "relay" | "forwarding_self_check";
  server?: string;
  status: GatewayNatsConnectionStatus;
}): void {
  getGatewayRelayInstruments().natsConnectionStatusEvents.add(1, {
    "mistle.gateway.relay.backend": "nats",
    "mistle.gateway.relay.nats.connection_role": input.role,
    "mistle.gateway.relay.nats.status": input.status,
  });

  const logData = {
    eventName: "gateway.relay.nats.status",
    error: input.error,
    "mistle.gateway.node_id": input.localNodeId,
    "mistle.gateway.relay.backend": "nats",
    "mistle.gateway.relay.nats.connection_role": input.role,
    "mistle.gateway.relay.nats.status": input.status,
    ...(input.server === undefined
      ? {}
      : {
          "mistle.gateway.relay.nats.server": input.server,
        }),
  };

  if (input.status === "error" || input.status === "staleConnection") {
    logger.warn(logData, "Gateway relay NATS connection status changed");
    return;
  }

  logger.info(logData, "Gateway relay NATS connection status changed");
}

export function recordGatewayRelaySubscriptionFailure(input: {
  backend: GatewayRelayBackend;
  error: unknown;
  localNodeId: string;
  subscriptionKind: string;
}): void {
  getGatewayRelayInstruments().subscriptionFailures.add(1, {
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

export function recordGatewayForwardingPortAccessAuthorizationEvent(input: {
  backend: GatewayRelayBackend;
  durationMs?: number;
  errorCode?: string;
  localNodeId: string;
  outcome: GatewayForwardingPortAccessAuthorizationOutcome;
  port: number;
  rejectionReason?: string;
  sandboxInstanceId: string;
  sourceNodeId: string;
  targetNodeId: string;
}): void {
  const instruments = getGatewayRelayInstruments();
  instruments.forwardingPortAccessAuthorizationEvents.add(
    1,
    buildGatewayForwardingPortAccessAuthorizationMetricAttributes(input),
  );
  if (input.durationMs !== undefined) {
    instruments.forwardingPortAccessAuthorizationDuration.record(
      input.durationMs,
      buildGatewayForwardingPortAccessAuthorizationMetricAttributes(input),
    );
  }

  const logData = buildGatewayForwardingPortAccessAuthorizationLogData(input);
  if (input.outcome === "error") {
    logger.warn(logData, "Gateway forwarding Port Access authorization failed");
    return;
  }
  if (input.outcome === "rejected") {
    logger.info(logData, "Gateway forwarding Port Access authorization was rejected");
    return;
  }
  if (input.outcome === "authorized") {
    logger.info(logData, "Gateway forwarding Port Access authorization completed");
    return;
  }

  logger.debug(logData, "Gateway forwarding Port Access authorization started");
}

export function recordGatewayForwardingRequestEvent(input: {
  backend: GatewayRelayBackend;
  durationMs: number;
  error?: unknown;
  localNodeId: string;
  operation: string;
  outcome: GatewayForwardingRequestOutcome;
  reason?: string;
  sandboxInstanceId: string;
  sourceNodeId: string;
  subject: string;
  targetBootstrapSessionId: string;
  targetNodeId: string;
}): void {
  const instruments = getGatewayRelayInstruments();
  const attributes = buildGatewayForwardingRequestMetricAttributes(input);
  instruments.forwardingRequestEvents.add(1, attributes);
  instruments.forwardingRequestDuration.record(input.durationMs, attributes);

  if (input.outcome === "succeeded") {
    logger.debug(
      buildGatewayForwardingRequestLogData(input),
      "Gateway forwarding request completed",
    );
    return;
  }

  logger.warn(buildGatewayForwardingRequestLogData(input), "Gateway forwarding request failed");
}

export function recordGatewayForwardingSelfCheckEvent(input: {
  backend: GatewayRelayBackend;
  durationMs: number;
  error?: unknown;
  localNodeId: string;
  outcome: GatewayForwardingSelfCheckOutcome;
  reason?: string;
  subject: string;
}): void {
  getGatewayRelayInstruments().forwardingSelfCheckEvents.add(1, {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.forwarding.self_check.outcome": input.outcome,
    ...(input.reason === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.self_check.reason": input.reason,
        }),
  });

  const logData = {
    eventName: "gateway.forwarding.self_check",
    error: input.error,
    "mistle.gateway.node_id": input.localNodeId,
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.forwarding.duration_ms": input.durationMs,
    "mistle.gateway.forwarding.self_check.outcome": input.outcome,
    "mistle.gateway.forwarding.subject": input.subject,
    ...(input.reason === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.self_check.reason": input.reason,
        }),
  };

  if (input.outcome === "succeeded") {
    logger.debug(logData, "Gateway forwarding self-check completed");
    return;
  }

  logger.warn(logData, "Gateway forwarding self-check failed");
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

export function buildGatewayForwardingPortAccessAuthorizationMetricAttributes(input: {
  backend: GatewayRelayBackend;
  errorCode?: string;
  outcome: GatewayForwardingPortAccessAuthorizationOutcome;
  rejectionReason?: string;
}): Attributes {
  return {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.forwarding.operation": "authorize_port_access_target",
    "mistle.gateway.forwarding.outcome": input.outcome,
    ...(input.errorCode === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.error_code": input.errorCode,
        }),
    ...(input.rejectionReason === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.rejection_reason": input.rejectionReason,
        }),
  };
}

export function buildGatewayForwardingRequestMetricAttributes(input: {
  backend: GatewayRelayBackend;
  operation: string;
  outcome: GatewayForwardingRequestOutcome;
  reason?: string;
}): Attributes {
  return {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.forwarding.operation": input.operation,
    "mistle.gateway.forwarding.outcome": input.outcome,
    ...(input.reason === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.reason": input.reason,
        }),
  };
}

export function buildGatewayForwardingRequestLogData(input: {
  backend: GatewayRelayBackend;
  durationMs: number;
  error?: unknown;
  localNodeId: string;
  operation: string;
  outcome: GatewayForwardingRequestOutcome;
  reason?: string;
  sandboxInstanceId: string;
  sourceNodeId: string;
  subject: string;
  targetBootstrapSessionId: string;
  targetNodeId: string;
}): Record<string, unknown> {
  return {
    eventName: "gateway.forwarding.request",
    error: input.error,
    "mistle.gateway.node_id": input.localNodeId,
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.forwarding.duration_ms": input.durationMs,
    "mistle.gateway.forwarding.operation": input.operation,
    "mistle.gateway.forwarding.outcome": input.outcome,
    "mistle.gateway.forwarding.source_node_id": input.sourceNodeId,
    "mistle.gateway.forwarding.subject": input.subject,
    "mistle.gateway.forwarding.target_bootstrap_session_id": input.targetBootstrapSessionId,
    "mistle.gateway.forwarding.target_node_id": input.targetNodeId,
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    ...(input.reason === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.reason": input.reason,
        }),
  };
}

export function buildGatewayForwardingPortAccessAuthorizationLogData(input: {
  backend: GatewayRelayBackend;
  durationMs?: number;
  errorCode?: string;
  localNodeId: string;
  outcome: GatewayForwardingPortAccessAuthorizationOutcome;
  port: number;
  rejectionReason?: string;
  sandboxInstanceId: string;
  sourceNodeId: string;
  targetNodeId: string;
}): Record<string, unknown> {
  return {
    eventName: "gateway.forwarding.port_access_authorization",
    "mistle.gateway.node_id": input.localNodeId,
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.forwarding.operation": "authorize_port_access_target",
    "mistle.gateway.forwarding.outcome": input.outcome,
    "mistle.gateway.forwarding.source_node_id": input.sourceNodeId,
    "mistle.gateway.forwarding.target_node_id": input.targetNodeId,
    "mistle.port_access.target.port": input.port,
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    ...(input.durationMs === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.duration_ms": input.durationMs,
        }),
    ...(input.errorCode === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.error_code": input.errorCode,
        }),
    ...(input.rejectionReason === undefined
      ? {}
      : {
          "mistle.gateway.forwarding.rejection_reason": input.rejectionReason,
        }),
  };
}

export function buildRelayPublishMetricAttributes(
  input: {
    backend: GatewayRelayBackend;
    envelope: RelayEnvelope;
    outcome: GatewayRelayPublishOutcome;
  },
  payloadDescription: { payloadBytes: number; payloadKind: GatewayRelayPayloadKind },
): Attributes {
  return {
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.relay.envelope_kind": input.envelope.kind,
    "mistle.gateway.relay.payload_kind": payloadDescription.payloadKind,
    "mistle.gateway.relay.peer_side": input.envelope.target.side,
    "mistle.gateway.relay.publish_outcome": input.outcome,
  };
}

export function buildRelayPublishLogData(
  input: {
    backend: GatewayRelayBackend;
    encodedBytes: number;
    envelope: RelayEnvelope;
    error?: unknown;
    localNodeId: string;
    outcome: GatewayRelayPublishOutcome;
  },
  payloadDescription: { payloadBytes: number; payloadKind: GatewayRelayPayloadKind },
): Record<string, unknown> {
  return {
    eventName: "gateway.relay.publish.failed",
    error: input.error,
    "mistle.gateway.node_id": input.localNodeId,
    "mistle.gateway.relay.backend": input.backend,
    "mistle.gateway.relay.encoded_bytes": input.encodedBytes,
    "mistle.gateway.relay.envelope_kind": input.envelope.kind,
    "mistle.gateway.relay.payload_bytes": payloadDescription.payloadBytes,
    "mistle.gateway.relay.payload_kind": payloadDescription.payloadKind,
    "mistle.gateway.relay.publish_outcome": input.outcome,
    "mistle.gateway.relay.target_node_id": input.envelope.target.nodeId,
    "mistle.sandbox.instance_id": input.envelope.target.sandboxInstanceId,
    "mistle.sandbox.tunnel.peer_side": input.envelope.target.side,
    "mistle.tunnel.relay_session_id": input.envelope.target.sessionId,
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
