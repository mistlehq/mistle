import { createServer } from "node:http";

import { startNats } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { connect, type Msg, type NatsConnection } from "@nats-io/transport-node";
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
import { WSContext } from "hono/ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { NatsRelayTransportAdapter } from "../src/tunnel/relay-transport/adapters/nats-relay-transport-adapter.js";
import type { RelayEnvelope, RelayPeerSocket, RelayTarget } from "../src/tunnel/types.js";

const OversizedBinaryPayload = new Uint8Array(900_000).buffer;
const TooLargeForReassemblyPayload = new Uint8Array(64 * 1024 * 1024 + 1).buffer;
const TextEncoderInstance = new TextEncoder();

type ReceivedWebSocketMessage = {
  data: Buffer | string;
  isBinary: boolean;
};

type WebSocketPair = {
  clientSocket: WebSocket;
  closeAll: () => Promise<void>;
  peerSocket: RelayPeerSocket;
  serverSocket: WebSocket;
};

describe("NatsRelayTransportAdapter publish observability", () => {
  let exporter: InMemoryMetricExporter;
  let meterProvider: MeterProvider | undefined;
  let reader: PeriodicExportingMetricReader;

  beforeAll(() => {
    metrics.disable();
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    meterProvider = new MeterProvider({
      readers: [reader],
    });
    metrics.setGlobalMeterProvider(meterProvider);
  });

  afterAll(async () => {
    metrics.disable();

    const activeMeterProvider = meterProvider;
    meterProvider = undefined;
    if (activeMeterProvider !== undefined) {
      await activeMeterProvider.shutdown();
    }
  });

  it("records failed publish telemetry when NATS rejects an oversized relay envelope", async () => {
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
        kind: "close",
        target: {
          nodeId: "gateway-b",
          sandboxInstanceId: "sbi_publish_failure",
          sessionId: "connection-session-1",
          side: "connection",
        },
        closeCode: 1012,
        closeReason: "x".repeat(1_100_000),
      };

      await expect(adapter.deliverEnvelope(envelope)).rejects.toThrow(/max_payload/u);

      await reader.forceFlush();
      const resourceMetrics = exporter.getMetrics();

      expect(
        sumMetricValue(resourceMetrics, "mistle.gateway.relay.publish.events", {
          "mistle.gateway.relay.backend": "nats",
          "mistle.gateway.relay.envelope_kind": "close",
          "mistle.gateway.relay.payload_kind": "none",
          "mistle.gateway.relay.peer_side": "connection",
          "mistle.gateway.relay.publish_outcome": "failed",
        }),
      ).toBe(1);
      expect(
        histogramMax(resourceMetrics, "mistle.gateway.relay.publish.encoded_bytes", {
          "mistle.gateway.relay.backend": "nats",
          "mistle.gateway.relay.envelope_kind": "close",
          "mistle.gateway.relay.payload_kind": "none",
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

  it("delivers oversized binary relay frames through chunked NATS messages", async () => {
    const nats = await startNats();
    const pair = await createWebSocketPair();
    let senderConnection: NatsConnection | undefined;
    let receiverConnection: NatsConnection | undefined;
    let sender: NatsRelayTransportAdapter | undefined;
    let receiver: NatsRelayTransportAdapter | undefined;

    try {
      senderConnection = await connect({
        servers: nats.url,
      });
      receiverConnection = await connect({
        servers: nats.url,
      });
      sender = new NatsRelayTransportAdapter("gateway-a", "integration-chunked-relay");
      receiver = new NatsRelayTransportAdapter("gateway-b", "integration-chunked-relay");
      sender.start(senderConnection);
      receiver.start(receiverConnection);
      await senderConnection.flush();
      await receiverConnection.flush();

      const target = createRelayTarget({
        nodeId: "gateway-b",
      });
      receiver.registerLocalPeer({
        target,
        socket: pair.peerSocket,
      });

      const receivedPromise = waitForWebSocketMessage(pair.clientSocket);
      await sender.deliverEnvelope({
        kind: "frame",
        target,
        payload: OversizedBinaryPayload,
      });
      const received = await receivedPromise;

      expect(received.isBinary).toBe(true);
      if (typeof received.data === "string") {
        throw new Error("Expected binary websocket message.");
      }
      expect(received.data.equals(Buffer.from(OversizedBinaryPayload))).toBe(true);
    } finally {
      await sender?.stop();
      await receiver?.stop();
      await senderConnection?.close();
      await receiverConnection?.close();
      await pair.closeAll();
      await nats.stop();
    }
  }, 30_000);

  it("rejects frames above the reassembly limit before publishing chunks", async () => {
    const nats = await startNats();
    let connection: NatsConnection | undefined;
    let adapter: NatsRelayTransportAdapter | undefined;

    try {
      connection = await connect({
        servers: nats.url,
      });
      const subjectPrefix = "integration-reassembly-limit";
      const target = createRelayTarget({
        nodeId: "gateway-b",
      });
      const subscription = connection.subscribe(`${subjectPrefix}.relay.${target.nodeId}`);
      adapter = new NatsRelayTransportAdapter("gateway-a", subjectPrefix);
      adapter.start(connection);
      await connection.flush();

      await expect(
        adapter.deliverEnvelope({
          kind: "frame",
          target,
          payload: TooLargeForReassemblyPayload,
        }),
      ).rejects.toThrow(/too large for NATS chunk reassembly/u);
      await expectNoNatsMessage(subscription, 150);
    } finally {
      await adapter?.stop();
      await connection?.close();
      await nats.stop();
    }
  }, 30_000);

  it("ignores malformed chunk indexes without stopping the relay subscription", async () => {
    const nats = await startNats();
    const pair = await createWebSocketPair();
    let senderConnection: NatsConnection | undefined;
    let receiverConnection: NatsConnection | undefined;
    let sender: NatsRelayTransportAdapter | undefined;
    let receiver: NatsRelayTransportAdapter | undefined;

    try {
      senderConnection = await connect({
        servers: nats.url,
      });
      receiverConnection = await connect({
        servers: nats.url,
      });
      const subjectPrefix = "integration-malformed-chunk";
      sender = new NatsRelayTransportAdapter("gateway-a", subjectPrefix);
      receiver = new NatsRelayTransportAdapter("gateway-b", subjectPrefix);
      sender.start(senderConnection);
      receiver.start(receiverConnection);
      await senderConnection.flush();
      await receiverConnection.flush();

      const target = createRelayTarget({
        nodeId: "gateway-b",
      });
      receiver.registerLocalPeer({
        target,
        socket: pair.peerSocket,
      });
      receiverConnection.publish(
        `${subjectPrefix}.relay.gateway-b`,
        encodeJson({
          kind: "frame_chunk",
          target,
          messageId: "malformed-chunk-index",
          payloadKind: "binary",
          chunkIndex: 1,
          chunkCount: 1,
          originalPayloadBytes: 1,
          value: Buffer.from([1]).toString("base64"),
        }),
      );
      await receiverConnection.flush();

      const receivedPromise = waitForWebSocketMessage(pair.clientSocket);
      await sender.deliverEnvelope({
        kind: "frame",
        target,
        payload: "after malformed chunk",
      });
      const received = await receivedPromise;

      expect(received).toEqual({
        data: "after malformed chunk",
        isBinary: false,
      });
    } finally {
      await sender?.stop();
      await receiver?.stop();
      await senderConnection?.close();
      await receiverConnection?.close();
      await pair.closeAll();
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

function encodeJson(value: object): Uint8Array {
  return TextEncoderInstance.encode(JSON.stringify(value));
}

async function expectNoNatsMessage(
  subscription: AsyncIterable<Msg>,
  timeoutMs: number,
): Promise<void> {
  const iterator = subscription[Symbol.asyncIterator]();
  const result = await Promise.race([
    iterator.next(),
    systemSleeper.sleep(timeoutMs).then(() => undefined),
  ]);
  if (result !== undefined) {
    throw new Error("Expected NATS subscription to receive no message.");
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

function waitForWebSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function waitForWebSocketMessage(socket: WebSocket): Promise<ReceivedWebSocketMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      resolve({
        data: isBinary ? toBuffer(data) : toBuffer(data).toString("utf8"),
        isBinary,
      });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

function toWsReadyState(input: number): 0 | 1 | 2 | 3 {
  if (input === 0 || input === 1 || input === 2 || input === 3) {
    return input;
  }

  throw new Error(`Unexpected websocket ready state: ${String(input)}`);
}

function toPeerSocket(socket: WebSocket): RelayPeerSocket {
  return new WSContext<WebSocket>({
    send: (data, options) => {
      socket.send(data, {
        compress: options.compress,
      });
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
    get readyState() {
      return toWsReadyState(socket.readyState);
    },
    raw: socket,
  });
}

function createRelayTarget(input: { nodeId: string }): RelayTarget {
  return {
    nodeId: input.nodeId,
    sandboxInstanceId: "sbi_chunked_relay",
    sessionId: "connection-session-1",
    side: "connection",
  };
}

async function createWebSocketPair(): Promise<WebSocketPair> {
  const server = createServer();
  const webSocketServer = new WebSocketServer({
    server,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address to be available.");
  }

  const serverSocketPromise = new Promise<WebSocket>((resolve, reject) => {
    webSocketServer.once("connection", (socket) => {
      resolve(socket);
    });
    webSocketServer.once("error", reject);
  });
  const clientSocket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);

  await waitForWebSocketOpen(clientSocket);
  const serverSocket = await serverSocketPromise;

  const closeAll = async (): Promise<void> => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        clientSocket.once("close", () => {
          resolve();
        });
        clientSocket.close();
      });
    }
    if (serverSocket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        serverSocket.once("close", () => {
          resolve();
        });
        serverSocket.close();
      });
    }

    await new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  return {
    clientSocket,
    serverSocket,
    peerSocket: toPeerSocket(serverSocket),
    closeAll,
  };
}
