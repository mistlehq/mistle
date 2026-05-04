/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { gzipSync } from "node:zlib";

import {
  IntegrationBindingKinds,
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  AwsConnectionMethodIds,
  AwsCredentialResolverKeys,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
  DatadogCredentialSecretTypes,
  DatadogCredentialSlotKeys,
  SlackConnectionMethodIds,
  SlackCredentialSecretTypes,
  SlackCredentialSlotKeys,
} from "@mistle/integrations-definitions";
import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
import { reserveAvailablePort, startHttpEcho } from "@mistle/test-harness";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  createGitHubIdentityConnection,
  insertPrincipalCredentialSecret,
  seedGitHubLinkedPrincipal,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
} from "../../control-plane-api/integration-new/helpers/identity-linking.js";
import { EgressRequestHeaders } from "../src/egress/constants.js";

const EgressGrantConfig = {
  tokenSecret: "integration-new-egress-token-secret",
  tokenIssuer: "integration-new-data-plane-worker",
  tokenAudience: "integration-new-tokenizer-proxy",
} as const;
const WebSocketAcceptGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SlackAppendSessionLinkMiddlewareId = "append-session-link-to-slack-text";

const it = createIntegrationTest({
  services: ["control-plane-api", "tokenizer-proxy"],
});

describe.concurrent("tokenizer proxy egress credentials", () => {
  it("resolves connection credentials through the real control-plane API", async ({ env }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });

      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: binding.bindingId,
          organizationId: binding.organizationId,
          familyId: "datadog",
          variantId: "datadog-default",
          credentialResolverKind: "integration_connection",
          connectionId: binding.connectionId,
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "header",
          authInjectionTarget: "dd_api_key",
          additionalCredentialHeaders: [
            {
              header: "dd_application_key",
              credentialResolver: {
                kind: "integration_connection",
                connectionId: binding.connectionId,
                secretType: DatadogCredentialSecretTypes.API_KEY,
                slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
              },
            },
          ],
          allowedMethods: ["GET"],
          allowedPathPrefixes: ["/mcp"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/mcp", {
        method: "GET",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
        },
      });
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoHeader(body, "dd_api_key")).toBe("datadog-api-key");
      expect(readEchoHeader(body, "dd_application_key")).toBe("datadog-application-key");
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("resolves linked-principal credentials through the real control-plane API", async ({
    env,
  }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const linkedPrincipal = await createGitHubLinkedPrincipal({
        env,
        uniqueId,
      });
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: `ibd_${uniqueId}`,
          organizationId: linkedPrincipal.organizationId,
          familyId: "github",
          variantId: "github-cloud",
          actingUserId: linkedPrincipal.userId,
          credentialResolverKind: "linked_principal",
          providerFamily: "github",
          actingUserRequired: true,
          resolutionMode: "required",
          credentialKind: "github_app_user_access_token",
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "bearer",
          authInjectionTarget: "authorization",
          allowedMethods: ["GET"],
          allowedPathPrefixes: ["/linked"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/linked", {
        method: "GET",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
        },
      });
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoHeader(body, "authorization")).toBe("Bearer ghu-integration-new-token");
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("selects linked-principal credentials for GitHub pull request creation", async ({ env }) => {
    const upstreamEchoService = await startHttpEcho();
    const simulatedGitHub = await startSimulatedGitHubAppApi({
      installationToken: "ghs-installation-token-should-not-be-used",
    });
    const uniqueId = createUniqueId();

    try {
      const binding = await createGitHubAppEgressBinding({
        env,
        uniqueId,
        apiBaseUrl: simulatedGitHub.baseUrl,
        installationId: "10001",
        linkedPrincipalAccessToken: "ghu-pr-creation-token",
      });
      const egressGrant = await mintGitHubInstallationEgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamEchoService.baseUrl,
        actingUserId: binding.userId,
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/repos/mistlehq/mistle/pulls",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "Add identity linking",
            head: "mistlehq:feature/identity-linking",
            base: "main",
          }),
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoHeader(body, "authorization")).toBe("Bearer ghu-pr-creation-token");
      expect(simulatedGitHub.installationAccessTokenRequests()).toEqual([]);
    } finally {
      await Promise.all([upstreamEchoService.stop(), simulatedGitHub.stop()]);
    }
  });

  it("falls back to GitHub installation credentials when linked-principal resolution misses", async ({
    env,
  }) => {
    const upstreamEchoService = await startHttpEcho();
    const simulatedGitHub = await startSimulatedGitHubAppApi({
      installationToken: "ghs-installation-fallback-token",
    });
    const uniqueId = createUniqueId();

    try {
      const binding = await createGitHubAppEgressBinding({
        env,
        uniqueId,
        apiBaseUrl: simulatedGitHub.baseUrl,
        installationId: "10002",
      });
      const egressGrant = await mintGitHubInstallationEgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamEchoService.baseUrl,
        actingUserId: binding.userId,
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/repos/mistlehq/mistle/pulls",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "Add identity linking",
            head: "mistlehq:feature/identity-linking",
            base: "main",
          }),
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoHeader(body, "authorization")).toBe("Bearer ghs-installation-fallback-token");
      expect(simulatedGitHub.installationAccessTokenRequests()).toEqual([
        {
          installationId: "10002",
        },
      ]);
    } finally {
      await Promise.all([upstreamEchoService.stop(), simulatedGitHub.stop()]);
    }
  });

  it("uses GitHub installation credentials when pull request egress lacks an acting user", async ({
    env,
  }) => {
    const upstreamEchoService = await startHttpEcho();
    const simulatedGitHub = await startSimulatedGitHubAppApi({
      installationToken: "ghs-installation-no-actor-token",
    });
    const uniqueId = createUniqueId();

    try {
      const binding = await createGitHubAppEgressBinding({
        env,
        uniqueId,
        apiBaseUrl: simulatedGitHub.baseUrl,
        installationId: "10003",
        linkedPrincipalAccessToken: "ghu-should-not-be-selected-without-actor",
      });
      const egressGrant = await mintGitHubInstallationEgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamEchoService.baseUrl,
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/repos/mistlehq/mistle/pulls",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "Add identity linking",
            head: "mistlehq:feature/identity-linking",
            base: "main",
          }),
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoHeader(body, "authorization")).toBe("Bearer ghs-installation-no-actor-token");
      expect(simulatedGitHub.installationAccessTokenRequests()).toEqual([
        {
          installationId: "10003",
        },
      ]);
    } finally {
      await Promise.all([upstreamEchoService.stop(), simulatedGitHub.stop()]);
    }
  });

  it("signs AWS SigV4 requests with temporary session credentials from real control-plane resolution", async ({
    env,
  }) => {
    const upstreamEchoService = await startHttpEcho();
    const simulatedSts = await startSimulatedAwsSts();
    const uniqueId = createUniqueId();

    try {
      const binding = await createAwsEgressBinding({
        env,
        uniqueId,
        stsEndpointUrl: simulatedSts.baseUrl,
      });
      const egressGrant = await mintAwsSigV4EgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamEchoService.baseUrl,
        service: "secretsmanager",
      });

      for (const requestIndex of [1, 2]) {
        const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/", {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requestIndex,
          }),
        });
        const body: unknown = await response.json();
        const authorizationHeader = readEchoHeader(body, "authorization");

        expect(response.status).toBe(200);
        if (authorizationHeader === undefined) {
          throw new Error("Expected SigV4 authorization header.");
        }
        expect(authorizationHeader).toContain("AWS4-HMAC-SHA256");
        expect(authorizationHeader).toContain("Credential=ASIAEXAMPLEACCESS/");
        expect(authorizationHeader).toContain("/us-east-1/secretsmanager/aws4_request");
        expect(authorizationHeader).toContain("SignedHeaders=");
        expect(authorizationHeader).toContain("host");
        expect(authorizationHeader).toContain("x-amz-content-sha256");
        expect(authorizationHeader).toContain("x-amz-date");
        expect(authorizationHeader).toContain("x-amz-security-token");
        expect(readEchoHeader(body, "x-amz-security-token")).toBe("example-session-token");
        expect(readEchoHeader(body, "x-amz-date")).toBeDefined();
        expect(readEchoHeader(body, "x-amz-content-sha256")).toBeDefined();
      }

      expect(simulatedSts.assumeRoleRequests()).toEqual([
        expect.objectContaining({
          roleArn: "arn:aws:iam::123456789012:role/mistle-integration-new",
        }),
      ]);
      expect(simulatedSts.assumeRoleRequests()[0]?.roleSessionName).toMatch(/^mistle-/u);
    } finally {
      await Promise.all([upstreamEchoService.stop(), simulatedSts.stop()]);
    }
  });

  it("forwards requests with resolved credentials, grant headers, and sanitized proxy headers", async ({
    env,
  }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: binding.bindingId,
          organizationId: binding.organizationId,
          familyId: "datadog",
          variantId: "datadog-default",
          credentialResolverKind: "integration_connection",
          connectionId: binding.connectionId,
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "header",
          authInjectionTarget: "dd_api_key",
          additionalHeaders: {
            "chatgpt-account-id": "acct_from_grant",
          },
          allowedMethods: ["POST"],
          allowedPathPrefixes: ["/mcp"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/mcp/search?limit=10",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
            "chatgpt-account-id": "acct_from_request",
            "cf-ray": "test-cf-ray",
            "cdn-loop": "cloudflare; loops=1",
            forwarded: "for=203.0.113.1;proto=https",
            "x-forwarded-for": "203.0.113.1",
            "x-forwarded-proto": "https",
            "x-real-ip": "203.0.113.1",
          },
          body: JSON.stringify({ query: "integration-new" }),
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoString(body, "method")).toBe("POST");
      expect(readEchoString(body, "path")).toBe("/mcp/search");
      expect(readEchoHeader(body, "dd_api_key")).toBe("datadog-api-key");
      expect(readEchoHeader(body, "chatgpt-account-id")).toBe("acct_from_grant");
      expect(readEchoHeader(body, "cf-ray")).toBeUndefined();
      expect(readEchoHeader(body, "cdn-loop")).toBeUndefined();
      expect(readEchoHeader(body, "forwarded")).toBeUndefined();
      expect(readEchoHeader(body, "x-forwarded-for")).toBeUndefined();
      expect(readEchoHeader(body, "x-forwarded-proto")).toBeUndefined();
      expect(readEchoHeader(body, "x-real-ip")).toBeUndefined();
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("injects basic auth with an explicit username", async ({ env }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: binding.bindingId,
          organizationId: binding.organizationId,
          familyId: "datadog",
          variantId: "datadog-default",
          credentialResolverKind: "integration_connection",
          connectionId: binding.connectionId,
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "basic",
          authInjectionTarget: "authorization",
          authInjectionUsername: "x-access-token",
          allowedMethods: ["GET"],
          allowedPathPrefixes: ["/mistlehq/mistle.git"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/mistlehq/mistle.git/info/refs?service=git-upload-pack",
        {
          method: "GET",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "x-mistle-egress-connection-id": "icn_forged",
            "x-mistle-egress-upstream-base-url": "https://attacker.invalid",
          },
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoString(body, "method")).toBe("GET");
      expect(readEchoString(body, "path")).toBe("/mistlehq/mistle.git/info/refs");
      expect(readEchoHeader(body, "authorization")).toBe(
        "Basic eC1hY2Nlc3MtdG9rZW46ZGF0YWRvZy1hcGkta2V5",
      );
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("applies production request middleware before forwarding Slack egress", async ({ env }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const binding = await createSlackBinding({
        env,
        uniqueId,
      });
      const sandboxInstanceId = `sbi_${uniqueId}`;
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: sandboxInstanceId,
          jti: `egress_rule_${uniqueId}`,
          bindingId: binding.bindingId,
          organizationId: binding.organizationId,
          familyId: "slack",
          variantId: "slack-default",
          credentialResolverKind: "integration_connection",
          connectionId: binding.connectionId,
          secretType: SlackCredentialSecretTypes.API_KEY,
          slotKey: SlackCredentialSlotKeys.BOT_TOKEN,
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "bearer",
          authInjectionTarget: "authorization",
          requestMiddleware: [SlackAppendSessionLinkMiddlewareId],
          allowedMethods: ["POST"],
          allowedPathPrefixes: ["/api/chat.postMessage"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/api/chat.postMessage",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: "hello from integration-new" }),
        },
      );
      const body: unknown = await response.json();
      const forwardedBody = parseJsonRecord(readEchoString(body, "body"));

      expect(response.status).toBe(200);
      expect(readEchoHeader(body, "authorization")).toBe("Bearer xoxb-integration-new-slack");
      expect(forwardedBody["text"]).toBe(
        `hello from integration-new\n\n──────────\n<${env.controlPlaneApi.hostBaseUrl}/p/sessions/${sandboxInstanceId}|🔗 View session>`,
      );
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("continues forwarding when request middleware cannot be resolved", async ({ env }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintDatadogEgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamEchoService.baseUrl,
        authInjectionType: "bearer",
        authInjectionTarget: "authorization",
        requestMiddleware: ["missing-session-link-middleware"],
        allowedMethods: ["POST"],
        allowedPathPrefixes: ["/repos/mistlehq/mistle/issues/123/comments"],
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/repos/mistlehq/mistle/issues/123/comments",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "text/plain",
          },
          body: "comment without resolved middleware",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoString(body, "method")).toBe("POST");
      expect(readEchoString(body, "path")).toBe("/repos/mistlehq/mistle/issues/123/comments");
      expect(readEchoString(body, "body")).toBe("comment without resolved middleware");
      expect(readEchoHeader(body, "authorization")).toBe("Bearer datadog-api-key");
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("continues forwarding when production request middleware throws", async ({ env }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const binding = await createSlackBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: binding.bindingId,
          organizationId: binding.organizationId,
          familyId: "slack",
          variantId: "slack-default",
          credentialResolverKind: "integration_connection",
          connectionId: binding.connectionId,
          secretType: SlackCredentialSecretTypes.API_KEY,
          slotKey: SlackCredentialSlotKeys.BOT_TOKEN,
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "bearer",
          authInjectionTarget: "authorization",
          requestMiddleware: [SlackAppendSessionLinkMiddlewareId],
          allowedMethods: ["POST"],
          allowedPathPrefixes: ["/api/chat.postMessage"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/api/chat.postMessage",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: "not-json",
        },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoString(body, "method")).toBe("POST");
      expect(readEchoString(body, "path")).toBe("/api/chat.postMessage");
      expect(readEchoString(body, "body")).toBe("not-json");
      expect(readEchoHeader(body, "authorization")).toBe("Bearer xoxb-integration-new-slack");
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("returns a trace-correlated gateway error when credential resolution fails", async ({
    env,
  }) => {
    const upstreamEchoService = await startHttpEcho();
    const uniqueId = createUniqueId();

    try {
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: `ibd_${uniqueId}`,
          organizationId: `org_${uniqueId}`,
          familyId: "datadog",
          variantId: "datadog-default",
          credentialResolverKind: "integration_connection",
          connectionId: `icn_${uniqueId}`,
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "header",
          authInjectionTarget: "dd_api_key",
          allowedMethods: ["GET"],
          allowedPathPrefixes: ["/mcp"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/mcp", {
        method: "GET",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
        },
      });

      await expectProxyErrorResponse(response, {
        status: 502,
        code: "CREDENTIAL_RESOLUTION_FAILED",
        message: "Failed to resolve outbound credential.",
      });
    } finally {
      await upstreamEchoService.stop();
    }
  });

  it("returns a trace-correlated gateway error when the upstream connection fails", async ({
    env,
  }) => {
    const host = "127.0.0.1";
    const upstreamPort = await reserveAvailablePort({ host });
    const uniqueId = createUniqueId();
    const binding = await createDatadogBinding({
      env,
      uniqueId,
    });
    const egressGrant = await mintDatadogEgressGrant({
      binding,
      jti: `egress_rule_${uniqueId}`,
      upstreamBaseUrl: `http://${host}:${String(upstreamPort)}`,
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      additionalHeaders: {
        "chatgpt-account-id": "acct_from_grant",
      },
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/backend-api/codex"],
    });

    const response = await env.tokenizerProxy.http.fetch(
      "/tokenizer-proxy/egress/backend-api/codex/responses",
      {
        method: "POST",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-5", input: "hello" }),
      },
    );

    await expectProxyErrorResponse(response, {
      status: 502,
      code: "UPSTREAM_REQUEST_FAILED",
      message: "Failed to forward request to upstream.",
    });
    expect(response.headers.get("x-mistle-upstream-body-stream-state")).toBe("errored");
  });

  it("strips stale compression headers after forwarding a decompressed upstream body", async ({
    env,
  }) => {
    const upstreamService = await startGzipUpstream({
      host: "127.0.0.1",
      path: "/graphql",
      body: JSON.stringify({ data: { viewer: { login: "mistle-bot" } } }),
    });
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintDatadogEgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamService.baseUrl,
        authInjectionType: "header",
        authInjectionTarget: "dd_api_key",
        allowedMethods: ["POST"],
        allowedPathPrefixes: ["/graphql"],
      });

      const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/graphql", {
        method: "POST",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
        },
        body: JSON.stringify({ query: "{ viewer { login } }" }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("content-length")).toBeNull();
      await expect(response.json()).resolves.toEqual({
        data: {
          viewer: {
            login: "mistle-bot",
          },
        },
      });
    } finally {
      await upstreamService.stop();
    }
  });

  it("adds proxy correlation headers while forwarding streamed upstream responses", async ({
    env,
  }) => {
    const upstreamService = await startStreamingUpstream({
      host: "127.0.0.1",
      path: "/backend-api/codex/responses",
      chunks: ["data: first\n\n", "data: second\n\n"],
      headers: {
        "x-request-id": "req_integration_new_stream",
        "openai-model": "gpt-5",
      },
    });
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintDatadogEgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamService.baseUrl,
        authInjectionType: "bearer",
        authInjectionTarget: "authorization",
        additionalHeaders: {
          "chatgpt-account-id": "acct_from_grant",
        },
        allowedMethods: ["POST"],
        allowedPathPrefixes: ["/backend-api/codex"],
      });

      const response = await env.tokenizerProxy.http.fetch(
        "/tokenizer-proxy/egress/backend-api/codex/responses",
        {
          method: "POST",
          headers: {
            [EgressRequestHeaders.GRANT]: egressGrant,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: "gpt-5", stream: true, input: "hello" }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("data: first\n\ndata: second\n\n");
      expect(response.headers.get("x-mistle-trace-id")).toMatch(/^[0-9a-f]{32}$/u);
      expect(response.headers.get("x-mistle-upstream-status")).toBe("200");
      expect(response.headers.get("x-mistle-upstream-body-stream-state")).toBe("streaming");
      expect(response.headers.get("x-request-id")).toBe("req_integration_new_stream");
      expect(response.headers.get("openai-model")).toBe("gpt-5");
    } finally {
      await upstreamService.stop();
    }
  });

  it("forwards websocket upgrades with resolved credentials and sanitized proxy headers", async ({
    env,
  }) => {
    const upstreamService = await startWebSocketUpstream({
      host: "127.0.0.1",
      path: "/v1/responses?stream=true",
    });
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintDatadogEgressGrant({
        binding,
        jti: `egress_rule_${uniqueId}`,
        upstreamBaseUrl: upstreamService.baseUrl,
        authInjectionType: "bearer",
        authInjectionTarget: "authorization",
        additionalHeaders: {
          "chatgpt-account-id": "acct_from_grant",
        },
        allowedMethods: ["GET"],
        allowedPathPrefixes: ["/v1"],
      });

      const message = await performUpgradeRequest({
        baseUrl: env.tokenizerProxy.hostBaseUrl,
        path: "/tokenizer-proxy/egress/v1/responses?stream=true",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
          [TestEnvironmentIdHeader]: env.id,
          "chatgpt-account-id": "acct_from_request",
          "cf-ray": "test-cf-ray",
          "cdn-loop": "cloudflare; loops=1",
          forwarded: "for=203.0.113.1;proto=https",
          "x-forwarded-for": "203.0.113.1",
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.1",
        },
      });

      expect(message).toBe("pong\n");
      expect(upstreamService.capturedAuthorizationHeader()).toBe("Bearer datadog-api-key");
      expect(upstreamService.capturedHeader("chatgpt-account-id")).toBe("acct_from_grant");
      expect(upstreamService.capturedHeader("cf-ray")).toBeUndefined();
      expect(upstreamService.capturedHeader("cdn-loop")).toBeUndefined();
      expect(upstreamService.capturedHeader("forwarded")).toBeUndefined();
      expect(upstreamService.capturedHeader("x-forwarded-for")).toBeUndefined();
      expect(upstreamService.capturedHeader("x-forwarded-proto")).toBeUndefined();
      expect(upstreamService.capturedHeader("x-real-ip")).toBeUndefined();
    } finally {
      await upstreamService.stop();
    }
  });

  it("resolves linked-principal credentials for websocket upgrades", async ({ env }) => {
    const upstreamService = await startWebSocketUpstream({
      host: "127.0.0.1",
      path: "/linked-ws",
    });
    const uniqueId = createUniqueId();

    try {
      const linkedPrincipal = await createGitHubLinkedPrincipal({
        env,
        uniqueId,
      });
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: `ibd_${uniqueId}`,
          organizationId: linkedPrincipal.organizationId,
          familyId: "github",
          variantId: "github-cloud",
          actingUserId: linkedPrincipal.userId,
          credentialResolverKind: "linked_principal",
          providerFamily: "github",
          actingUserRequired: true,
          resolutionMode: "required",
          credentialKind: "github_app_user_access_token",
          upstreamBaseUrl: upstreamService.baseUrl,
          authInjectionType: "bearer",
          authInjectionTarget: "authorization",
          allowedMethods: ["GET"],
          allowedPathPrefixes: ["/linked-ws"],
        },
        ttlSeconds: 60,
      });

      const message = await performUpgradeRequest({
        baseUrl: env.tokenizerProxy.hostBaseUrl,
        path: "/tokenizer-proxy/egress/linked-ws",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
          [TestEnvironmentIdHeader]: env.id,
        },
      });

      expect(message).toBe("pong\n");
      expect(upstreamService.capturedAuthorizationHeader()).toBe(
        "Bearer ghu-integration-new-token",
      );
    } finally {
      await upstreamService.stop();
    }
  });

  it("adds additional credential-backed headers to websocket upgrades", async ({ env }) => {
    const upstreamService = await startWebSocketUpstream({
      host: "127.0.0.1",
      path: "/mcp",
    });
    const uniqueId = createUniqueId();

    try {
      const binding = await createDatadogBinding({
        env,
        uniqueId,
      });
      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: `sbi_${uniqueId}`,
          jti: `egress_rule_${uniqueId}`,
          bindingId: binding.bindingId,
          organizationId: binding.organizationId,
          familyId: "datadog",
          variantId: "datadog-default",
          credentialResolverKind: "integration_connection",
          connectionId: binding.connectionId,
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          upstreamBaseUrl: upstreamService.baseUrl,
          authInjectionType: "header",
          authInjectionTarget: "dd_api_key",
          additionalCredentialHeaders: [
            {
              header: "dd_application_key",
              credentialResolver: {
                kind: "integration_connection",
                connectionId: binding.connectionId,
                secretType: DatadogCredentialSecretTypes.API_KEY,
                slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
              },
            },
          ],
          allowedMethods: ["GET"],
          allowedPathPrefixes: ["/mcp"],
        },
        ttlSeconds: 60,
      });

      const message = await performUpgradeRequest({
        baseUrl: env.tokenizerProxy.hostBaseUrl,
        path: "/tokenizer-proxy/egress/mcp",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
          [TestEnvironmentIdHeader]: env.id,
        },
      });

      expect(message).toBe("pong\n");
      expect(upstreamService.capturedHeader("dd_api_key")).toBe("datadog-api-key");
      expect(upstreamService.capturedHeader("dd_application_key")).toBe("datadog-application-key");
    } finally {
      await upstreamService.stop();
    }
  });
});

function createUniqueId(): string {
  return `integration_new_tokenizer_proxy_${randomUUID().replaceAll("-", "_")}`;
}

async function createDatadogBinding(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
}): Promise<{
  bindingId: string;
  connectionId: string;
  organizationId: string;
}> {
  const session = await input.env.auth.createSession({
    email: `${input.uniqueId}@example.com`,
  });
  const targetKey = `datadog_${input.uniqueId}`;
  const bindingId = `ibd_${input.uniqueId}`;
  const sandboxProfileId = `sbp_${input.uniqueId}`;
  const connectionId = await createDatadogConnection({
    targetKey,
    cookie: session.cookie,
    env: input.env,
  });

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId: session.organizationId,
    displayName: "Tokenizer proxy integration-new profile",
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
    organizationId: session.organizationId,
  };
}

async function createSlackBinding(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
}): Promise<{
  bindingId: string;
  connectionId: string;
  organizationId: string;
}> {
  const session = await input.env.auth.createSession({
    email: `${input.uniqueId}-slack@example.com`,
  });
  const targetKey = `slack_${input.uniqueId}`;
  const bindingId = `ibd_${input.uniqueId}_slack`;
  const sandboxProfileId = `sbp_${input.uniqueId}_slack`;
  const connectionId = await createSlackConnection({
    targetKey,
    cookie: session.cookie,
    env: input.env,
  });

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId: session.organizationId,
    displayName: "Tokenizer proxy Slack integration-new profile",
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
    organizationId: session.organizationId,
  };
}

function mintDatadogEgressGrant(input: {
  binding: {
    bindingId: string;
    connectionId: string;
    organizationId: string;
  };
  jti: string;
  upstreamBaseUrl: string;
  authInjectionType: "bearer" | "header";
  authInjectionTarget: string;
  additionalHeaders?: Readonly<Record<string, string>>;
  requestMiddleware?: readonly string[];
  allowedMethods: readonly string[];
  allowedPathPrefixes: readonly string[];
}): Promise<string> {
  return mintEgressGrant({
    config: EgressGrantConfig,
    claims: {
      sub: `sbi_${input.jti}`,
      jti: input.jti,
      bindingId: input.binding.bindingId,
      organizationId: input.binding.organizationId,
      familyId: "datadog",
      variantId: "datadog-default",
      credentialResolverKind: "integration_connection",
      connectionId: input.binding.connectionId,
      secretType: DatadogCredentialSecretTypes.API_KEY,
      slotKey: DatadogCredentialSlotKeys.API_KEY,
      upstreamBaseUrl: input.upstreamBaseUrl,
      authInjectionType: input.authInjectionType,
      authInjectionTarget: input.authInjectionTarget,
      ...(input.additionalHeaders === undefined
        ? {}
        : { additionalHeaders: input.additionalHeaders }),
      ...(input.requestMiddleware === undefined
        ? {}
        : { requestMiddleware: input.requestMiddleware }),
      allowedMethods: input.allowedMethods,
      allowedPathPrefixes: input.allowedPathPrefixes,
    },
    ttlSeconds: 60,
  });
}

function mintGitHubInstallationEgressGrant(input: {
  binding: {
    bindingId: string;
    connectionId: string;
    organizationId: string;
  };
  jti: string;
  upstreamBaseUrl: string;
  actingUserId?: string;
}): Promise<string> {
  return mintEgressGrant({
    config: EgressGrantConfig,
    claims: {
      sub: `sbi_${input.jti}`,
      jti: input.jti,
      bindingId: input.binding.bindingId,
      organizationId: input.binding.organizationId,
      familyId: "github",
      variantId: "github-cloud",
      ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
      credentialResolverKind: "integration_connection",
      connectionId: input.binding.connectionId,
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
      upstreamBaseUrl: input.upstreamBaseUrl,
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/repos"],
    },
    ttlSeconds: 60,
  });
}

function mintAwsSigV4EgressGrant(input: {
  binding: {
    bindingId: string;
    connectionId: string;
    organizationId: string;
  };
  jti: string;
  upstreamBaseUrl: string;
  service: string;
}): Promise<string> {
  return mintEgressGrant({
    config: EgressGrantConfig,
    claims: {
      sub: `sbi_${input.jti}`,
      jti: input.jti,
      bindingId: input.binding.bindingId,
      organizationId: input.binding.organizationId,
      familyId: "aws",
      variantId: "aws-cli-default",
      credentialResolverKind: "integration_connection",
      connectionId: input.binding.connectionId,
      secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
      slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
      resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
      upstreamBaseUrl: input.upstreamBaseUrl,
      authInjectionType: "aws_sigv4",
      authInjectionService: input.service,
      authInjectionRegion: "us-east-1",
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/"],
    },
    ttlSeconds: 60,
  });
}

async function startGzipUpstream(input: {
  host: string;
  path: string;
  body: string;
}): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await reserveAvailablePort({ host: input.host });
  const gzippedBody = gzipSync(input.body);
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== input.path) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.setHeader("content-encoding", "gzip");
    response.setHeader("content-length", String(gzippedBody.byteLength));
    response.end(gzippedBody);
  });

  return await startHttpServer({ server, host: input.host, port });
}

type SimulatedGitHubInstallationAccessTokenRequest = {
  installationId: string;
  repositoryNames?: string[];
};

async function startSimulatedGitHubAppApi(input: { installationToken: string }): Promise<{
  baseUrl: string;
  installationAccessTokenRequests: () => SimulatedGitHubInstallationAccessTokenRequest[];
  stop: () => Promise<void>;
}> {
  const host = "127.0.0.1";
  const port = await reserveAvailablePort({ host });
  const installationAccessTokenRequests: SimulatedGitHubInstallationAccessTokenRequest[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const requestUrl = request.url ?? "/";
      const accessTokenMatch = /^\/app\/installations\/([^/]+)\/access_tokens$/u.exec(requestUrl);
      if (request.method !== "POST" || accessTokenMatch === null) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      const installationId = accessTokenMatch[1];
      if (installationId === undefined) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      const body = parseJsonRecord(await readRequestBody(request));
      const repositoryNames = readOptionalStringArray(body, "repository_names");
      installationAccessTokenRequests.push({
        installationId,
        ...(repositoryNames === undefined ? {} : { repositoryNames }),
      });

      // GitHub App installation access tokens are created with
      // `POST /app/installations/{installation_id}/access_tokens`. GitHub's
      // response includes a token and expiry; repository scoping is requested
      // with `repository_names`.
      // Source:
      // https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
      response.statusCode = 201;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          token: input.installationToken,
          expires_at: "2099-01-01T00:00:00Z",
          repository_selection: "selected",
          permissions: {},
        }),
      );
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          message: error instanceof Error ? error.message : "simulated GitHub API failed",
        }),
      );
    });
  });

  const startedServer = await startHttpServer({
    server,
    host,
    port,
  });

  return {
    baseUrl: startedServer.baseUrl,
    installationAccessTokenRequests: () => [...installationAccessTokenRequests],
    stop: startedServer.stop,
  };
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
  const host = "127.0.0.1";
  const port = await reserveAvailablePort({ host });
  const assumeRoleRequests: SimulatedAwsAssumeRoleRequest[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
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

      // AWS STS uses the Query API. `AssumeRole` returns temporary
      // credentials under `AssumeRoleResult/Credentials`.
      // Source:
      // https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
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
    <RequestId>integration-new-aws-sts</RequestId>
  </ResponseMetadata>
</AssumeRoleResponse>`);
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain");
      response.end(error instanceof Error ? error.message : "simulated AWS STS failed");
    });
  });

  const startedServer = await startHttpServer({
    server,
    host,
    port,
  });

  return {
    baseUrl: startedServer.baseUrl,
    assumeRoleRequests: () => [...assumeRoleRequests],
    stop: startedServer.stop,
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

async function startStreamingUpstream(input: {
  host: string;
  path: string;
  chunks: readonly string[];
  headers: Readonly<Record<string, string>>;
}): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await reserveAvailablePort({ host: input.host });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== input.path) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream");
    for (const [headerName, headerValue] of Object.entries(input.headers)) {
      response.setHeader(headerName, headerValue);
    }

    for (const chunk of input.chunks) {
      response.write(chunk);
    }
    response.end();
  });

  return await startHttpServer({ server, host: input.host, port });
}

async function startWebSocketUpstream(input: { host: string; path: string }): Promise<{
  baseUrl: string;
  capturedAuthorizationHeader: () => string | undefined;
  capturedHeader: (headerName: string) => string | undefined;
  stop: () => Promise<void>;
}> {
  const port = await reserveAvailablePort({ host: input.host });
  let capturedHeaders: Record<string, string | readonly string[]> | undefined;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === input.path) {
      response.statusCode = 426;
      response.end("upgrade required");
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== input.path) {
      socket.destroy();
      return;
    }
    const webSocketKey = readHeaderValue(request.headers, "sec-websocket-key");
    if (webSocketKey === undefined) {
      socket.destroy();
      return;
    }

    capturedHeaders = Object.fromEntries(
      Object.entries(request.headers).flatMap(([headerName, headerValue]) => {
        if (headerValue === undefined) {
          return [];
        }

        return [[headerName, Array.isArray(headerValue) ? [...headerValue] : headerValue]];
      }),
    );

    const webSocketAccept = createWebSocketAcceptHeader(webSocketKey);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Connection: Upgrade",
        "Upgrade: websocket",
        `Sec-WebSocket-Accept: ${webSocketAccept}`,
        "",
        "",
      ].join("\r\n"),
    );
    if (head.length > 0) {
      socket.unshift(head);
    }
    socket.once("data", (payload) => {
      expect(payload.toString("utf8")).toBe("ping\n");
      socket.write("pong\n");
      socket.end();
    });
  });

  const startedServer = await startHttpServer({ server, host: input.host, port });

  return {
    baseUrl: startedServer.baseUrl,
    capturedAuthorizationHeader: () => readHeaderValue(capturedHeaders, "authorization"),
    capturedHeader: (headerName) => readHeaderValue(capturedHeaders, headerName),
    stop: startedServer.stop,
  };
}

async function performUpgradeRequest(input: {
  baseUrl: string;
  path: string;
  headers: Record<string, string>;
}): Promise<string> {
  const targetUrl = new URL(input.baseUrl);
  const webSocketKey = Buffer.from(randomUUID()).toString("base64");

  return await new Promise<string>((resolve, reject) => {
    const request = httpRequest({
      host: targetUrl.hostname,
      port: targetUrl.port,
      method: "GET",
      path: input.path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": webSocketKey,
        "Sec-WebSocket-Version": "13",
        ...input.headers,
      },
    });

    request.once("upgrade", (_response, socket, head) => {
      if (head.length > 0) {
        socket.unshift(head);
      }

      const onData = (payload: Buffer): void => {
        const message = payload.toString("utf8");
        if (!message.endsWith("pong\n")) {
          return;
        }

        socket.off("data", onData);
        socket.end();
        resolve("pong\n");
      };

      socket.on("data", onData);
      socket.once("error", reject);
      socket.write("ping\n");
    });
    request.once("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.once("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        reject(
          new Error(
            `Expected upgrade response, received status ${String(response.statusCode ?? 0)}: ${body}`,
          ),
        );
      });
    });
    request.once("error", reject);
    request.end();
  });
}

function createWebSocketAcceptHeader(webSocketKey: string): string {
  return createHash("sha1").update(`${webSocketKey}${WebSocketAcceptGuid}`).digest("base64");
}

async function startHttpServer(input: {
  server: ReturnType<typeof createServer>;
  host: string;
  port: number;
}): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  await new Promise<void>((resolve, reject) => {
    input.server.once("error", reject);
    input.server.listen(input.port, input.host, () => {
      input.server.off("error", reject);
      resolve();
    });
  });

  return {
    baseUrl: `http://${input.host}:${String(input.port)}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        input.server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

async function createGitHubAppEgressBinding(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
  apiBaseUrl: string;
  installationId: string;
  linkedPrincipalAccessToken?: string;
}): Promise<{
  bindingId: string;
  connectionId: string;
  organizationId: string;
  userId: string;
}> {
  const session = await input.env.auth.createSession({
    email: `${input.uniqueId}-github-app-egress@example.com`,
  });
  const targetKey = `github_${input.uniqueId}`;
  const sandboxProfileId = `sbp_${input.uniqueId}_github_app`;
  const bindingId = `ibd_${input.uniqueId}_github_app`;

  await upsertGitHubIdentityTarget(input.env, {
    targetKey,
    apiBaseUrl: input.apiBaseUrl,
  });
  const connectionId = await createGitHubAppInstallationConnection({
    env: input.env,
    cookie: session.cookie,
    targetKey,
    installationId: input.installationId,
  });

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId: session.organizationId,
    displayName: "Tokenizer proxy GitHub App egress profile",
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
      kind: IntegrationBindingKinds.GIT,
      config: {
        repositories: ["mistlehq/mistle"],
      },
    });

  if (input.linkedPrincipalAccessToken !== undefined) {
    await seedGitHubAppLinkedPrincipal({
      env: input.env,
      uniqueId: input.uniqueId,
      organizationId: session.organizationId,
      userId: session.userId,
      targetKey,
      connectionId,
      accessToken: input.linkedPrincipalAccessToken,
    });
  }

  return {
    bindingId,
    connectionId,
    organizationId: session.organizationId,
    userId: session.userId,
  };
}

async function createGitHubAppInstallationConnection(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  targetKey: string;
  installationId: string;
}): Promise<string> {
  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({
        displayName: "Tokenizer proxy GitHub App installation",
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
          installation_id: input.installationId,
        },
        secrets: {
          appPrivateKeyPem: createPrivateKeyPem(),
          clientSecret: "github-client-secret",
          webhookSecret: "github-webhook-secret",
        },
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(
      `Expected GitHub App installation connection creation status 201, got ${String(response.status)}.`,
    );
  }

  return readConnectionId(await response.json());
}

function createPrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });

  return privateKey;
}

async function seedGitHubAppLinkedPrincipal(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
  organizationId: string;
  userId: string;
  targetKey: string;
  connectionId: string;
  accessToken: string;
}): Promise<void> {
  const providerConfigId = `ilp_${input.uniqueId}_github_app`;
  const principalId = `uep_${input.uniqueId}_github_app`;
  const credentialId = `upc_${input.uniqueId}_github_app`;

  await seedIdentityProviderConfig(input.env, {
    configId: providerConfigId,
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey: input.targetKey,
    userId: input.userId,
  });
  await seedGitHubLinkedPrincipal(input.env, {
    organizationId: input.organizationId,
    userId: input.userId,
    principalId,
    providerConfigId,
    connectionId: input.connectionId,
    providerSubjectId: "12345",
    profile: {
      login: "mistle-user",
    },
  });
  await seedPrincipalCredential(input.env, {
    credentialId,
    organizationId: input.organizationId,
    principalId,
    providerFamily: "github",
    credentialKind: "github_app_user_access_token",
    accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });
  await insertPrincipalCredentialSecret(input.env, {
    organizationId: input.organizationId,
    credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
    plaintext: input.accessToken,
  });
  await insertPrincipalCredentialSecret(input.env, {
    organizationId: input.organizationId,
    credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
    plaintext: "ghr-integration-new-refresh-token",
  });
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
        displayName: "Tokenizer proxy AWS AssumeRole connection",
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
    displayName: "Tokenizer proxy AWS egress profile",
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
    displayName: "Tokenizer proxy linked principal GitHub App",
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
    plaintext: "ghu-integration-new-token",
  });
  await insertPrincipalCredentialSecret(input.env, {
    organizationId: session.organizationId,
    credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
    plaintext: "ghr-integration-new-refresh-token",
  });

  return {
    organizationId: session.organizationId,
    userId: session.userId,
  };
}

async function createDatadogConnection(input: {
  targetKey: string;
  cookie: string;
  env: IntegrationTestEnvironment;
}): Promise<string> {
  const integrationTargets = input.env.controlPlaneTables.integrationTargets;

  await input.env.controlPlaneDb
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "datadog",
      variantId: "datadog-default",
      enabled: true,
      config: {},
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
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
        displayName: "Integration-new Datadog connection",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
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

async function createSlackConnection(input: {
  targetKey: string;
  cookie: string;
  env: IntegrationTestEnvironment;
}): Promise<string> {
  const integrationTargets = input.env.controlPlaneTables.integrationTargets;

  await input.env.controlPlaneDb
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: "https://slack.com/api",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: "https://slack.com/api",
        },
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
        displayName: "Integration-new Slack connection",
        methodId: SlackConnectionMethodIds.SLACK_APP,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
        },
        secrets: {
          botToken: "xoxb-integration-new-slack",
          signingSecret: "integration-new-slack-signing-secret",
        },
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(
      `Expected Slack connection creation status 201, got ${String(response.status)}.`,
    );
  }

  return readConnectionId(await response.json());
}

function readConnectionId(value: unknown): string {
  if (!isRecord(value)) {
    throw new Error("Expected connection response to be a JSON object.");
  }

  const id = value["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Expected connection response to include an id.");
  }

  return id;
}

function readEchoHeader(body: unknown, headerName: string): string | undefined {
  if (!isRecord(body)) {
    throw new Error("Expected echo response body to be a JSON object.");
  }

  const headers = body["headers"];
  if (!isRecord(headers)) {
    throw new Error("Expected echo response body to include headers.");
  }

  const value = headers[headerName] ?? headers[headerName.toLowerCase()];
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function readHeaderValue(
  headers: Record<string, unknown> | undefined,
  headerName: string,
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== headerName.toLowerCase()) {
      continue;
    }

    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value)) {
      const firstValue = value[0];
      return typeof firstValue === "string" ? firstValue : undefined;
    }
  }

  return undefined;
}

function readEchoString(body: unknown, propertyName: string): string | undefined {
  if (!isRecord(body)) {
    throw new Error("Expected echo response body to be a JSON object.");
  }

  const value = body[propertyName];
  return typeof value === "string" ? value : undefined;
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> {
  if (value === undefined) {
    throw new Error("Expected JSON string value to be defined.");
  }

  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error("Expected parsed JSON value to be an object.");
  }

  return parsed;
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  propertyName: string,
): string[] | undefined {
  const property = value[propertyName];
  if (property === undefined) {
    return undefined;
  }

  if (!Array.isArray(property)) {
    throw new Error(`Expected '${propertyName}' to be an array.`);
  }

  return property.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Expected '${propertyName}' to contain only strings.`);
    }

    return item;
  });
}

async function expectProxyErrorResponse(
  response: Response,
  input: {
    status: number;
    code: string;
    message: string;
  },
): Promise<void> {
  const body: unknown = await response.json();

  expect(response.status).toBe(input.status);
  expect(body).toMatchObject({
    code: input.code,
    message: input.message,
  });
  if (!isRecord(body) || typeof body["traceId"] !== "string") {
    throw new Error("Expected proxy error body to include traceId.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
