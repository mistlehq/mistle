import { startNats } from "@mistle/test-harness";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { metrics, type Attributes } from "@opentelemetry/api";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NatsRelayTransportAdapter } from "../src/tunnel/relay-transport/adapters/nats-relay-transport-adapter.js";
import type { RelayEnvelope } from "../src/tunnel/types.js";

const OversizedBinaryPayload = new Uint8Array(900_000).buffer;

describe("NatsRelayTransportAdapter publish observability", () => {
  let meterProvider: MeterProvider | undefined;

  beforeEach(() => {
    metrics.disable();
  });

  afterEach(async () => {
    metrics.disable();

    const activeMeterProvider = meterProvider;
    meterProvider = undefined;
    if (activeMeterProvider !== undefined) {
      await activeMeterProvider.shutdown();
    }
  });

  it("records failed publish telemetry when NATS rejects an oversized relay envelope", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    meterProvider = new MeterProvider({
      readers: [reader],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    const nats = await startNats();
    let connection: NatsConnection | undefined;
    let adapter: NatsRelayTransportAdapter | undefined;

    try {
      connection = await connect({
        servers: nats.url,
      });
      adapter = new NatsRelayTransportAdapter("gateway-a", "integration-publish-failure");
      adapter.start(connection);

      const envelope: RelayEnvelope = {
        kind: "frame",
        target: {
          nodeId: "gateway-b",
          sandboxInstanceId: "sbi_publish_failure",
          sessionId: "connection-session-1",
          side: "connection",
        },
        payload: OversizedBinaryPayload,
      };

      await expect(adapter.deliverEnvelope(envelope)).rejects.toThrow(/max_payload/u);

      await reader.forceFlush();
      const resourceMetrics = exporter.getMetrics();

      expect(
        sumMetricValue(resourceMetrics, "mistle.gateway.relay.publish.events", {
          "mistle.gateway.relay.backend": "nats",
          "mistle.gateway.relay.envelope_kind": "frame",
          "mistle.gateway.relay.payload_kind": "binary",
          "mistle.gateway.relay.peer_side": "connection",
          "mistle.gateway.relay.publish_outcome": "failed",
        }),
      ).toBe(1);
      expect(
        histogramMax(resourceMetrics, "mistle.gateway.relay.publish.encoded_bytes", {
          "mistle.gateway.relay.backend": "nats",
          "mistle.gateway.relay.envelope_kind": "frame",
          "mistle.gateway.relay.payload_kind": "binary",
          "mistle.gateway.relay.peer_side": "connection",
          "mistle.gateway.relay.publish_outcome": "failed",
        }),
      ).toBeGreaterThan(1_048_576);
    } finally {
      await adapter?.stop();
      await connection?.close();
      await nats.stop();
    }
  }, 30_000);
});

function sumMetricValue(
  resourceMetrics: ResourceMetrics[],
  metricName: string,
  attributes: Attributes,
): number {
  const metric = findMetric(resourceMetrics, metricName);
  if (metric === undefined) {
    throw new Error(`Expected metric ${metricName} to be exported.`);
  }
  if (metric.dataPointType !== DataPointType.SUM) {
    throw new Error(`Expected metric ${metricName} to be a sum metric.`);
  }

  const point = metric.dataPoints.find((candidate) =>
    attributesMatch(candidate.attributes, attributes),
  );
  if (point === undefined) {
    throw new Error(`Expected metric ${metricName} to include the requested attributes.`);
  }

  return point.value;
}

function histogramMax(
  resourceMetrics: ResourceMetrics[],
  metricName: string,
  attributes: Attributes,
): number {
  const metric = findMetric(resourceMetrics, metricName);
  if (metric === undefined) {
    throw new Error(`Expected metric ${metricName} to be exported.`);
  }
  if (metric.dataPointType !== DataPointType.HISTOGRAM) {
    throw new Error(`Expected metric ${metricName} to be a histogram metric.`);
  }

  const point = metric.dataPoints.find((candidate) =>
    attributesMatch(candidate.attributes, attributes),
  );
  if (point === undefined) {
    throw new Error(`Expected metric ${metricName} to include the requested attributes.`);
  }
  if (point.value.max === undefined) {
    throw new Error(`Expected metric ${metricName} to include a max value.`);
  }

  return point.value.max;
}

function findMetric(
  resourceMetrics: ResourceMetrics[],
  metricName: string,
): MetricData | undefined {
  for (const resourceMetric of resourceMetrics) {
    for (const scopeMetric of resourceMetric.scopeMetrics) {
      const metric = scopeMetric.metrics.find(
        (candidate) => candidate.descriptor.name === metricName,
      );
      if (metric !== undefined) {
        return metric;
      }
    }
  }

  return undefined;
}

function attributesMatch(actual: Attributes, expected: Attributes): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      return false;
    }
  }

  return true;
}
