import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { verifyConnectionToken } from "@mistle/gateway-connection-auth";
import { describe, expect } from "vitest";

import {
  SandboxInstanceConnectionTokenSchema,
  SandboxInstancesConflictResponseSchema,
  SandboxInstancesNotFoundResponseSchema,
  SandboxInstancesUnauthorizedResponseSchema,
} from "../src/sandbox-instances/contracts.js";
import { it } from "./sandbox-profile-versions-start/test-context.js";

const IntegrationConnectionTokenConfig = {
  connectionTokenSecret: "integration-bootstrap-secret",
  tokenIssuer: "integration-issuer",
  tokenAudience: "integration-audience",
} as const;
const IntegrationGatewayWsUrl = "ws://127.0.0.1:5202/tunnel/sandbox";

describe("sandbox instance connection tokens integration", () => {
  it("issues a connection token for a running sandbox instance", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-instance-connection-token@example.com",
    });

    const sandboxInstanceId = "sbi_connection_token_running";
    await fixture.dataPlaneDb.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: authenticatedSession.organizationId,
      sandboxProfileId: "sbp_connection_token",
      sandboxProfileVersion: 1,
      provider: "docker",
      providerSandboxId: "provider-running-1",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: authenticatedSession.userId,
      source: "dashboard",
    });

    const response = await fixture.request(
      `/v1/sandbox/instances/${sandboxInstanceId}/connection-tokens`,
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(201);

    const body = SandboxInstanceConnectionTokenSchema.parse(await response.json());
    expect(body.instanceId).toBe(sandboxInstanceId);

    const url = new URL(body.url);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(IntegrationGatewayWsUrl);
    expect(url.searchParams.get("token")).toBe(body.token);

    const verifiedToken = await verifyConnectionToken({
      config: IntegrationConnectionTokenConfig,
      token: body.token,
    });
    expect(verifiedToken.jti.startsWith(`${sandboxInstanceId}-`)).toBe(true);

    const expiresAtEpochMs = Date.parse(body.expiresAt);
    expect(Number.isNaN(expiresAtEpochMs)).toBe(false);
    const remainingTtlMs = expiresAtEpochMs - Date.now();
    expect(remainingTtlMs).toBeGreaterThan(20_000);
    expect(remainingTtlMs).toBeLessThanOrEqual(130_000);
  }, 120_000);

  it("returns 404 when the sandbox instance does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-instance-connection-token-missing@example.com",
    });

    const response = await fixture.request(
      "/v1/sandbox/instances/sbi_connection_token_missing/connection-tokens",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(404);

    const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_NOT_FOUND");
  }, 120_000);

  it("returns 409 when the sandbox instance is not running", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-instance-connection-token-not-running@example.com",
    });

    const sandboxInstanceId = "sbi_connection_token_starting";
    await fixture.dataPlaneDb.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: authenticatedSession.organizationId,
      sandboxProfileId: "sbp_connection_token",
      sandboxProfileVersion: 1,
      provider: "docker",
      providerSandboxId: "provider-starting-1",
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: "user",
      startedById: authenticatedSession.userId,
      source: "dashboard",
    });

    const response = await fixture.request(
      `/v1/sandbox/instances/${sandboxInstanceId}/connection-tokens`,
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(409);

    const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_NOT_RUNNING");
  }, 120_000);

  it("returns 401 when the request is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request(
      "/v1/sandbox/instances/sbi_connection_token_unauthorized/connection-tokens",
      {
        method: "POST",
      },
    );
    expect(response.status).toBe(401);

    const body = SandboxInstancesUnauthorizedResponseSchema.parse(await response.json());
    expect(body.code).toBe("UNAUTHORIZED");
  }, 120_000);
});
