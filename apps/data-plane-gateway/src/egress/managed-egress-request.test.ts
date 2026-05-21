import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Cache, InMemoryCacheAdapter } from "@mistle/cache";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
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
