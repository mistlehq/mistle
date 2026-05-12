/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  IntegrationBindingKinds,
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
} from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  AwsConnectionMethodIds,
  AwsCredentialResolverKeys,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
} from "@mistle/integrations-definitions";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import {
  PayloadKindRawBytes,
  decodeDataFrame,
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
  createGitHubIdentityConnection,
  insertPrincipalCredentialSecret,
  seedGitHubLinkedPrincipal,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
} from "../../control-plane-api/integration/helpers/identity-linking.js";
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
  services: ["control-plane-api", "data-plane-api", "data-plane-gateway"],
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
    "resolves integration credentials for matched managed routes before forwarding upstream",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedHttpUpstream();
      const binding = await createDatadogBinding({
        env,
        uniqueId: randomUUID().replaceAll("-", ""),
      });
      const upstreamUrl = new URL("/mcp", upstream.baseUrl);
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              additionalCredentialHeaders: [
                {
                  header: "dd_application_key",
                  credentialResolver: {
                    kind: "integration_connection",
                    connectionId: binding.connectionId,
                    secretType: "api_key",
                    slotKey: "datadog.datadog-default.api-key.application-key",
                  },
                },
              ],
              authInjection: {
                type: "header",
                target: "dd_api_key",
              },
              bindingId: binding.bindingId,
              connectionId: binding.connectionId,
              egressRuleId: "egress_rule_datadog",
              familyId: "datadog",
              hosts: [upstreamUrl.hostname],
              pathPrefixes: ["/mcp"],
              methods: ["POST"],
              secretType: "api_key",
              slotKey: "datadog.datadog-default.api-key.api-key",
              upstreamBaseUrl: upstream.baseUrl,
              variantId: "datadog-default",
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
              scheme: "http",
              authority: upstreamUrl.host,
              path: "/mcp",
              headers: {
                "content-type": ["text/plain"],
                "x-sandbox-header": ["preserved"],
              },
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 20,
            bytes: Buffer.from("managed-body", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 20,
          }),
        );

        const request = await withTimeout({
          label: "waiting for managed egress upstream request",
          promise: upstream.nextRequest(),
        });

        expect(request.method).toBe("POST");
        expect(request.url).toBe("/mcp");
        expect(request.body).toBe("managed-body");
        expect(request.headers["dd_api_key"]).toBe("datadog-api-key");
        expect(request.headers["dd_application_key"]).toBe("datadog-application-key");
        expect(request.headers["x-sandbox-header"]).toBe("preserved");

        await expect(
          withTimeout({
            label: "waiting for managed route response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 20,
          status: 202,
          headers: expect.objectContaining({
            "content-type": ["text/plain; charset=utf-8"],
            "x-upstream-marker": ["simulated-http"],
          }),
        });
        await expect(
          withTimeout({
            label: "waiting for managed route response body",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.chunk",
          streamId: 20,
          bytes: Buffer.from("hello from upstream", "utf8").toString("base64"),
          encoding: "base64",
        });
        await expect(
          withTimeout({
            label: "waiting for managed route response end",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.body.end",
          streamId: 20,
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
    "resolves linked-principal credentials for matched managed routes before forwarding upstream",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedHttpUpstream();
      const uniqueId = randomUUID().replaceAll("-", "");
      const linkedPrincipal = await createGitHubLinkedPrincipal({
        env,
        uniqueId,
      });
      const upstreamUrl = new URL("/linked", upstream.baseUrl);
      await insertSandboxInstanceRow({
        env,
        organizationId: linkedPrincipal.organizationId,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              authInjection: {
                type: "bearer",
                target: "authorization",
              },
              bindingId: `ibd_${uniqueId}_github_linked`,
              credentialResolver: {
                kind: "linked_principal",
                providerFamily: "github",
                actingUserRequired: true,
                resolutionMode: "required",
                credentialKind: "github_app_user_access_token",
              },
              egressRuleId: "egress_rule_github_linked_success",
              familyId: "github",
              hosts: [upstreamUrl.hostname],
              methods: ["GET"],
              pathPrefixes: ["/linked"],
              upstreamBaseUrl: upstream.baseUrl,
              variantId: "github-cloud",
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
            requestId: "req_gateway_egress_linked_principal_success",
            streamId: 24,
            request: {
              method: "GET",
              scheme: "http",
              authority: upstreamUrl.host,
              path: "/linked",
              actingUserId: linkedPrincipal.userId,
              headers: {},
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 24,
          }),
        );

        const request = await withTimeout({
          label: "waiting for linked-principal managed egress upstream request",
          promise: upstream.nextRequest(),
        });

        expect(request.method).toBe("GET");
        expect(request.url).toBe("/linked");
        expect(request.headers.authorization).toBe("Bearer ghu-gateway-egress-linked-token");

        await expect(
          withTimeout({
            label: "waiting for linked-principal response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toMatchObject({
          type: "egress.http.response.start",
          streamId: 24,
          status: 202,
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
    "signs matched AWS SigV4 managed routes with resolved session credentials",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedHttpUpstream();
      const simulatedSts = await startSimulatedAwsSts();
      const uniqueId = randomUUID().replaceAll("-", "");
      const binding = await createAwsEgressBinding({
        env,
        uniqueId,
        stsEndpointUrl: simulatedSts.baseUrl,
      });
      const upstreamUrl = new URL("/", upstream.baseUrl);
      await insertSandboxInstanceRow({
        env,
        organizationId: binding.organizationId,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              authInjection: {
                type: "aws_sigv4",
                service: "secretsmanager",
                region: "us-east-1",
              },
              bindingId: binding.bindingId,
              connectionId: binding.connectionId,
              egressRuleId: "egress_rule_aws_sigv4",
              familyId: "aws",
              hosts: [upstreamUrl.hostname],
              methods: ["POST"],
              pathPrefixes: ["/"],
              secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
              slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
              resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
              upstreamBaseUrl: upstream.baseUrl,
              variantId: "aws-cli-default",
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
            requestId: "req_gateway_egress_aws_sigv4",
            streamId: 25,
            request: {
              method: "POST",
              scheme: "http",
              authority: upstreamUrl.host,
              path: "/",
              headers: {
                "content-type": ["application/json"],
              },
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 25,
            bytes: Buffer.from(JSON.stringify({ requestIndex: 1 }), "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 25,
          }),
        );

        const request = await withTimeout({
          label: "waiting for AWS SigV4 managed egress upstream request",
          promise: upstream.nextRequest(),
        });
        const authorizationHeader = request.headers.authorization;

        expect(typeof authorizationHeader).toBe("string");
        expect(authorizationHeader).toContain("AWS4-HMAC-SHA256");
        expect(authorizationHeader).toContain("Credential=ASIAEXAMPLEACCESS/");
        expect(authorizationHeader).toContain("/us-east-1/secretsmanager/aws4_request");
        expect(authorizationHeader).toContain("SignedHeaders=");
        expect(authorizationHeader).toContain("host");
        expect(authorizationHeader).toContain("x-amz-content-sha256");
        expect(authorizationHeader).toContain("x-amz-date");
        expect(authorizationHeader).toContain("x-amz-security-token");
        expect(request.headers["x-amz-security-token"]).toBe("example-session-token");
        expect(request.headers["x-amz-date"]).toBeDefined();
        expect(request.headers["x-amz-content-sha256"]).toBeDefined();
        expect(simulatedSts.assumeRoleRequests()).toEqual([
          expect.objectContaining({
            roleArn: "arn:aws:iam::123456789012:role/mistle-integration-new",
          }),
        ]);
        expect(simulatedSts.assumeRoleRequests()[0]?.roleSessionName).toMatch(/^mistle-/u);

        await expect(
          withTimeout({
            label: "waiting for AWS SigV4 response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toMatchObject({
          type: "egress.http.response.start",
          streamId: 25,
          status: 202,
        });
      } finally {
        messageQueue.close();
        await closeIfOpen(bootstrapSocket);
        await Promise.all([upstream.close(), simulatedSts.stop()]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "applies managed route request middleware before forwarding upstream",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedHttpUpstream();
      const binding = await createDatadogBinding({
        env,
        uniqueId: randomUUID().replaceAll("-", ""),
      });
      const upstreamUrl = new URL("/api/chat.postMessage", upstream.baseUrl);
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              authInjection: {
                type: "header",
                target: "authorization",
              },
              bindingId: binding.bindingId,
              connectionId: binding.connectionId,
              egressRuleId: "egress_rule_slack",
              familyId: "slack",
              hosts: [upstreamUrl.hostname],
              methods: ["POST"],
              pathPrefixes: ["/api/chat.postMessage"],
              requestMiddleware: ["append-session-link-to-slack-text"],
              secretType: "api_key",
              slotKey: "datadog.datadog-default.api-key.api-key",
              upstreamBaseUrl: upstream.baseUrl,
              variantId: "slack-default",
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
            requestId: "req_gateway_egress_request_middleware",
            streamId: 23,
            request: {
              method: "POST",
              scheme: "http",
              authority: upstreamUrl.host,
              path: "/api/chat.postMessage",
              headers: {
                "content-type": ["application/json"],
              },
            },
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.chunk",
            streamId: 23,
            bytes: Buffer.from(
              JSON.stringify({ channel: "C123", text: "hello from gateway" }),
              "utf8",
            ).toString("base64"),
            encoding: "base64",
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "egress.http.request.body.end",
            streamId: 23,
          }),
        );

        const request = await withTimeout({
          label: "waiting for request-middleware upstream request",
          promise: upstream.nextRequest(),
        });
        const body: unknown = JSON.parse(request.body);

        expect(request.method).toBe("POST");
        expect(request.url).toBe("/api/chat.postMessage");
        expect(request.headers.authorization).toBe("datadog-api-key");
        expect(body).toEqual({
          channel: "C123",
          text: expect.stringContaining(`/p/sessions/${sandboxInstanceId}`),
        });

        await expect(
          withTimeout({
            label: "waiting for request-middleware response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toMatchObject({
          type: "egress.http.response.start",
          streamId: 23,
          status: 202,
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
    "forwards matched managed HTTP upgrades with resolved credentials and sanitized proxy headers",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedUpgradeUpstream();
      const binding = await createDatadogBinding({
        env,
        uniqueId: randomUUID().replaceAll("-", ""),
      });
      const upstreamUrl = new URL("/managed-socket", upstream.baseUrl);
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              authInjection: {
                type: "header",
                target: "dd_api_key",
              },
              bindingId: binding.bindingId,
              connectionId: binding.connectionId,
              egressRuleId: "egress_rule_managed_websocket_datadog",
              familyId: "datadog",
              hosts: [upstreamUrl.hostname],
              pathPrefixes: [upstreamUrl.pathname],
              methods: ["GET"],
              secretType: "api_key",
              slotKey: "datadog.datadog-default.api-key.api-key",
              upstreamBaseUrl: upstream.baseUrl,
              variantId: "datadog-default",
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
            requestId: "req_gateway_egress_managed_upgrade",
            streamId: 13,
            request: {
              method: "GET",
              scheme: "http",
              authority: upstreamUrl.host,
              path: upstreamUrl.pathname,
              headers: {
                "cf-ray": ["ray-from-sandbox"],
                connection: ["Upgrade"],
                "proxy-authorization": ["Basic should-not-forward"],
                upgrade: ["websocket"],
                "sec-websocket-key": ["dGhlIHNhbXBsZSBub25jZQ=="],
                "sec-websocket-version": ["13"],
                "x-forwarded-for": ["203.0.113.10"],
              },
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

        const request = await withTimeout({
          label: "waiting for managed upgrade upstream request",
          promise: upstream.nextRequest(),
        });
        expect(request.method).toBe("GET");
        expect(request.url).toBe("/managed-socket");
        expect(request.headers.connection).toBe("Upgrade");
        expect(request.headers.upgrade).toBe("websocket");
        expect(request.headers.dd_api_key).toBe("datadog-api-key");
        expect(request.headers["cf-ray"]).toBeUndefined();
        expect(request.headers["proxy-authorization"]).toBeUndefined();
        expect(request.headers["x-forwarded-for"]).toBeUndefined();

        await expect(
          withTimeout({
            label: "waiting for managed egress upgrade response start",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.http.response.start",
          streamId: 13,
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
            streamId: 13,
            direction: "request",
            bytes: Buffer.from("managed-ping", "utf8").toString("base64"),
            encoding: "base64",
          }),
        );
        await expect(
          withTimeout({
            label: "waiting for managed egress upgraded response bytes",
            promise: messageQueue.next(),
          }),
        ).resolves.toEqual({
          type: "egress.tcp.data",
          streamId: 13,
          direction: "response",
          bytes: Buffer.from("echo:managed-ping", "utf8").toString("base64"),
          encoding: "base64",
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
  organizationId?: string;
  runtimePlan?: CompiledRuntimePlan;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId ?? "org_integration_gateway_egress_transport",
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
  additionalCredentialHeaders?: CompiledRuntimePlan["egressRoutes"][number]["additionalCredentialHeaders"];
  authInjection?: CompiledRuntimePlan["egressRoutes"][number]["authInjection"];
  bindingId?: string;
  connectionId?: string;
  credentialResolver?: CompiledRuntimePlan["egressRoutes"][number]["credentialResolver"];
  egressRuleId: string;
  familyId?: string;
  hosts: string[];
  pathPrefixes?: string[];
  methods?: string[];
  requestMiddleware?: CompiledRuntimePlan["egressRoutes"][number]["requestMiddleware"];
  resolverKey?: string;
  secretType?: string;
  slotKey?: string;
  upstreamBaseUrl?: string;
  variantId?: string;
}): CompiledRuntimePlan["egressRoutes"][number] {
  return {
    egressRuleId: input.egressRuleId,
    bindingId: input.bindingId ?? `bind_${input.egressRuleId}`,
    familyId: input.familyId ?? "openai",
    variantId: input.variantId ?? "openai-default",
    match: {
      hosts: input.hosts,
      ...(input.pathPrefixes === undefined ? {} : { pathPrefixes: input.pathPrefixes }),
      ...(input.methods === undefined ? {} : { methods: input.methods }),
    },
    upstream: {
      baseUrl: input.upstreamBaseUrl ?? `https://${input.hosts[0]}`,
    },
    authInjection: input.authInjection ?? {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId ?? "ic_openai",
      secretType: input.secretType ?? "api_token",
      ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
      ...(input.resolverKey === undefined ? {} : { resolverKey: input.resolverKey }),
    },
    ...(input.additionalCredentialHeaders === undefined
      ? {}
      : { additionalCredentialHeaders: input.additionalCredentialHeaders }),
    ...(input.credentialResolver === undefined
      ? {}
      : { credentialResolver: input.credentialResolver }),
    ...(input.requestMiddleware === undefined
      ? {}
      : { requestMiddleware: input.requestMiddleware }),
  };
}

async function createGitHubLinkedPrincipal(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
}): Promise<{
  organizationId: string;
  userId: string;
}> {
  const session = await input.env.auth.createSession({
    email: `${input.uniqueId}-github-linked-principal@example.com`,
  });
  const targetKey = `github_${input.uniqueId}`;

  await upsertGitHubIdentityTarget(input.env, {
    targetKey,
  });

  const connectionId = await createGitHubIdentityConnection(input.env, {
    displayName: "Gateway egress linked principal GitHub App",
    session,
    targetKey,
  });
  const providerConfigId = `ilp_${input.uniqueId}`;
  const principalId = `uep_${input.uniqueId}`;
  const credentialId = `upc_${input.uniqueId}`;

  await seedIdentityProviderConfig(input.env, {
    configId: providerConfigId,
    connectionId,
    organizationId: session.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey,
    userId: session.userId,
  });
  await seedGitHubLinkedPrincipal(input.env, {
    organizationId: session.organizationId,
    userId: session.userId,
    principalId,
    providerConfigId,
    connectionId,
    providerSubjectId: "12345",
    profile: {
      login: "mistle-user",
    },
  });
  await seedPrincipalCredential(input.env, {
    credentialId,
    organizationId: session.organizationId,
    principalId,
    providerFamily: "github",
    credentialKind: "github_app_user_access_token",
    accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });
  await insertPrincipalCredentialSecret(input.env, {
    organizationId: session.organizationId,
    credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
    plaintext: "ghu-gateway-egress-linked-token",
  });
  await insertPrincipalCredentialSecret(input.env, {
    organizationId: session.organizationId,
    credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
    plaintext: "ghr-gateway-egress-refresh-token",
  });

  return {
    organizationId: session.organizationId,
    userId: session.userId,
  };
}

async function createAwsEgressBinding(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
  stsEndpointUrl: string;
}): Promise<{
  bindingId: string;
  connectionId: string;
  organizationId: string;
}> {
  const session = await input.env.auth.createSession({
    email: `${input.uniqueId}-aws-egress@example.com`,
  });
  const targetKey = `aws_${input.uniqueId}`;
  const sandboxProfileId = `sbp_${input.uniqueId}_aws`;
  const bindingId = `ibd_${input.uniqueId}_aws`;

  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationTargets)
    .values({
      targetKey,
      familyId: "aws",
      variantId: "aws-cli-default",
      enabled: true,
      config: {
        sts_endpoint_url: input.stsEndpointUrl,
      },
    })
    .onConflictDoUpdate({
      target: input.env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: "aws",
        variantId: "aws-cli-default",
        enabled: true,
        config: {
          sts_endpoint_url: input.stsEndpointUrl,
        },
      },
    });

  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(targetKey)}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "Gateway egress AWS AssumeRole connection",
        methodId: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
        config: {
          connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-integration-new",
          durationSeconds: 3600,
        },
        secrets: {
          secretAccessKey: "aws-secret-access-key-value",
        },
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(`Expected AWS connection creation status 201, got ${String(response.status)}.`);
  }
  const connectionId = readConnectionId(await response.json());

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId: session.organizationId,
    displayName: "Gateway egress AWS integration profile",
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId,
      version: 1,
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: bindingId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      connectionId,
      kind: IntegrationBindingKinds.CONNECTOR,
      config: {
        services: ["secretsmanager"],
        regions: ["us-east-1"],
        defaultRegion: "us-east-1",
        tools: [],
      },
    });

  return {
    bindingId,
    connectionId,
    organizationId: session.organizationId,
  };
}

async function createDatadogBinding(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
}): Promise<{
  bindingId: string;
  connectionId: string;
}> {
  const session = await input.env.auth.createSession({
    email: `${input.uniqueId}@example.com`,
  });
  const targetKey = `datadog_${input.uniqueId}`;
  const bindingId = `ibd_${input.uniqueId}`;
  const sandboxProfileId = `sbp_${input.uniqueId}`;
  const connectionId = await createDatadogConnection({
    cookie: session.cookie,
    env: input.env,
    targetKey,
  });

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId: session.organizationId,
    displayName: "Gateway egress Datadog integration profile",
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId,
      version: 1,
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: bindingId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      connectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {},
    });

  return {
    bindingId,
    connectionId,
  };
}

async function createDatadogConnection(input: {
  cookie: string;
  env: IntegrationTestEnvironment;
  targetKey: string;
}): Promise<string> {
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "datadog",
      variantId: "datadog-default",
      enabled: true,
      config: {},
    })
    .onConflictDoUpdate({
      target: input.env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: "datadog",
        variantId: "datadog-default",
        enabled: true,
        config: {},
      },
    });

  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${input.targetKey}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({
        displayName: "Gateway egress Datadog connection",
        methodId: "api-key",
        config: {
          connection_method: "api-key",
        },
        secrets: {
          apiKey: "datadog-api-key",
          applicationKey: "datadog-application-key",
        },
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(
      `Expected Datadog connection creation status 201, got ${String(response.status)}.`,
    );
  }

  return readConnectionId(await response.json());
}

function readConnectionId(responseBody: unknown): string {
  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "id" in responseBody &&
    typeof responseBody.id === "string"
  ) {
    return responseBody.id;
  }

  throw new Error("Expected integration connection response body to include id.");
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

type SimulatedAwsAssumeRoleRequest = {
  roleArn: string;
  roleSessionName: string;
};

async function startSimulatedAwsSts(): Promise<{
  baseUrl: string;
  assumeRoleRequests: () => SimulatedAwsAssumeRoleRequest[];
  stop: () => Promise<void>;
}> {
  const assumeRoleRequests: SimulatedAwsAssumeRoleRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/") {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      const body = new URLSearchParams(await readRequestBody(request));
      const action = body.get("Action");
      const roleArn = body.get("RoleArn");
      const roleSessionName = body.get("RoleSessionName");
      if (action !== "AssumeRole" || roleArn === null || roleSessionName === null) {
        response.statusCode = 400;
        response.end("invalid AssumeRole request");
        return;
      }

      assumeRoleRequests.push({
        roleArn,
        roleSessionName,
      });

      // AWS STS uses the Query API. `AssumeRole` returns temporary credentials
      // under `AssumeRoleResult/Credentials`.
      // Source: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
      response.statusCode = 200;
      response.setHeader("content-type", "text/xml");
      response.end(`<?xml version="1.0" encoding="UTF-8"?>
<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleResult>
    <Credentials>
      <AccessKeyId>ASIAEXAMPLEACCESS</AccessKeyId>
      <SecretAccessKey>example-secret-access-key</SecretAccessKey>
      <SessionToken>example-session-token</SessionToken>
      <Expiration>2099-01-01T00:00:00Z</Expiration>
    </Credentials>
  </AssumeRoleResult>
  <ResponseMetadata>
    <RequestId>gateway-egress-aws-sts</RequestId>
  </ResponseMetadata>
</AssumeRoleResponse>`);
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain");
      response.end(error instanceof Error ? error.message : "simulated AWS STS failed");
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    assumeRoleRequests: () => [...assumeRoleRequests],
    stop: async () => {
      await closeServer(server);
    },
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk, "utf8"));
      continue;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
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
    const message = isBinary
      ? parseBinaryEgressBodyFrame(toBuffer(data))
      : parseTransportMessage(toBuffer(data).toString("utf8"));
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

function parseBinaryEgressBodyFrame(data: Buffer): EgressTransportMessage {
  const frame = decodeDataFrame(data);
  if (frame.payloadKind !== PayloadKindRawBytes) {
    throw new Error(
      `Expected binary egress body frame to use raw-bytes payload kind, received ${String(frame.payloadKind)}.`,
    );
  }

  return {
    type: "egress.http.response.body.chunk",
    streamId: frame.streamId,
    bytes: Buffer.from(frame.payload).toString("base64"),
    encoding: "base64",
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
