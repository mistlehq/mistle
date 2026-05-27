import { describe, expect, it } from "vitest";

import {
  buildGatewayForwardingPortAccessAuthorizationLogData,
  buildGatewayForwardingPortAccessAuthorizationMetricAttributes,
  buildRelayEnvelopeLogData,
  buildRelayEnvelopeMetricAttributes,
  buildRelayPublishLogData,
  buildRelayPublishMetricAttributes,
  describeRelayPayload,
} from "./gateway-relay-observability.js";
import type { RelayEnvelope } from "./types.js";

describe("gateway relay observability", () => {
  it("keeps high-cardinality relay identifiers out of metric attributes", () => {
    const envelope: RelayEnvelope = {
      kind: "frame",
      target: {
        nodeId: "gateway-b",
        sandboxInstanceId: "sbi_observability",
        sessionId: "bootstrap-session-1",
        side: "bootstrap",
      },
      payload: "hello",
    };

    expect(
      buildRelayEnvelopeMetricAttributes(
        {
          backend: "nats",
          direction: "published",
          envelope,
          localNodeId: "gateway-a",
        },
        describeRelayPayload(envelope.payload),
      ),
    ).toEqual({
      "mistle.gateway.relay.backend": "nats",
      "mistle.gateway.relay.direction": "published",
      "mistle.gateway.relay.envelope_kind": "frame",
      "mistle.gateway.relay.payload_kind": "text",
      "mistle.gateway.relay.peer_side": "bootstrap",
      "mistle.gateway.relay.target_is_local": false,
    });
  });

  it("includes relay identifiers in drop logs so missing local sockets are diagnosable", () => {
    const envelope: RelayEnvelope = {
      closeCode: 1012,
      closeReason: "Sandbox tunnel peer disconnected.",
      kind: "close",
      target: {
        nodeId: "gateway-b",
        sandboxInstanceId: "sbi_observability",
        sessionId: "connection-session-1",
        side: "connection",
      },
    };

    expect(
      buildRelayEnvelopeLogData(
        {
          backend: "nats",
          direction: "dropped",
          dropReason: "missing_local_socket",
          envelope,
          localNodeId: "gateway-b",
        },
        {
          payloadBytes: 0,
          payloadKind: "none",
        },
      ),
    ).toEqual({
      eventName: "gateway.relay.envelope.dropped",
      "mistle.gateway.node_id": "gateway-b",
      "mistle.gateway.relay.backend": "nats",
      "mistle.gateway.relay.direction": "dropped",
      "mistle.gateway.relay.drop_reason": "missing_local_socket",
      "mistle.gateway.relay.envelope_kind": "close",
      "mistle.gateway.relay.payload_bytes": 0,
      "mistle.gateway.relay.payload_kind": "none",
      "mistle.gateway.relay.target_node_id": "gateway-b",
      "mistle.sandbox.instance_id": "sbi_observability",
      "mistle.sandbox.tunnel.peer_side": "connection",
      "mistle.tunnel.relay_session_id": "connection-session-1",
    });
  });

  it("keeps relay identifiers out of publish metric attributes", () => {
    const envelope: RelayEnvelope = {
      kind: "frame",
      target: {
        nodeId: "gateway-b",
        sandboxInstanceId: "sbi_publish_observability",
        sessionId: "connection-session-1",
        side: "connection",
      },
      payload: new Uint8Array([1, 2, 3]).buffer,
    };

    expect(
      buildRelayPublishMetricAttributes(
        {
          backend: "nats",
          envelope,
          outcome: "failed",
        },
        describeRelayPayload(envelope.payload),
      ),
    ).toEqual({
      "mistle.gateway.relay.backend": "nats",
      "mistle.gateway.relay.envelope_kind": "frame",
      "mistle.gateway.relay.payload_kind": "binary",
      "mistle.gateway.relay.peer_side": "connection",
      "mistle.gateway.relay.publish_outcome": "failed",
    });
  });

  it("includes encoded payload size and relay identifiers in publish failure logs", () => {
    const envelope: RelayEnvelope = {
      kind: "frame",
      target: {
        nodeId: "gateway-b",
        sandboxInstanceId: "sbi_publish_observability",
        sessionId: "connection-session-1",
        side: "connection",
      },
      payload: "oversized payload",
    };
    const error = new Error("payload max_payload size exceeded");

    expect(
      buildRelayPublishLogData(
        {
          backend: "nats",
          encodedBytes: 1_048_577,
          envelope,
          error,
          localNodeId: "gateway-a",
          outcome: "failed",
        },
        describeRelayPayload(envelope.payload),
      ),
    ).toEqual({
      eventName: "gateway.relay.publish.failed",
      error,
      "mistle.gateway.node_id": "gateway-a",
      "mistle.gateway.relay.backend": "nats",
      "mistle.gateway.relay.encoded_bytes": 1_048_577,
      "mistle.gateway.relay.envelope_kind": "frame",
      "mistle.gateway.relay.payload_bytes": 17,
      "mistle.gateway.relay.payload_kind": "text",
      "mistle.gateway.relay.publish_outcome": "failed",
      "mistle.gateway.relay.target_node_id": "gateway-b",
      "mistle.sandbox.instance_id": "sbi_publish_observability",
      "mistle.sandbox.tunnel.peer_side": "connection",
      "mistle.tunnel.relay_session_id": "connection-session-1",
    });
  });

  it("keeps forwarded Port Access authorization identifiers out of metric attributes", () => {
    expect(
      buildGatewayForwardingPortAccessAuthorizationMetricAttributes({
        backend: "nats",
        outcome: "error",
        errorCode: "bootstrap_not_connected",
      }),
    ).toEqual({
      "mistle.gateway.forwarding.error_code": "bootstrap_not_connected",
      "mistle.gateway.forwarding.operation": "authorize_port_access_target",
      "mistle.gateway.forwarding.outcome": "error",
      "mistle.gateway.relay.backend": "nats",
    });
  });

  it("includes forwarded Port Access authorization identifiers in logs", () => {
    expect(
      buildGatewayForwardingPortAccessAuthorizationLogData({
        backend: "nats",
        durationMs: 125,
        errorCode: "bootstrap_not_connected",
        localNodeId: "gateway-b",
        outcome: "error",
        port: 5173,
        sandboxInstanceId: "sbi_observability",
        sourceNodeId: "gateway-b",
        targetNodeId: "gateway-a",
      }),
    ).toEqual({
      eventName: "gateway.forwarding.port_access_authorization",
      "mistle.gateway.forwarding.duration_ms": 125,
      "mistle.gateway.forwarding.error_code": "bootstrap_not_connected",
      "mistle.gateway.forwarding.operation": "authorize_port_access_target",
      "mistle.gateway.forwarding.outcome": "error",
      "mistle.gateway.forwarding.source_node_id": "gateway-b",
      "mistle.gateway.forwarding.target_node_id": "gateway-a",
      "mistle.gateway.node_id": "gateway-b",
      "mistle.gateway.relay.backend": "nats",
      "mistle.port_access.target.port": 5173,
      "mistle.sandbox.instance_id": "sbi_observability",
    });
  });
});
