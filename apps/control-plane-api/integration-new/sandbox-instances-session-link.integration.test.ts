/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { SandboxInstancesNotFoundResponseSchema } from "../src/sandbox-instances/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox instance session link integration", () => {
  it("redirects a public session link to the dashboard session view without authentication", async ({
    env,
  }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/p/sessions/sbi_cp_session_link_public_001",
      {
        method: "GET",
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/sessions/sbi_cp_session_link_public_001",
    );
  });

  it("redirects an authorized user to the dashboard session view", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-session-link@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_session_link_001",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_session_link_001/session-link",
      {
        method: "GET",
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/sessions/sbi_cp_session_link_001",
    );
  });

  it("returns unauthorized when the caller is not authenticated", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_session_link_unauthorized/session-link",
      {
        method: "GET",
        redirect: "manual",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });

  it("returns not found when the sandbox instance belongs to a different organization", async ({
    env,
  }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-sandbox-session-link-owner@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-new-sandbox-session-link-other@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: ownerSession.organizationId,
      sandboxInstanceId: "sbi_cp_session_link_cross_org_001",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_session_link_cross_org_001/session-link",
      {
        method: "GET",
        headers: {
          cookie: otherSession.cookie,
        },
        redirect: "manual",
      },
    );

    expect(response.status).toBe(404);
    const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
    expect(body).toEqual({
      code: "INSTANCE_NOT_FOUND",
      message: "Sandbox instance 'sbi_cp_session_link_cross_org_001' was not found.",
    });
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_session_link_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: null,
    status: "pending",
    startedByKind: "user",
    startedById: "usr_session_link_integration",
    source: "dashboard",
  });
}
