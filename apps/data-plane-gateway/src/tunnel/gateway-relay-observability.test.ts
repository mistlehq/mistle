import { describe, expect, it } from "vitest";

import {
  buildRelayEnvelopeLogData,
  buildRelayEnvelopeMetricAttributes,
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
});
