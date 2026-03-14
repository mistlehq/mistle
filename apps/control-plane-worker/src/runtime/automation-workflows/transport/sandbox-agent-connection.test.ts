import { systemSleeper } from "@mistle/time";
import { describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import type { DeliverAutomationPayloadServiceInput } from "../../services/types.js";
import { deliverAutomationPayload } from "./deliver-automation-payload.js";
import {
  connectSandboxAgentConnection,
  sendSandboxAgentMessage,
} from "./sandbox-agent-connection.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type AgentTestServerMode = "accept" | "reject" | "disconnect_before_payload";

type AgentTestServer = {
  url: string;
  connectRequest: Promise<{ streamId: number }>;
  payload: Promise<string>;
  socketClosed: Promise<void>;
  close: () => Promise<void>;
};

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
  };
}

function toText(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function parseStreamIdFromOpenMessage(data: RawData): number {
  const payloadText = toText(data);

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    throw new Error("Expected agent connect request payload to be valid JSON.");
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("Expected agent connect request payload to be an object.");
  }

  if (
    !("type" in parsedPayload) ||
    !("streamId" in parsedPayload) ||
    !("channel" in parsedPayload)
  ) {
    throw new Error("Expected agent stream.open payload to include type/streamId/channel.");
  }

  const typeValue = parsedPayload.type;
  const streamIdValue = parsedPayload.streamId;
  const channelValue = parsedPayload.channel;

  if (typeValue !== "stream.open") {
    throw new Error(
      `Expected agent stream open type to be 'stream.open', received '${String(typeValue)}'.`,
    );
  }

  if (typeof streamIdValue !== "number" || !Number.isInteger(streamIdValue) || streamIdValue <= 0) {
    throw new Error("Expected agent stream.open streamId to be a positive integer.");
  }

  if (
    typeof channelValue !== "object" ||
    channelValue === null ||
    Array.isArray(channelValue) ||
    !("kind" in channelValue) ||
    channelValue.kind !== "agent"
  ) {
    throw new Error("Expected connect request channel.kind to be 'agent'.");
  }

  return streamIdValue;
}

async function startAgentTestServer(mode: AgentTestServerMode): Promise<AgentTestServer> {
  const connectDeferred = createDeferred<{ streamId: number }>();
  const payloadDeferred = createDeferred<string>();
  const socketClosedDeferred = createDeferred<void>();

  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    let didHandleConnect = false;

    socket.on("message", (message) => {
      if (!didHandleConnect) {
        didHandleConnect = true;
        try {
          const streamId = parseStreamIdFromOpenMessage(message);
          connectDeferred.resolve({ streamId });

          if (mode === "reject") {
            socket.send(
              JSON.stringify({
                type: "stream.open.error",
                streamId,
                code: "agent_endpoint_unavailable",
                message: "agent endpoint unavailable",
              }),
            );
            return;
          }

          socket.send(
            JSON.stringify({
              type: "stream.open.ok",
              streamId,
            }),
          );

          if (mode === "disconnect_before_payload") {
            socket.close(1011, "disconnect before payload");
          }
          return;
        } catch (error) {
          connectDeferred.reject(error);
          payloadDeferred.reject(error);
          return;
        }
      }

      payloadDeferred.resolve(toText(message));
    });

    socket.on("close", () => {
      socketClosedDeferred.resolve();
    });

    socket.on("error", (error) => {
      connectDeferred.reject(error);
      payloadDeferred.reject(error);
      socketClosedDeferred.reject(error);
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    connectRequest: connectDeferred.promise,
    payload: payloadDeferred.promise,
    socketClosed: socketClosedDeferred.promise,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

function createDeliverInput(connectionUrl: string): DeliverAutomationPayloadServiceInput {
  return {
    preparedAutomationRun: {
      automationRunId: "aru_test_001",
      automationRunCreatedAt: "2026-03-05T00:00:00.000Z",
      automationId: "atm_test_001",
      conversationId: "cnv_test_001",
      automationTargetId: "atg_test_001",
      organizationId: "org_test_001",
      sandboxProfileId: "sbp_test_001",
      sandboxProfileVersion: 1,
      webhookEventId: "iwe_test_001",
      webhookEventType: "github.issue_comment.created",
      webhookProviderEventType: "issue_comment",
      webhookExternalEventId: "evt_test_001",
      webhookExternalDeliveryId: "delivery_test_001",
      webhookSourceOrderKey: "2026-03-05T00:00:00Z#0001",
      webhookPayload: {
        comment: {
          body: "@mistlebot run this",
        },
        issue: {
          number: 42,
        },
      },
      renderedInput: "Handle @mistlebot run this",
      renderedConversationKey: "issue-42",
      renderedIdempotencyKey: "delivery_test_001",
    },
    ensuredAutomationSandbox: {
      sandboxInstanceId: "sbi_test_001",
      startupWorkflowRunId: "wfr_start_001",
    },
    acquiredAutomationConnection: {
      instanceId: "sbi_test_001",
      url: connectionUrl,
      token: "connect_token_001",
      expiresAt: "2026-03-05T01:00:00.000Z",
    },
  };
}

describe("sandbox agent websocket delivery", () => {
  it("delivers the rendered automation input and closes the socket by default", async () => {
    const server = await startAgentTestServer("accept");

    try {
      const deliverInput = createDeliverInput(server.url);

      await deliverAutomationPayload(deliverInput);

      const connectRequest = await server.connectRequest;
      const payloadText = await server.payload;
      await server.socketClosed;

      expect(connectRequest.streamId).toBeGreaterThan(0);

      expect(payloadText).toBe("Handle @mistlebot run this");
    } finally {
      await server.close();
    }
  });

  it("surfaces stream.open.error responses from the sandbox agent channel", async () => {
    const server = await startAgentTestServer("reject");

    try {
      await expect(deliverAutomationPayload(createDeliverInput(server.url))).rejects.toThrow(
        "Sandbox agent stream.open request was rejected (agent_endpoint_unavailable): agent endpoint unavailable",
      );
    } finally {
      await server.close();
    }
  });

  it("keeps the socket open when sendSandboxAgentMessage is called with autoClose=false", async () => {
    const server = await startAgentTestServer("accept");

    try {
      const connection = await connectSandboxAgentConnection({
        connectionUrl: server.url,
      });

      await sendSandboxAgentMessage({
        connection,
        message: "hello-agent",
        autoClose: false,
      });

      const payloadText = await server.payload;
      expect(payloadText).toBe("hello-agent");
      expect(connection.socket.readyState).toBe(WebSocket.OPEN);

      await systemSleeper.sleep(50);
      expect(connection.socket.readyState).toBe(WebSocket.OPEN);

      await connection.close({
        code: 1000,
        reason: "test complete",
      });
      expect(connection.socket.readyState).toBe(WebSocket.CLOSED);
      await server.socketClosed;
    } finally {
      await server.close();
    }
  });

  it("fails fast when the websocket closes before a payload send completes", async () => {
    const server = await startAgentTestServer("disconnect_before_payload");

    try {
      const connection = await connectSandboxAgentConnection({
        connectionUrl: server.url,
      });

      await expect(
        sendSandboxAgentMessage({
          connection,
          message: "hello-agent",
          autoClose: false,
        }),
      ).rejects.toThrow("Sandbox session socket is not open.");

      await server.socketClosed;
    } finally {
      await server.close();
    }
  });
});
