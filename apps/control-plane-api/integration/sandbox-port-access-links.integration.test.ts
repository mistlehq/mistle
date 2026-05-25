/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { PortAccessLinkCreatedByKinds } from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { SandboxInstancePortAccessSchema } from "../src/sandbox-instances/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox Port Access links integration", () => {
  it("creates a short link for a sandbox port and redirects it to a gateway bootstrap URL", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link",
    });

    const createResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_port_access_link/ports/4173/access",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          host: "attacker.example.test",
        },
      },
    );

    expect(createResponse.status).toBe(201);
    const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
    const url = new URL(portAccess.url);
    const slug = url.pathname.replace("/p/ports/", "");

    expect(url.hostname).not.toBe("attacker.example.test");
    expect(slug).toMatch(/^[0-9A-Za-z]{12}$/u);
    expect(portAccess.host).toContain("p-4173--");
    expect(Date.parse(portAccess.expiresAt)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    const persistedLink = await env.controlPlaneDb.query.portAccessLinks.findFirst({
      where: (table, { eq }) => eq(table.slug, slug),
    });
    expect(persistedLink).toMatchObject({
      slug,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link",
      port: 4173,
      createdByKind: PortAccessLinkCreatedByKinds.USER,
      createdById: session.userId,
    });
    expect(Date.parse(persistedLink?.expiresAt ?? "")).toBe(Date.parse(portAccess.expiresAt));

    const redirectResponse = await env.controlPlaneApi.http.fetch(`/p/ports/${slug}`, {
      redirect: "manual",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(redirectResponse.status).toBe(302);
    const location = redirectResponse.headers.get("location");
    expect(location).not.toBeNull();
    const redirectUrl = new URL(location ?? "");
    expect(redirectUrl.hostname).toBe(portAccess.host);
    expect(redirectUrl.port).not.toBe("");
    expect(redirectUrl.pathname).toBe("/_mistle/access/bootstrap");
    expect(redirectUrl.searchParams.get("token")).toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
  });

  it("reuses an active short link for the same sandbox port", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-reuse@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link_reuse",
    });

    const firstCreateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_port_access_link_reuse/ports/4173/access",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    const secondCreateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_port_access_link_reuse/ports/4173/access",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(firstCreateResponse.status).toBe(201);
    expect(secondCreateResponse.status).toBe(201);
    const firstPortAccess = SandboxInstancePortAccessSchema.parse(await firstCreateResponse.json());
    const secondPortAccess = SandboxInstancePortAccessSchema.parse(
      await secondCreateResponse.json(),
    );

    expect(secondPortAccess).toEqual(firstPortAccess);

    const persistedLinks = await env.controlPlaneDb.query.portAccessLinks.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.sandboxInstanceId, "sbi_port_access_link_reuse"),
          eq(table.port, 4173),
        ),
    });
    expect(persistedLinks).toHaveLength(1);
  });

  it("does not redirect expired short links", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-expired@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link_expired",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.portAccessLinks).values({
      slug: "Expired00001",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link_expired",
      port: 4173,
      createdByKind: PortAccessLinkCreatedByKinds.USER,
      createdById: session.userId,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });

    const redirectResponse = await env.controlPlaneApi.http.fetch("/p/ports/Expired00001", {
      redirect: "manual",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(redirectResponse.status).toBe(404);
    expect(await redirectResponse.json()).toEqual({
      code: "NOT_FOUND",
      message: "Port Access link was not found or has expired.",
    });
  });

  it("does not redeem short links outside the active organization", async ({ env }) => {
    const linkOwnerSession = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-owner@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-other-org@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: linkOwnerSession.organizationId,
      sandboxInstanceId: "sbi_port_access_link_other_org",
    });

    const createResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_port_access_link_other_org/ports/4173/access",
      {
        method: "POST",
        headers: {
          cookie: linkOwnerSession.cookie,
        },
      },
    );
    const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
    const slug = new URL(portAccess.url).pathname.replace("/p/ports/", "");

    const redirectResponse = await env.controlPlaneApi.http.fetch(`/p/ports/${slug}`, {
      redirect: "manual",
      headers: {
        cookie: otherSession.cookie,
      },
    });

    expect(redirectResponse.status).toBe(404);
    expect(await redirectResponse.json()).toEqual({
      code: "NOT_FOUND",
      message: "Port Access link was not found or has expired.",
    });
  });

  it("requires an authenticated active organization to redeem short links", async ({ env }) => {
    const redirectResponse = await env.controlPlaneApi.http.fetch("/p/ports/Unknown000001", {
      redirect: "manual",
    });

    expect(redirectResponse.status).toBe(401);
    expect(await redirectResponse.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});

type SandboxInstanceRow = DataPlaneTables["sandboxInstances"]["$inferInsert"];

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
    sandboxProfileId: `sbp_${input.sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: "user",
    startedById: "usr_port_access_link",
    source: SandboxInstanceSources.DASHBOARD,
    purpose: SandboxInstancePurposes.SESSION,
    failureCode: null,
    failureMessage: null,
  } satisfies SandboxInstanceRow);
}
