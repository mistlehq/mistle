import {
  automations,
  integrationConnections,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationTargets,
  members,
  SandboxProfileVersionStates,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  sandboxProfiles,
  SandboxProfileStatuses,
} from "@mistle/db/control-plane";
import {
  sandboxInstances,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect } from "vitest";

import { homeSummaryResponseSchema } from "../src/home/schema.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { it } from "./test-context.js";

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
    }
  }
});

describe("home summary integration", () => {
  it("returns onboarding readiness booleans for the authenticated organization", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_home_summary",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-home-summary@example.com",
    });

    const baselineResponse = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(baselineResponse.status).toBe(200);
    const baselineBody = homeSummaryResponseSchema.parse(await baselineResponse.json());
    expect(baselineBody).toStrictEqual({
      onboarding: {
        hasIntegrations: false,
        hasProfiles: false,
        hasUsableProfiles: false,
        hasStartedSession: false,
        hasWebhookCapableIntegration: false,
        hasAutomations: false,
      },
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-home-summary",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {},
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_home_summary",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-home-summary",
      displayName: "OpenAI",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_home_summary",
      organizationId: authenticatedSession.organizationId,
      displayName: "Default Profile",
      activeVersion: 1,
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_home_summary",
      version: 1,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_home_summary",
      sandboxProfileId: "sbp_home_summary",
      sandboxProfileVersion: 1,
      connectionId: "icn_home_summary",
      kind: "agent",
      config: {},
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await fixture.db.insert(automations).values({
      id: "atm_home_summary",
      organizationId: authenticatedSession.organizationId,
      kind: "webhook",
      name: "Home Summary Automation",
      enabled: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_home_summary",
      organizationId: authenticatedSession.organizationId,
      sandboxProfileId: "sbp_home_summary",
      title: "Investigate issue",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-home-summary",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: authenticatedSession.userId,
      source: "dashboard",
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    });

    const seededResponse = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(seededResponse.status).toBe(200);
    const seededBody = homeSummaryResponseSchema.parse(await seededResponse.json());
    expect(seededBody).toStrictEqual({
      onboarding: {
        hasIntegrations: true,
        hasProfiles: true,
        hasUsableProfiles: true,
        hasStartedSession: true,
        hasWebhookCapableIntegration: false,
        hasAutomations: true,
      },
    });
  });

  it("does not count inactive connections as completed integrations", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_home_summary_inactive_connection",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-home-summary-inactive-connection@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-home-summary-inactive",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {},
    });
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_home_summary_inactive",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-home-summary-inactive",
        displayName: "OpenAI inactive",
        status: IntegrationConnectionStatuses.ERROR,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const response = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(200);
    const body = homeSummaryResponseSchema.parse(await response.json());
    expect(body.onboarding.hasIntegrations).toBe(false);
    expect(body.onboarding.hasWebhookCapableIntegration).toBe(false);
  });

  it("uses the active published version when a newer draft exists", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_home_summary_active_version",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-home-summary-active-version@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-home-summary-active-version",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {},
    });
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_home_summary_active_version",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-home-summary-active-version",
        displayName: "OpenAI",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "icn_home_summary_active_version_inactive",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-home-summary-active-version",
        displayName: "OpenAI inactive",
        status: IntegrationConnectionStatuses.ERROR,
        createdAt: "2026-03-02T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
      },
    ]);
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_home_summary_active_version",
      organizationId: authenticatedSession.organizationId,
      displayName: "Default Profile",
      activeVersion: 1,
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfileVersions).values([
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
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_home_summary_active_version_v1",
        sandboxProfileId: "sbp_home_summary_active_version",
        sandboxProfileVersion: 1,
        connectionId: "icn_home_summary_active_version",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "ibd_home_summary_active_version_v2",
        sandboxProfileId: "sbp_home_summary_active_version",
        sandboxProfileVersion: 2,
        connectionId: "icn_home_summary_active_version_inactive",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
        createdAt: "2026-03-02T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
      },
    ]);

    const response = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = homeSummaryResponseSchema.parse(await response.json());
    expect(body.onboarding).toMatchObject({
      hasProfiles: true,
      hasUsableProfiles: true,
    });
  });

  it("returns 403 when the active organization membership has been revoked", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-home-summary-revoked-membership@example.com",
    });

    await fixture.db
      .delete(members)
      .where(
        and(
          eq(members.organizationId, authenticatedSession.organizationId),
          eq(members.userId, authenticatedSession.userId),
        ),
      );

    const response = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("counts system-started sandbox instances as a started session", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_home_summary_system_started",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-home-summary-system-started@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-home-summary-system-started",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {},
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_home_summary_system_started",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-home-summary-system-started",
      displayName: "OpenAI",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_home_summary_system_started",
      organizationId: authenticatedSession.organizationId,
      displayName: "Default Profile",
      activeVersion: 1,
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_home_summary_system_started",
      version: 1,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_home_summary_system_started",
      sandboxProfileId: "sbp_home_summary_system_started",
      sandboxProfileVersion: 1,
      connectionId: "icn_home_summary_system_started",
      kind: "agent",
      config: {},
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_home_summary_system_started",
      organizationId: authenticatedSession.organizationId,
      sandboxProfileId: "sbp_home_summary_system_started",
      title: "Automation-triggered task",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-home-summary-system-started",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "system",
      startedById: "aru_home_summary_system_started",
      source: SandboxInstanceSources.WEBHOOK,
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(200);
    const body = homeSummaryResponseSchema.parse(await response.json());
    expect(body.onboarding).toMatchObject({
      hasIntegrations: true,
      hasProfiles: true,
      hasUsableProfiles: true,
      hasStartedSession: true,
    });
  });

  it("does not count active non-agent integrations as completed integrations", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_home_summary_non_agent_connection",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-home-summary-non-agent-connection@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "github-home-summary-active-git",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {},
    });
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_home_summary_active_git",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-home-summary-active-git",
        displayName: "GitHub",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const response = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(200);
    const body = homeSummaryResponseSchema.parse(await response.json());
    expect(body.onboarding.hasIntegrations).toBe(false);
    expect(body.onboarding.hasWebhookCapableIntegration).toBe(true);
  });

  it("ignores non-agent bindings when checking whether a profile is usable", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_home_summary_non_agent_binding",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-home-summary-non-agent-binding@example.com",
    });

    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "openai-home-summary-agent",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {},
      },
      {
        targetKey: "github-home-summary-git",
        familyId: "github",
        variantId: "github-default",
        enabled: true,
        config: {},
      },
    ]);
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_home_summary_agent",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-home-summary-agent",
        displayName: "OpenAI",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "icn_home_summary_git",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-home-summary-git",
        displayName: "GitHub",
        status: IntegrationConnectionStatuses.ERROR,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_home_summary_non_agent",
      organizationId: authenticatedSession.organizationId,
      displayName: "Profile with stale git binding",
      activeVersion: 1,
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_home_summary_non_agent",
      version: 1,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_home_summary_agent",
        sandboxProfileId: "sbp_home_summary_non_agent",
        sandboxProfileVersion: 1,
        connectionId: "icn_home_summary_agent",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "ibd_home_summary_git",
        sandboxProfileId: "sbp_home_summary_non_agent",
        sandboxProfileVersion: 1,
        connectionId: "icn_home_summary_git",
        kind: IntegrationBindingKinds.GIT,
        config: {},
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const response = await fixture.request("/v1/home", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(200);
    const body = homeSummaryResponseSchema.parse(await response.json());
    expect(body.onboarding.hasUsableProfiles).toBe(true);
    expect(body.onboarding.hasWebhookCapableIntegration).toBe(false);
  });
});
