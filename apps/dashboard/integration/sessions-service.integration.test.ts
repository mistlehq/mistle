/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxInstancePersistenceModes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createIntegrationTest, TestEnvironmentIdHeader } from "@mistle/test-harness/integration";
import { expect } from "vitest";

import { resetDashboardConfigForTest } from "../src/config.js";
import { setControlPlaneRequestHeadersForTest } from "../src/features/api/request-control-plane.js";
import { createSandboxInstancePortAccess } from "../src/features/sessions/sessions-service.js";
import { resetControlPlaneApiClientForTest } from "../src/lib/control-plane-api/client.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

it("creates sandbox port access through the real control-plane API", async ({ env }) => {
  const session = await env.auth.createSession({
    organizationName: "Dashboard Port Access Integration",
  });
  const sandboxInstanceId = "sbi_dashboard_port_access_001";

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId: session.organizationId,
    sandboxProfileId: "sbp_dashboard_port_access",
    title: "Dashboard port access sandbox",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: null,
    persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
    status: SandboxInstanceStatuses.STOPPED,
    startedByKind: "user",
    startedById: session.userId,
    source: "dashboard",
    failureCode: null,
    failureMessage: null,
  });

  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: env.controlPlaneApi.hostBaseUrl,
    VITE_MISTLE_RELEASE_VERSION: "0.18.1",
  });
  resetDashboardConfigForTest();
  resetControlPlaneApiClientForTest();
  setControlPlaneRequestHeadersForTest({
    cookie: session.cookie,
    [TestEnvironmentIdHeader]: env.id,
  });

  try {
    const portAccess = await createSandboxInstancePortAccess({
      instanceId: sandboxInstanceId,
      port: 5173,
    });

    const bootstrapUrl = new URL(portAccess.bootstrapUrl);

    expect(portAccess.bootstrapPath).toBe("/_mistle/access/bootstrap");
    expect(portAccess.host).toMatch(/^p-5173--[a-z0-9]+\.mistle\.localhost$/);
    expect(bootstrapUrl.hostname).toBe(portAccess.host);
    expect(bootstrapUrl.pathname).toBe(portAccess.bootstrapPath);
    expect(bootstrapUrl.searchParams.get("token")).toBe(portAccess.token);
    expect(portAccess.token).not.toBe("");
    expect(new Date(portAccess.expiresAt).getTime()).toBeGreaterThan(Date.now());
  } finally {
    setControlPlaneRequestHeadersForTest(undefined);
    resetDashboardConfigForTest();
    resetControlPlaneApiClientForTest();
  }
});
