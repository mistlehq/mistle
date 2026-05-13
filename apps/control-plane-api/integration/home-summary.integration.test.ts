/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  AutomationKinds,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  type SandboxInstanceSource,
} from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { homeSummaryResponseSchema } from "../src/home/schema.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("home summary integration", () => {
  it("returns onboarding readiness booleans for the authenticated organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary@example.com",
    });

    await expectHomeSummary(env, session.cookie, {
      onboarding: {
        hasIntegrations: false,
        hasProfiles: false,
        hasUsableProfiles: false,
        hasStartedSession: false,
        hasWebhookCapableIntegration: false,
        hasAutomations: false,
      },
      recentSessions: [],
    });

    await seedAgentReadyHomeState({
      env,
      idPrefix: "ready",
      organizationId: session.organizationId,
      userId: session.userId,
    });

    await expectHomeSummary(env, session.cookie, {
      onboarding: {
        hasIntegrations: true,
        hasProfiles: true,
        hasUsableProfiles: true,
        hasStartedSession: true,
        hasWebhookCapableIntegration: false,
        hasAutomations: true,
      },
      recentSessions: [
        {
          id: "sbi_home_summary_ready",
          sandboxProfileId: "sbp_home_summary_ready",
          title: "Investigate issue",
          sandboxProfileDisplayName: "Default Profile",
          sandboxProfileVersion: 1,
          status: SandboxInstanceStatuses.RUNNING,
          startedBy: {
            kind: "user",
            id: session.userId,
            name: "integration-new-home-summary@example.com",
          },
          source: SandboxInstanceSources.DASHBOARD,
          createdAt: "2026-03-02 00:00:00+00",
          updatedAt: "2026-03-02 00:00:00+00",
          failureCode: null,
          failureMessage: null,
        },
      ],
    });
  });

  it("returns recent sessions created by the authenticated user", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-recent-user@example.com",
    });

    await seedAgentReadyHomeState({
      env,
      idPrefix: "recent_user",
      organizationId: session.organizationId,
      userId: session.userId,
    });
    await seedAgentReadyHomeState({
      env,
      idPrefix: "recent_other_user",
      organizationId: session.organizationId,
      userId: "usr_home_summary_other_user",
    });
    await seedAgentReadyHomeState({
      env,
      idPrefix: "recent_system",
      organizationId: session.organizationId,
      sandboxInstanceSource: SandboxInstanceSources.WEBHOOK,
      startedById: "aru_home_summary_recent_system",
      startedByKind: "system",
      userId: session.userId,
    });

    const body = await readHomeSummary(env, session.cookie);
    expect(body.recentSessions.map((recentSession) => recentSession.id)).toStrictEqual([
      "sbi_home_summary_recent_user",
    ]);
  });

  it("counts scheduled automations as completed automation onboarding", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-scheduled-automation@example.com",
    });

    await seedAgentReadyHomeState({
      env,
      automationKind: AutomationKinds.SCHEDULE,
      idPrefix: "scheduled_automation",
      organizationId: session.organizationId,
      userId: session.userId,
    });

    const body = await readHomeSummary(env, session.cookie);
    expect(body.onboarding).toMatchObject({
      hasWebhookCapableIntegration: false,
      hasAutomations: true,
    });
  });

  it("does not count another organization's automations as completed automation onboarding", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-own-automation@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-new-home-summary-other-automation@example.com",
    });

    await seedAgentReadyHomeState({
      env,
      automationKind: AutomationKinds.SCHEDULE,
      idPrefix: "other_org_automation",
      organizationId: otherSession.organizationId,
      userId: otherSession.userId,
    });

    const body = await readHomeSummary(env, session.cookie);
    expect(body.onboarding.hasAutomations).toBe(false);
  });

  it("does not count inactive connections as completed integrations", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-inactive-connection@example.com",
    });

    await seedIntegrationTarget({
      env,
      targetKey: "openai-home-summary-inactive",
      familyId: "openai",
      variantId: "openai-default",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_home_summary_inactive",
      organizationId: session.organizationId,
      targetKey: "openai-home-summary-inactive",
      displayName: "OpenAI inactive",
      status: IntegrationConnectionStatuses.ERROR,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });

    const body = await readHomeSummary(env, session.cookie);
    expect(body.onboarding.hasIntegrations).toBe(false);
    expect(body.onboarding.hasWebhookCapableIntegration).toBe(false);
  });

  it("uses the active published version when a newer draft exists", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-active-version@example.com",
    });

    await seedSandboxProfile({
      env,
      profileId: "sbp_home_summary_active_version",
      organizationId: session.organizationId,
      activeVersion: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      {
        sandboxProfileId: "sbp_home_summary_active_version",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        sandboxProfileId: "sbp_home_summary_active_version",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        publishedAt: null,
      },
    ]);

    const body = await readHomeSummary(env, session.cookie);
    expect(body.onboarding).toMatchObject({
      hasProfiles: true,
      hasUsableProfiles: true,
    });
  });

  it("returns 403 when the active organization membership has been revoked", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-revoked-membership@example.com",
    });

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const response = await env.controlPlaneApi.http.fetch("/v1/home", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("counts system-started sandbox instances as a started session", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-system-started@example.com",
    });

    await seedAgentReadyHomeState({
      env,
      idPrefix: "system_started",
      organizationId: session.organizationId,
      sandboxInstanceSource: SandboxInstanceSources.WEBHOOK,
      startedById: "aru_home_summary_system_started",
      startedByKind: "system",
      userId: session.userId,
    });

    const body = await readHomeSummary(env, session.cookie);
    expect(body.onboarding).toMatchObject({
      hasIntegrations: true,
      hasProfiles: true,
      hasUsableProfiles: true,
      hasStartedSession: true,
    });
  });

  it("does not count active non-agent integrations as completed integrations", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-non-agent-connection@example.com",
    });

    await seedIntegrationTarget({
      env,
      targetKey: "github-home-summary-active-git",
      familyId: "github",
      variantId: "github-cloud",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_home_summary_active_git",
      organizationId: session.organizationId,
      targetKey: "github-home-summary-active-git",
      displayName: "GitHub",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });

    const body = await readHomeSummary(env, session.cookie);
    expect(body.onboarding.hasIntegrations).toBe(false);
    expect(body.onboarding.hasWebhookCapableIntegration).toBe(true);
  });

  it("counts active published profiles as usable without agent bindings", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-home-summary-non-agent-binding@example.com",
    });

    await seedSandboxProfile({
      env,
      profileId: "sbp_home_summary_non_agent",
      organizationId: session.organizationId,
      activeVersion: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId: "sbp_home_summary_non_agent",
      version: 1,
    });

    const body = await readHomeSummary(env, session.cookie);
    expect(body.onboarding.hasUsableProfiles).toBe(true);
    expect(body.onboarding.hasWebhookCapableIntegration).toBe(false);
  });
});

type HomeSummary = ReturnType<typeof homeSummaryResponseSchema.parse>;

async function expectHomeSummary(
  env: IntegrationTestEnvironment,
  cookie: string,
  expected: HomeSummary,
): Promise<void> {
  await expect(readHomeSummary(env, cookie)).resolves.toStrictEqual(expected);
}

async function readHomeSummary(
  env: IntegrationTestEnvironment,
  cookie: string,
): Promise<HomeSummary> {
  const response = await env.controlPlaneApi.http.fetch("/v1/home", {
    headers: {
      cookie,
    },
  });

  expect(response.status).toBe(200);

  return homeSummaryResponseSchema.parse(await response.json());
}

async function seedAgentReadyHomeState(input: {
  env: IntegrationTestEnvironment;
  idPrefix: string;
  organizationId: string;
  userId: string;
  automationKind?: typeof AutomationKinds.SCHEDULE | typeof AutomationKinds.WEBHOOK;
  startedByKind?: "system" | "user";
  startedById?: string;
  sandboxInstanceSource?: SandboxInstanceSource;
}): Promise<void> {
  const targetKey = `openai-home-summary-${input.idPrefix}`;
  const connectionId = `icn_home_summary_${input.idPrefix}`;
  const profileId = `sbp_home_summary_${input.idPrefix}`;

  await seedIntegrationTarget({
    env: input.env,
    targetKey,
    familyId: "openai",
    variantId: "openai-default",
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: connectionId,
      organizationId: input.organizationId,
      targetKey,
      displayName: "OpenAI",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
  await seedSandboxProfile({
    env: input.env,
    profileId,
    organizationId: input.organizationId,
    activeVersion: 1,
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId: profileId,
      version: 1,
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: `ibd_home_summary_${input.idPrefix}`,
      sandboxProfileId: profileId,
      sandboxProfileVersion: 1,
      connectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {},
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automations).values({
    id: `atm_home_summary_${input.idPrefix}`,
    organizationId: input.organizationId,
    kind: input.automationKind ?? AutomationKinds.WEBHOOK,
    name: "Home Summary Automation",
    enabled: true,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: `sbi_home_summary_${input.idPrefix}`,
    organizationId: input.organizationId,
    sandboxProfileId: profileId,
    title: "Investigate issue",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-home-summary-${input.idPrefix}`,
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: input.startedByKind ?? "user",
    startedById: input.startedById ?? input.userId,
    source: input.sandboxInstanceSource ?? SandboxInstanceSources.DASHBOARD,
    createdAt: "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
  });
}

async function seedIntegrationTarget(input: {
  env: IntegrationTestEnvironment;
  targetKey: string;
  familyId: string;
  variantId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey: input.targetKey,
    familyId: input.familyId,
    variantId: input.variantId,
    enabled: true,
    config: {},
  });
}

async function seedSandboxProfile(input: {
  env: IntegrationTestEnvironment;
  profileId: string;
  organizationId: string;
  activeVersion: number | null;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: "Default Profile",
    activeVersion: input.activeVersion,
    status: SandboxProfileStatuses.ACTIVE,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
}
