/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import {
  parseEgressTransportMessage,
  type EgressTransportMessage,
} from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket, { type RawData } from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketClose,
} from "../integration/websocket-test-helpers.js";

const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const StepTimeoutMs = 5_000;
const TestTimeoutMs = 40_000;

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

type ReceivedHttpRequest = {
  body: string;
  headers: IncomingMessage["headers"];
  method: string;
  url: string;
};

type SimulatedHttpUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextRequest: () => Promise<ReceivedHttpRequest>;
};

type SimulatedUpgradeUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextRequest: () => Promise<ReceivedHttpRequest>;
};

type SimulatedStreamingHttpUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextRequest: () => Promise<ReceivedHttpRequest>;
  nextResponseClosed: () => Promise<void>;
};

type WebSocketMessageQueue = {
  close: () => void;
  next: () => Promise<EgressTransportMessage>;
};

describe.concurrent("gateway egress transport integration", () => {
  it(
    "forwards unmatched HTTP requests upstream without trusting sandbox-authored runtime plan revision",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedHttpUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/demo/path?color=blue", upstream.baseUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_http",
            streamId: 11,
            request: {
              method: "POST",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              query: upstreamUrl.search.slice(1),
              runtimePlanRevision: "sandbox-authored-revision",
              headers: {
                "content-type": ["text/plain; charset=utf-8"],
                "x-request-marker": ["egress-http"],
              },
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 11,
            bytes: Buffer.from("hello from sandboxd", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 11,
          }),
        );

        const request = await withTimeout({
          label: "waiting for simulated HTTP upstream request",
          promise: upstream.nextRequest(),
        });
        expect(request).toEqual({
          body: "hello from sandboxd",
          headers: expect.objectContaining({
            "content-type": "text/plain; charset=utf-8",
            "x-request-marker": "egress-http",
          }),
          method: "POST",
          url: "/demo/path?color=blue",
        });
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers["x-mistle-egress-grant"]).toBeUndefined();

        await expect(
          withTimeout({
            label: "waiting for egress HTTP response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 11,
          status: 202,
          headers: expect.objectContaining({
            "content-type": ["text/plain; charset=utf-8"],
            "x-upstream-marker": ["simulated-http"],
          }),
        });
        await expect(
          withTimeout({
            label: "waiting for egress HTTP response body chunk",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.chunk",
          streamId: 11,
          bytes: Buffer.from("hello from upstream", "utf8").toString("base64"),
          encoding: "base64",
        });
        await expect(
          withTimeout({
            label: "waiting for egress HTTP response body end",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.end",
          streamId: 11,
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "rejects matched managed routes before credential injection is implemented",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              egressRuleId: "egress_rule_openai",
              hosts: ["api.openai.com"],
              pathPrefixes: ["/v1"],
              methods: ["POST"],
            }),
          ],
        }),
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_managed_route",
            streamId: 20,
            request: {
              method: "POST",
              scheme: "https",
              authority: "api.openai.com",
              path: "/v1/responses",
              headers: {},
            },
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for managed route deferred egress error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 20,
          code: "forbidden_tunnel_state",
          message:
            "Managed egress route 'egress_rule_openai' matched, but gateway credential injection is not enabled yet.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "rejects matched managed routes that require missing acting-user context",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              credentialResolver: {
                kind: "linked_principal",
                providerFamily: "github",
                actingUserRequired: true,
                resolutionMode: "required",
              },
              egressRuleId: "egress_rule_github_linked",
              hosts: ["api.github.com"],
              pathPrefixes: ["/"],
            }),
          ],
        }),
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_linked_principal",
            streamId: 22,
            request: {
              method: "GET",
              scheme: "https",
              authority: "api.github.com",
              path: "/repos/mistlehq/mistle",
              headers: {},
            },
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for linked principal authorization egress error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 22,
          code: "forbidden_tunnel_state",
          message:
            "Managed egress route 'egress_rule_github_linked' requires acting-user context, but gateway egress did not receive one.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "rejects requests that match multiple persisted managed routes",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              egressRuleId: "egress_rule_openai_broad",
              hosts: ["api.openai.com"],
              pathPrefixes: ["/"],
            }),
            createRoute({
              egressRuleId: "egress_rule_openai_responses",
              hosts: ["api.openai.com"],
              pathPrefixes: ["/v1/responses"],
              methods: ["POST"],
            }),
          ],
        }),
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_ambiguous_route",
            streamId: 21,
            request: {
              method: "POST",
              scheme: "https",
              authority: "api.openai.com",
              path: "/v1/responses",
              headers: {},
            },
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for ambiguous managed route egress error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 21,
          code: "forbidden_tunnel_state",
          message:
            "Multiple managed egress routes matched POST api.openai.com/v1/responses: egress_rule_openai_broad, egress_rule_openai_responses.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "forwards unmatched HTTP upgrades as post-upgrade byte streams",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedUpgradeUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/socket", upstream.baseUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_upgrade",
            streamId: 12,
            request: {
              method: "GET",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              headers: {
                connection: ["Upgrade"],
                upgrade: ["websocket"],
                "sec-websocket-key": ["dGhlIHNhbXBsZSBub25jZQ=="],
                "sec-websocket-version": ["13"],
              },
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 12,
          }),
        );

        const request = await withTimeout({
          label: "waiting for simulated upgrade upstream request",
          promise: upstream.nextRequest(),
        });
        expect(request.method).toBe("GET");
        expect(request.url).toBe("/socket");
        expect(request.headers.upgrade).toBe("websocket");

        await expect(
          withTimeout({
            label: "waiting for egress upgrade response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 12,
          status: 101,
          headers: expect.objectContaining({
            connection: ["Upgrade"],
            upgrade: ["websocket"],
          }),
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.tcp.data",
            streamId: 12,
            direction: "request",
            bytes: Buffer.from("ping", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await expect(
          withTimeout({
            label: "waiting for egress upgraded response bytes",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.tcp.data",
          streamId: 12,
          direction: "response",
          bytes: Buffer.from("echo:ping", "utf8").toString("base64"),
          encoding: "base64",
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.tcp.close",
            streamId: 12,
            direction: "request",
          }),
        );
        await expect(
          withTimeout({
            label: "waiting for egress upgraded response close",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.tcp.close",
          streamId: 12,
          direction: "response",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "closes the upstream HTTP response when sandboxd cancels an egress stream",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedStreamingHttpUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/stream", upstream.baseUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_cancel",
            streamId: 13,
            request: {
              method: "GET",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              headers: {},
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 13,
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for simulated streaming HTTP upstream request",
            promise: upstream.nextRequest(),
          }),
        ).resolves.toEqual({
          body: "",
          headers: expect.any(Object),
          method: "GET",
          url: "/stream",
        });
        await expect(
          withTimeout({
            label: "waiting for streaming HTTP response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 13,
          status: 200,
          headers: expect.objectContaining({
            "content-type": ["text/plain; charset=utf-8"],
          }),
        });
        await expect(
          withTimeout({
            label: "waiting for streaming HTTP response body chunk",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.chunk",
          streamId: 13,
          bytes: Buffer.from("stream-start", "utf8").toString("base64"),
          encoding: "base64",
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.stream.cancel",
            streamId: 13,
            reason: "caller stopped waiting",
          }),
        );

        await withTimeout({
          label: "waiting for simulated streaming HTTP upstream response to close",
          promise: upstream.nextResponseClosed(),
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "returns a stream error for gateway-owned egress frames sent by sandboxd",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.response.start",
            streamId: 14,
            status: 200,
            headers: {},
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for forbidden egress frame error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 14,
          code: "forbidden_tunnel_state",
          message:
            "Bootstrap tunnel cannot send gateway-owned egress message 'egress.http.response.start'.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "returns a stream error for malformed egress frames with a stream id",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 15,
            bytes: "not-checked-here",
            encoding: "plain",
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for malformed egress frame error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 15,
          code: "malformed_frame",
          message: "Malformed egress transport message 'egress.http.request.body.chunk'.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "returns a stream error for invalid base64 request body chunks",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedStreamingHttpUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/invalid-base64", upstream.baseUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.open",
            requestId: "req_gateway_egress_invalid_base64",
            streamId: 17,
            request: {
              method: "POST",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              headers: {},
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 17,
            bytes: "not-valid-base64",
            encoding: "base64",
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for invalid base64 egress frame error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 17,
          code: "malformed_frame",
          message: "Egress HTTP request body chunk must contain valid base64 bytes.",
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "returns a stream error for request body chunks after the request body has ended",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const upstream = await startSimulatedStreamingHttpUpstream();
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const messageQueue = createWebSocketMessageQueue(bootstrapSocket);

      try {
        const upstreamUrl = new URL("/invalid-state", upstream.baseUrl);
        await openStreamingEgressRequest({
          bootstrapSocket,
          path: upstreamUrl.pathname,
          streamId: 18,
          upstreamHost: upstreamUrl.host,
        });
        await withTimeout({
          label: "waiting for invalid-state upstream request",
          promise: upstream.nextRequest(),
        });
        await withTimeout({
          label: "waiting for invalid-state response start",
          promise: messageQueue.next(),
        });
        await withTimeout({
          label: "waiting for invalid-state response body chunk",
          promise: messageQueue.next(),
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 18,
            bytes: Buffer.from("late body", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );

        await expect(
          withTimeout({
            label: "waiting for forbidden egress stream state error",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.stream.error",
          streamId: 18,
          code: "forbidden_tunnel_state",
          message: "Egress stream '18' cannot accept request body chunks.",
        });
        await withTimeout({
          label: "waiting for invalid-state upstream response to close",
          promise: upstream.nextResponseClosed(),
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "keeps egress streams isolated by bootstrap tunnel session when stream ids are reused",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const firstUpstream = await startSimulatedStreamingHttpUpstream();
      const secondUpstream = await startSimulatedStreamingHttpUpstream();
      const firstBootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const firstMessageQueue = createWebSocketMessageQueue(firstBootstrapSocket);
      const firstSocketClosed = waitForWebSocketClose(firstBootstrapSocket);

      let secondBootstrapSocket: WebSocket | undefined;
      let secondMessageQueue: WebSocketMessageQueue | undefined;

      try {
        const firstUpstreamUrl = new URL("/first-session", firstUpstream.baseUrl);
        await openStreamingEgressRequest({
          bootstrapSocket: firstBootstrapSocket,
          path: firstUpstreamUrl.pathname,
          streamId: 16,
          upstreamHost: firstUpstreamUrl.host,
        });
        await expect(
          withTimeout({
            label: "waiting for first bootstrap-session upstream request",
            promise: firstUpstream.nextRequest(),
          }),
        ).resolves.toEqual({
          body: "",
          headers: expect.any(Object),
          method: "GET",
          url: "/first-session",
        });
        await expect(
          withTimeout({
            label: "waiting for first bootstrap-session response start",
            promise: firstMessageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 16,
          status: 200,
          headers: expect.objectContaining({
            "content-type": ["text/plain; charset=utf-8"],
          }),
        });

        secondBootstrapSocket = await connectBootstrapSocket({
          env,
          sandboxInstanceId,
        });
        secondMessageQueue = createWebSocketMessageQueue(secondBootstrapSocket);

        const secondUpstreamUrl = new URL("/second-session", secondUpstream.baseUrl);
        await openStreamingEgressRequest({
          bootstrapSocket: secondBootstrapSocket,
          path: secondUpstreamUrl.pathname,
          streamId: 16,
          upstreamHost: secondUpstreamUrl.host,
        });

        await expect(
          withTimeout({
            label: "waiting for second bootstrap-session upstream request",
            promise: secondUpstream.nextRequest(),
          }),
        ).resolves.toEqual({
          body: "",
          headers: expect.any(Object),
          method: "GET",
          url: "/second-session",
        });
        await expect(
          withTimeout({
            label: "waiting for second bootstrap-session response start",
            promise: secondMessageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 16,
          status: 200,
          headers: expect.objectContaining({
            "content-type": ["text/plain; charset=utf-8"],
          }),
        });

        await withTimeout({
          label: "waiting for replaced first bootstrap tunnel to close",
          promise: firstSocketClosed,
        });
        await withTimeout({
          label: "waiting for first bootstrap-session upstream response to close",
          promise: firstUpstream.nextResponseClosed(),
        });

        await sendWebSocketMessage(
          secondBootstrapSocket,
          JSON.stringify({
            type: "egress.stream.cancel",
            streamId: 16,
            reason: "test completed",
          }),
        );
        await withTimeout({
          label: "waiting for second bootstrap-session upstream response to close",
          promise: secondUpstream.nextResponseClosed(),
        });
      } finally {
        firstMessageQueue.close();
        secondMessageQueue?.close();
        await closeIfOpen(firstBootstrapSocket);
        if (secondBootstrapSocket !== undefined) {
          await closeIfOpen(secondBootstrapSocket);
        }
        await firstUpstream.close();
        await secondUpstream.close();
      }
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  runtimePlan?: CompiledRuntimePlan;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_gateway_egress_transport",
    sandboxProfileId: "sbp_integration_gateway_egress_transport",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_gateway_egress_transport",
    source: "webhook",
  });

  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: input.runtimePlan ?? createRuntimePlan({ egressRoutes: [] }),
    compiledFromProfileId: "sbp_integration_gateway_egress_transport",
    compiledFromProfileVersion: 1,
  });
}

function createRuntimePlan(input: {
  egressRoutes: CompiledRuntimePlan["egressRoutes"];
}): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_integration_gateway_egress_transport",
    version: 1,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: input.egressRoutes,
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}

function createRoute(input: {
  credentialResolver?: CompiledRuntimePlan["egressRoutes"][number]["credentialResolver"];
  egressRuleId: string;
  hosts: string[];
  pathPrefixes?: string[];
  methods?: string[];
}): CompiledRuntimePlan["egressRoutes"][number] {
  return {
    egressRuleId: input.egressRuleId,
    bindingId: `bind_${input.egressRuleId}`,
    familyId: "openai",
    variantId: "openai-default",
    match: {
      hosts: input.hosts,
      ...(input.pathPrefixes === undefined ? {} : { pathPrefixes: input.pathPrefixes }),
      ...(input.methods === undefined ? {} : { methods: input.methods }),
    },
    upstream: {
      baseUrl: `https://${input.hosts[0]}`,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: "ic_openai",
      secretType: "api_token",
    },
    ...(input.credentialResolver === undefined
      ? {}
      : { credentialResolver: input.credentialResolver }),
  };
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function openStreamingEgressRequest(input: {
  bootstrapSocket: WebSocket;
  path: string;
  streamId: number;
  upstreamHost: string;
}): Promise<void> {
  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "egress.http.open",
      requestId: `req_gateway_egress_session_${String(input.streamId)}`,
      streamId: input.streamId,
      request: {
        method: "GET",
        scheme: "http",
        authority: input.upstreamHost,
        path: input.path,
        headers: {},
      },
    }),
  );
  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "egress.http.request.body.end",
      streamId: input.streamId,
    }),
  );
}

async function startSimulatedHttpUpstream(): Promise<SimulatedHttpUpstream> {
  const receivedRequests: ReceivedHttpRequest[] = [];
  const waitingResolvers: Array<(request: ReceivedHttpRequest) => void> = [];
  const server = createServer((request, response) => {
    handleSimulatedHttpRequest({
      receivedRequests,
      request,
      response,
      waitingResolvers,
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      await closeServer(server);
    },
    nextRequest: async () => {
      const request = receivedRequests.shift();
      if (request !== undefined) {
        return request;
      }

      return await new Promise<ReceivedHttpRequest>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

async function startSimulatedUpgradeUpstream(): Promise<SimulatedUpgradeUpstream> {
  const receivedRequests: ReceivedHttpRequest[] = [];
  const waitingResolvers: Array<(request: ReceivedHttpRequest) => void> = [];
  const sockets = new Set<Duplex>();
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    const receivedRequest = {
      body: "",
      headers: request.headers,
      method: request.method ?? "",
      url: request.url ?? "",
    };
    const resolver = waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(receivedRequest);
    } else {
      receivedRequests.push(receivedRequest);
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "",
        "",
      ].join("\r\n"),
    );
    socket.on("data", (chunk: Buffer) => {
      socket.write(Buffer.concat([Buffer.from("echo:", "utf8"), chunk]));
    });
    socket.on("end", () => {
      socket.end();
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await closeServer(server);
    },
    nextRequest: async () => {
      const request = receivedRequests.shift();
      if (request !== undefined) {
        return request;
      }

      return await new Promise<ReceivedHttpRequest>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

async function startSimulatedStreamingHttpUpstream(): Promise<SimulatedStreamingHttpUpstream> {
  const receivedRequests: ReceivedHttpRequest[] = [];
  const waitingRequestResolvers: Array<(request: ReceivedHttpRequest) => void> = [];
  const waitingCloseResolvers: Array<() => void> = [];
  let closedResponseCount = 0;
  const sockets = new Set<Duplex>();
  const server = createServer((request, response) => {
    sockets.add(request.socket);
    request.socket.on("close", () => {
      sockets.delete(request.socket);
    });
    response.on("close", () => {
      const resolver = waitingCloseResolvers.shift();
      if (resolver !== undefined) {
        resolver();
        return;
      }

      closedResponseCount += 1;
    });
    handleSimulatedStreamingHttpRequest({
      receivedRequests,
      request,
      response,
      waitingResolvers: waitingRequestResolvers,
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await closeServer(server);
    },
    nextRequest: async () => {
      const request = receivedRequests.shift();
      if (request !== undefined) {
        return request;
      }

      return await new Promise<ReceivedHttpRequest>((resolve) => {
        waitingRequestResolvers.push(resolve);
      });
    },
    nextResponseClosed: async () => {
      if (closedResponseCount > 0) {
        closedResponseCount -= 1;
        return;
      }

      await new Promise<void>((resolve) => {
        waitingCloseResolvers.push(resolve);
      });
    },
  };
}

function handleSimulatedHttpRequest(input: {
  receivedRequests: ReceivedHttpRequest[];
  request: IncomingMessage;
  response: ServerResponse;
  waitingResolvers: Array<(request: ReceivedHttpRequest) => void>;
}): void {
  const chunks: Buffer[] = [];
  input.request.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  input.request.on("end", () => {
    const receivedRequest = {
      body: Buffer.concat(chunks).toString("utf8"),
      headers: input.request.headers,
      method: input.request.method ?? "",
      url: input.request.url ?? "",
    };
    const resolver = input.waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(receivedRequest);
    } else {
      input.receivedRequests.push(receivedRequest);
    }
    input.response.writeHead(202, {
      "content-type": "text/plain; charset=utf-8",
      "x-upstream-marker": "simulated-http",
    });
    input.response.end("hello from upstream");
  });
}

function handleSimulatedStreamingHttpRequest(input: {
  receivedRequests: ReceivedHttpRequest[];
  request: IncomingMessage;
  response: ServerResponse;
  waitingResolvers: Array<(request: ReceivedHttpRequest) => void>;
}): void {
  const chunks: Buffer[] = [];
  input.request.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  input.request.on("end", () => {
    const receivedRequest = {
      body: Buffer.concat(chunks).toString("utf8"),
      headers: input.request.headers,
      method: input.request.method ?? "",
      url: input.request.url ?? "",
    };
    const resolver = input.waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(receivedRequest);
    } else {
      input.receivedRequests.push(receivedRequest);
    }
    input.response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
    });
    input.response.write("stream-start");
  });
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

function createWebSocketMessageQueue(socket: WebSocket): WebSocketMessageQueue {
  const queuedMessages: EgressTransportMessage[] = [];
  const waitingResolvers: Array<(message: EgressTransportMessage) => void> = [];

  const onMessage = (data: RawData, isBinary: boolean): void => {
    if (isBinary) {
      throw new Error("Expected text websocket payload.");
    }

    const message = parseTransportMessage(toBuffer(data).toString("utf8"));
    const waitingResolver = waitingResolvers.shift();
    if (waitingResolver !== undefined) {
      waitingResolver(message);
      return;
    }

    queuedMessages.push(message);
  };

  socket.on("message", onMessage);

  return {
    close: () => {
      socket.off("message", onMessage);
    },
    next: async () => {
      const queuedMessage = queuedMessages.shift();
      if (queuedMessage !== undefined) {
        return queuedMessage;
      }

      return await new Promise<EgressTransportMessage>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

function parseTransportMessage(input: string): EgressTransportMessage {
  const parsedMessage = parseEgressTransportMessage(input);
  if (parsedMessage === undefined) {
    throw new Error("Expected egress transport message.");
  }

  return parsedMessage;
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

async function withTimeout<T>(input: {
  label: string;
  promise: Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  let timeoutHandle: TimerHandle | undefined;

  try {
    return await Promise.race([
      input.promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = systemScheduler.schedule(() => {
          reject(
            new Error(
              `${input.label} timed out after ${String(input.timeoutMs ?? StepTimeoutMs)}ms.`,
            ),
          );
        }, input.timeoutMs ?? StepTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      systemScheduler.cancel(timeoutHandle);
    }
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected simulated upstream to listen on a TCP port."));
        return;
      }

      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
