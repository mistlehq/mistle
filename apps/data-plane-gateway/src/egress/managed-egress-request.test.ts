import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Cache, InMemoryCacheAdapter } from "@mistle/cache";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { verifyMcpToken } from "@mistle/gateway-tunnel-auth";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import { afterEach, describe, expect, it } from "vitest";

import { CredentialCache } from "./credential-cache.js";
import { buildManagedEgressRequest } from "./managed-egress-request.js";

let currentServer: Server | undefined;

afterEach(async () => {
  if (currentServer === undefined) {
    return;
  }

  const server = currentServer;
  currentServer = undefined;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
});

describe("buildManagedEgressRequest", () => {
  it("sends the linked-principal integration connection selector to control-plane", async () => {
    let observedBody: unknown;
    const controlPlaneBaseUrl = await startRecordingControlPlane((request, response) => {
      collectRequestBody(request, (body) => {
        observedBody = JSON.parse(body);
        response.writeHead(200, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            kind: "value",
            value: "workspace-b-token",
          }),
        );
      });
    });
    const route: CompiledRuntimePlan["egressRoutes"][number] = {
      egressRuleId: "egress_rule_github",
      bindingId: "bind_github",
      familyId: "github",
      variantId: "github-cloud",
      match: {
        hosts: ["api.github.test"],
        methods: ["GET"],
      },
      upstream: {
        baseUrl: "https://api.github.test",
      },
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "linked_principal",
        providerFamily: "github",
        integrationConnectionId: "icn_workspace_b",
        credentialKind: "github_app_user_access_token",
        actingUserRequired: true,
        resolutionMode: "required",
      },
    };

    const result = await buildManagedEgressRequest({
      body: undefined,
      controlPlanePublicBaseUrl: "https://control-plane.test",
      controlPlaneInternalClient: new ControlPlaneInternalClient({
        baseUrl: controlPlaneBaseUrl,
        internalAuthServiceToken: "service-token",
      }),
      credentialCache: new CredentialCache({
        cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
        defaultTtlSeconds: 300,
        refreshSkewSeconds: 0,
        now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      }),
      mcpTokenConfig: {
        tokenSecret: "mcp-token-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-mcp",
      },
      organizationId: "org_123",
      request: {
        actingUserId: "usr_123",
        authority: "api.github.test",
        headers: {},
        method: "GET",
        path: "/user",
        scheme: "https",
      },
      route,
      sandboxInstanceId: "sbi_123",
    });

    expect(observedBody).toEqual({
      organizationId: "org_123",
      actingUserId: "usr_123",
      providerFamily: "github",
      integrationConnectionId: "icn_workspace_b",
      credentialKind: "github_app_user_access_token",
    });
    expect(result.request.headers.get("authorization")).toBe("Bearer workspace-b-token");
  });

  it("does not cache provider-only linked-principal credentials", async () => {
    const observedBodies: unknown[] = [];
    const controlPlaneBaseUrl = await startRecordingControlPlane((request, response) => {
      collectRequestBody(request, (body) => {
        observedBodies.push(JSON.parse(body));
        response.writeHead(200, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            kind: "value",
            value: `linear-user-token-${String(observedBodies.length)}`,
          }),
        );
      });
    });
    const route: CompiledRuntimePlan["egressRoutes"][number] = {
      egressRuleId: "egress_rule_linear",
      bindingId: "bind_linear",
      familyId: "linear",
      variantId: "linear-default",
      match: {
        hosts: ["api.linear.test"],
        methods: ["POST"],
      },
      upstream: {
        baseUrl: "https://api.linear.test",
      },
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "linked_principal",
        providerFamily: "linear",
        credentialKind: "linear_oauth_user_token",
        actingUserRequired: true,
        resolutionMode: "preferred",
      },
    };
    const credentialCache = new CredentialCache({
      cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
      defaultTtlSeconds: 300,
      refreshSkewSeconds: 0,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });
    const baseInput = {
      body: undefined,
      controlPlanePublicBaseUrl: "https://control-plane.test",
      controlPlaneInternalClient: new ControlPlaneInternalClient({
        baseUrl: controlPlaneBaseUrl,
        internalAuthServiceToken: "service-token",
      }),
      credentialCache,
      mcpTokenConfig: {
        tokenSecret: "mcp-token-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-mcp",
      },
      organizationId: "org_123",
      request: {
        actingUserId: "usr_123",
        authority: "api.linear.test",
        headers: {},
        method: "POST",
        path: "/graphql",
        scheme: "https",
      },
      route,
      sandboxInstanceId: "sbi_123",
    } satisfies Parameters<typeof buildManagedEgressRequest>[0];

    const firstResult = await buildManagedEgressRequest(baseInput);
    const secondResult = await buildManagedEgressRequest(baseInput);

    expect(observedBodies).toEqual([
      {
        organizationId: "org_123",
        actingUserId: "usr_123",
        providerFamily: "linear",
        credentialKind: "linear_oauth_user_token",
      },
      {
        organizationId: "org_123",
        actingUserId: "usr_123",
        providerFamily: "linear",
        credentialKind: "linear_oauth_user_token",
      },
    ]);
    expect(firstResult.request.headers.get("authorization")).toBe("Bearer linear-user-token-1");
    expect(secondResult.request.headers.get("authorization")).toBe("Bearer linear-user-token-2");
  });

  it("applies header credential prefixes when injecting resolved credentials", async () => {
    const controlPlaneBaseUrl = await startRecordingControlPlane((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          kind: "value",
          value: "discord-bot-token",
        }),
      );
    });
    const route: CompiledRuntimePlan["egressRoutes"][number] = {
      egressRuleId: "egress_rule_discord",
      bindingId: "bind_discord",
      familyId: "discord",
      variantId: "discord-default",
      match: {
        hosts: ["discord.com"],
        methods: ["GET"],
      },
      upstream: {
        baseUrl: "https://discord.com/api/v10",
      },
      authInjection: {
        type: "header",
        target: "authorization",
        credentialPrefix: "Bot ",
      },
      credentialResolver: {
        kind: "integration_connection",
        connectionId: "icn_discord",
        secretType: "api_key",
        slotKey: "discord.discord-default.discord-bot.bot-token",
      },
    };

    const result = await buildManagedEgressRequest({
      body: undefined,
      controlPlanePublicBaseUrl: "https://control-plane.test",
      controlPlaneInternalClient: new ControlPlaneInternalClient({
        baseUrl: controlPlaneBaseUrl,
        internalAuthServiceToken: "service-token",
      }),
      credentialCache: new CredentialCache({
        cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
        defaultTtlSeconds: 300,
        refreshSkewSeconds: 0,
        now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      }),
      mcpTokenConfig: {
        tokenSecret: "mcp-token-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-mcp",
      },
      organizationId: "org_123",
      request: {
        authority: "discord.com",
        headers: {},
        method: "GET",
        path: "/api/v10/users/@me",
        scheme: "https",
      },
      route,
      sandboxInstanceId: "sbi_123",
    });

    expect(result.request.headers.get("authorization")).toBe("Bot discord-bot-token");
  });

  it("replaces incoming AWS SigV4 headers with resolved AWS session credentials", async () => {
    let observedBody: unknown;
    const controlPlaneBaseUrl = await startRecordingControlPlane((request, response) => {
      collectRequestBody(request, (body) => {
        observedBody = JSON.parse(body);
        response.writeHead(200, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            kind: "aws_session",
            accessKeyId: "ASIAMISTLEREAL",
            secretAccessKey: "mistle-real-secret",
            sessionToken: "mistle-real-session-token",
            expiresAt: "2026-01-01T01:00:00.000Z",
          }),
        );
      });
    });
    const route: CompiledRuntimePlan["egressRoutes"][number] = {
      egressRuleId: "egress_rule_aws",
      bindingId: "bind_aws",
      familyId: "aws",
      variantId: "aws-cli-default",
      match: {
        hosts: ["monitoring.us-east-1.amazonaws.com"],
        methods: ["GET"],
      },
      upstream: {
        baseUrl: "https://monitoring.us-east-1.amazonaws.com",
      },
      authInjection: {
        type: "aws_sigv4",
        service: "monitoring",
        region: "us-east-1",
      },
      credentialResolver: {
        kind: "integration_connection",
        connectionId: "icn_aws",
        secretType: "aws_secret_access_key",
        slotKey: "secretAccessKey",
        resolverKey: "assume_role_session",
      },
    };

    const result = await buildManagedEgressRequest({
      body: undefined,
      controlPlanePublicBaseUrl: "https://control-plane.test",
      controlPlaneInternalClient: new ControlPlaneInternalClient({
        baseUrl: controlPlaneBaseUrl,
        internalAuthServiceToken: "service-token",
      }),
      credentialCache: new CredentialCache({
        cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
        defaultTtlSeconds: 300,
        refreshSkewSeconds: 0,
        now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      }),
      mcpTokenConfig: {
        tokenSecret: "mcp-token-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-mcp",
      },
      organizationId: "org_123",
      request: {
        authority: "monitoring.us-east-1.amazonaws.com",
        headers: {
          authorization: [
            "AWS4-HMAC-SHA256 Credential=PLACEHOLDER/20260101/us-east-1/monitoring/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=placeholder",
          ],
          "x-amz-date": ["20260101T000000Z"],
          "x-amz-security-token": ["placeholder-session-token"],
        },
        method: "GET",
        path: "/api/v1/query",
        query: "query=up",
        scheme: "https",
      },
      route,
      sandboxInstanceId: "sbi_123",
    });

    expect(observedBody).toEqual({
      bindingId: "bind_aws",
      connectionId: "icn_aws",
      secretType: "aws_secret_access_key",
      slotKey: "secretAccessKey",
      resolverKey: "assume_role_session",
    });
    expect(result.request.headers.get("authorization")).toContain("Credential=ASIAMISTLEREAL/");
    expect(result.request.headers.get("authorization")).not.toContain("PLACEHOLDER");
    expect(result.request.headers.get("x-amz-security-token")).toBe("mistle-real-session-token");
    expect(result.request.headers.get("x-amz-date")).not.toBe("20260101T000000Z");
  });

  it("injects the gateway platform OpenAI API key without calling control-plane", async () => {
    const route: CompiledRuntimePlan["egressRoutes"][number] = {
      egressRuleId: "egress_rule_openai_platform",
      bindingId: "platform-openai",
      familyId: "openai",
      variantId: "openai-default",
      match: {
        hosts: ["api.openai.com"],
        methods: ["GET", "POST"],
        pathPrefixes: ["/"],
      },
      upstream: {
        baseUrl: "https://api.openai.com",
      },
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "platform_openai_api_key",
      },
    };

    const result = await buildManagedEgressRequest({
      body: undefined,
      controlPlanePublicBaseUrl: "https://control-plane.test",
      controlPlaneInternalClient: new ControlPlaneInternalClient({
        baseUrl: "http://127.0.0.1:1",
        internalAuthServiceToken: "service-token",
      }),
      credentialCache: new CredentialCache({
        cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
        defaultTtlSeconds: 300,
        refreshSkewSeconds: 0,
        now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      }),
      mcpTokenConfig: {
        tokenSecret: "mcp-token-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-mcp",
      },
      organizationId: "org_123",
      platformCredentials: {
        openai: {
          apiKey: "sk-platform-openai",
        },
      },
      request: {
        authority: "api.openai.com",
        headers: {},
        method: "POST",
        path: "/v1/responses",
        scheme: "https",
      },
      route,
      sandboxInstanceId: "sbi_123",
    });

    expect(result.request.headers.get("authorization")).toBe("Bearer sk-platform-openai");
  });

  it("mints Designer-scoped MCP bearer tokens for Mistle MCP egress", async () => {
    const route: CompiledRuntimePlan["egressRoutes"][number] = {
      egressRuleId: "egress_rule_mistle_mcp",
      bindingId: "platform-mistle-mcp",
      familyId: "mistle",
      variantId: "mistle-mcp",
      match: {
        hosts: ["api.mistle.test"],
        methods: ["POST"],
        pathPrefixes: ["/mcp"],
      },
      upstream: {
        baseUrl: "https://api.mistle.test/mcp",
      },
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "mistle_mcp_designer_token",
        designerSessionId: "dsn_123",
      },
    };

    const result = await buildManagedEgressRequest({
      body: undefined,
      controlPlanePublicBaseUrl: "https://control-plane.test",
      controlPlaneInternalClient: new ControlPlaneInternalClient({
        baseUrl: "http://127.0.0.1:1",
        internalAuthServiceToken: "service-token",
      }),
      credentialCache: new CredentialCache({
        cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
        defaultTtlSeconds: 300,
        refreshSkewSeconds: 0,
        now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      }),
      mcpTokenConfig: {
        tokenSecret: "mcp-token-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-mcp",
      },
      organizationId: "org_123",
      request: {
        authority: "api.mistle.test",
        headers: {},
        method: "POST",
        path: "/mcp",
        scheme: "https",
      },
      route,
      sandboxInstanceId: "sbi_123",
    });

    const token = result.request.headers.get("authorization")?.replace("Bearer ", "");
    if (token === undefined) {
      throw new Error("Expected MCP bearer token.");
    }
    const verified = await verifyMcpToken({
      token,
      config: {
        tokenSecret: "mcp-token-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-mcp",
      },
    });

    expect(verified).toMatchObject({
      kind: "designer",
      sub: "sbi_123",
      organizationId: "org_123",
      designerSessionId: "dsn_123",
    });
  });
});

async function startRecordingControlPlane(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  currentServer = server;
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error("Expected test HTTP server to listen on a TCP port.");
  }

  return `http://127.0.0.1:${String(address.port)}`;
}

function collectRequestBody(request: IncomingMessage, onBody: (body: string) => void): void {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  request.on("end", () => {
    onBody(Buffer.concat(chunks).toString("utf8"));
  });
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return address !== null && typeof address !== "string";
}
