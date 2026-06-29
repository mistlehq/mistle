/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  ApiKeyActorKinds,
  IntegrationBindingKinds,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { generateApiKeySecret } from "../src/api-keys/services/api-key-secret.js";
import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  DesignerSessionSchema,
  ListDesignerSessionsResponseSchema,
  SaveDesignerSelectedProviderResourcesResponseSchema,
} from "../src/designer/index.js";
import { SandboxInstancesConflictResponseSchema } from "../src/sandbox-instances/index.js";
import { waitForQueuedStartWorkflowInput } from "./helpers/data-plane-workflows.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const DockerSandboxRuntimeColumns = {
  sandboxProvider: "docker",
  sandboxConnectionId: null,
  sandboxVcpuCount: null,
  sandboxMemoryMb: null,
  sandboxDiskMb: null,
} as const;

describe.concurrent("designer sessions integration", () => {
  it("saves selected provider resources to a sandbox profile draft through a Designer dashboard action", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-dashboard-resource-save@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: "dsn_dashboard_resource_save",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_dashboard_resource_save",
      canvasTabs: [],
      initialPrompt: "Build a PR review workflow.",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "github-designer-dashboard-resource-save",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_designer_dashboard_resource_save",
        organizationId: session.organizationId,
        targetKey: "github-designer-dashboard-resource-save",
        displayName: "GitHub Dashboard Resource Save",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-test",
          client_id: "Iv1.test",
          installation_id: "456",
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-designer-dashboard-resource-save",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_designer_dashboard_resource_save_agent",
        organizationId: session.organizationId,
        targetKey: "openai-designer-dashboard-resource-save",
        displayName: "OpenAI Dashboard Resource Save",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_designer_dashboard_resource_save",
        familyId: "github",
        kind: "repository",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 2,
        lastSyncedAt: "2026-06-29T00:00:00.000Z",
        lastSyncStartedAt: "2026-06-29T00:00:00.000Z",
        lastSyncFinishedAt: "2026-06-29T00:00:10.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values([
      {
        id: "rsc_designer_dashboard_resource_save_mistle",
        connectionId: "icn_designer_dashboard_resource_save",
        familyId: "github",
        kind: "repository",
        externalId: "1001",
        handle: "mistlehq/mistle",
        displayName: "mistlehq/mistle",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        metadata: {},
        lastSeenAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "rsc_designer_dashboard_resource_save_docs",
        connectionId: "icn_designer_dashboard_resource_save",
        familyId: "github",
        kind: "repository",
        externalId: "1002",
        handle: "mistlehq/docs",
        displayName: "mistlehq/docs",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        metadata: {},
        lastSeenAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_designer_dashboard_resource_save",
        organizationId: session.organizationId,
        displayName: "Designer Dashboard Resource Save",
        createdAt: "2026-06-29T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_designer_dashboard_resource_save",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        ...DockerSandboxRuntimeColumns,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_designer_dashboard_resource_save_agent",
          sandboxProfileId: "sbp_designer_dashboard_resource_save",
          sandboxProfileVersion: 1,
          connectionId: "icn_designer_dashboard_resource_save_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/designer/sessions/dsn_dashboard_resource_save/dashboard-actions/save-selected-provider-resources",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          targetDraft: {
            profileId: "sbp_designer_dashboard_resource_save",
            version: 1,
          },
          connectionId: "icn_designer_dashboard_resource_save",
          resourceKind: "repository",
          selectedHandles: ["mistlehq/mistle", "mistlehq/docs", "mistlehq/mistle"],
          bindingIntent: "git-repositories",
        }),
      },
    );

    const responseBody = await response.json();
    expect(response.status).toBe(200);
    const receipt = SaveDesignerSelectedProviderResourcesResponseSchema.parse(responseBody);
    expect(receipt).toMatchObject({
      kind: "sandbox-profile-draft-provider-resources-saved",
      profileId: "sbp_designer_dashboard_resource_save",
      version: 1,
      connectionId: "icn_designer_dashboard_resource_save",
      resourceKind: "repository",
      bindingIntent: "git-repositories",
      selectedHandles: ["mistlehq/mistle", "mistlehq/docs"],
      createdBinding: true,
    });

    const bindings =
      await env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findMany({
        where: (table, { and, eq: whereEq }) =>
          and(
            whereEq(table.sandboxProfileId, "sbp_designer_dashboard_resource_save"),
            whereEq(table.sandboxProfileVersion, 1),
          ),
        orderBy: (table, { asc }) => [asc(table.kind)],
      });
    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ibd_designer_dashboard_resource_save_agent",
          kind: IntegrationBindingKinds.AGENT,
          connectionId: "icn_designer_dashboard_resource_save_agent",
          config: {},
        }),
        expect.objectContaining({
          id: receipt.bindingId,
          kind: IntegrationBindingKinds.GIT,
          connectionId: "icn_designer_dashboard_resource_save",
          config: expect.objectContaining({
            repositories: ["mistlehq/mistle", "mistlehq/docs"],
          }),
        }),
      ]),
    );
  });

  it("creates, lists, reads, and updates a Designer session in the authenticated organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-integration-create",
        prompt: "Build a triage agent for GitHub issues and Linear bugs.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());
    expect(created).toMatchObject({
      organizationId: session.organizationId,
      status: "pending",
      connectable: false,
      initialPrompt: "Build a triage agent for GitHub issues and Linear bugs.",
      canvasTabs: [],
    });
    expect(created.id).toMatch(/^dsn_[a-zA-Z0-9_-]+$/);
    expect(created.sandboxInstanceId).toMatch(/^sbi_[a-zA-Z0-9_-]+$/);
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: created.sandboxInstanceId,
    });
    const platformOpenAiRoute = queuedWorkflowInput.runtimePlan.egressRoutes.find(
      (route) => route.credentialResolver.kind === "platform_openai_api_key",
    );
    expect(platformOpenAiRoute?.upstream.baseUrl).toBe("https://api.openai.com/v1");
    const codexConfig = queuedWorkflowInput.runtimePlan.runtimeClients
      .flatMap((client) => client.setup.files)
      .find((file) => file.fileId === "codex_config");
    const codexRuntimeProcess = queuedWorkflowInput.runtimePlan.runtimeClients
      .flatMap((client) => client.processes)
      .find((process) => process.processKey === "codex-app-server");
    expect(queuedWorkflowInput.runtimePlan.artifacts).toEqual([]);
    expect(codexRuntimeProcess?.command.args[0]).toBe("codex");
    expect(codexConfig?.content).toContain('base_url = "https://api.openai.com/v1"');
    expect(codexConfig?.content).toContain("[mcp_servers.mistle_docs]");
    expect(codexConfig?.content).toContain('url = "https://docs.mistle.dev/mcp"');
    const codexAgents = queuedWorkflowInput.runtimePlan.runtimeClients
      .flatMap((client) => client.setup.files)
      .find((file) => file.fileId === "codex_global_agents");
    expect(extractManagedInstructionBlockIds(codexAgents?.content ?? "")).toEqual([
      "mistle-designer-context",
      "mistle-designer-behavior",
      "mistle-designer-initial-request",
    ]);

    const listResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(listResponse.status).toBe(200);
    const list = ListDesignerSessionsResponseSchema.parse(await listResponse.json());
    expect(list.items.map((item) => item.id)).toContain(created.id);
    expect(list.items.find((item) => item.id === created.id)).toMatchObject({
      sandboxInstanceId: created.sandboxInstanceId,
      status: "pending",
    });
    expect(list.items.find((item) => item.id === created.id)).not.toHaveProperty("canvasTabs");

    const getResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(getResponse.status).toBe(200);
    const read = DesignerSessionSchema.parse(await getResponse.json());
    expect(read).toMatchObject({
      id: created.id,
      organizationId: session.organizationId,
      sandboxInstanceId: created.sandboxInstanceId,
      canvasTabs: [],
    });

    const getBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(getBySandboxInstanceResponse.status).toBe(200);
    expect(DesignerSessionSchema.parse(await getBySandboxInstanceResponse.json())).toMatchObject({
      id: created.id,
      organizationId: session.organizationId,
      sandboxInstanceId: created.sandboxInstanceId,
      canvasTabs: [],
    });

    const genericConnectionTokenResponse = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/instances/${encodeURIComponent(created.sandboxInstanceId)}/connection-tokens`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(genericConnectionTokenResponse.status).toBe(404);

    const designerConnectionTokenResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/connection-token`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(designerConnectionTokenResponse.status).toBe(409);
    const designerConnectionTokenConflict = SandboxInstancesConflictResponseSchema.parse(
      await designerConnectionTokenResponse.json(),
    );
    expect(designerConnectionTokenConflict.code).toBe("INSTANCE_NOT_RESUMABLE");
    expect(designerConnectionTokenConflict.message).toContain(
      `Sandbox instance '${created.sandboxInstanceId}' is 'pending' and is not connectable.`,
    );

    const updateResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              kind: "route",
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
            {
              kind: "route",
              id: "sandbox-profile",
              title: "Sandbox Profile",
              href: "/sandbox-profiles/sbp_designer/draft",
            },
          ],
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    const updated = DesignerSessionSchema.parse(await updateResponse.json());
    expect(updated.canvasTabs).toEqual([
      {
        kind: "route",
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
      {
        kind: "route",
        id: "sandbox-profile",
        title: "Sandbox Profile",
        href: "/sandbox-profiles/sbp_designer/draft",
      },
    ]);

    const updateBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              kind: "route",
              id: "session",
              title: "Session",
              href: `/sessions/${created.sandboxInstanceId}`,
            },
          ],
        }),
      },
    );
    expect(updateBySandboxInstanceResponse.status).toBe(200);
    expect(
      DesignerSessionSchema.parse(await updateBySandboxInstanceResponse.json()).canvasTabs,
    ).toEqual([
      {
        kind: "route",
        id: "session",
        title: "Session",
        href: `/sessions/${created.sandboxInstanceId}`,
      },
    ]);
  });

  it("requires an idempotency key when creating a Designer session", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-idempotency-key-required@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({}),
    });

    expect(createResponse.status).toBe(400);
  });

  it("recovers the Designer session id embedded in an idempotently accepted sandbox start", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-idempotent-recovery@example.com",
    });
    const idempotencyKey = "designer-session-idempotent-recovery";

    const firstCreateResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey,
        prompt: "Build an idempotent Designer session recovery check.",
      }),
    });
    expect(firstCreateResponse.status).toBe(201);
    const firstCreated = DesignerSessionSchema.parse(await firstCreateResponse.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: firstCreated.sandboxInstanceId,
    });
    const designerMcpRoute = queuedWorkflowInput.runtimePlan.egressRoutes.find(
      (route) => route.credentialResolver.kind === "mistle_mcp_designer_token",
    );
    expect(designerMcpRoute?.credentialResolver).toEqual({
      kind: "mistle_mcp_designer_token",
      designerSessionId: firstCreated.id,
    });

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.designerSessions)
      .where(eq(env.controlPlaneTables.designerSessions.id, firstCreated.id));

    const retryCreateResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey,
        prompt: "Build an idempotent Designer session recovery check.",
      }),
    });
    expect(retryCreateResponse.status).toBe(201);
    const retryCreated = DesignerSessionSchema.parse(await retryCreateResponse.json());
    expect(retryCreated).toMatchObject({
      id: firstCreated.id,
      sandboxInstanceId: firstCreated.sandboxInstanceId,
    });
  });

  it("rejects Designer canvas tabs with non-dashboard-internal hrefs", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-canvas-href-validation@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-canvas-href-validation",
        prompt: "Build a Designer canvas validation check.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    for (const href of ["http://[", "https://example.com/integrations", "//example.com"]) {
      const updateResponse = await env.controlPlaneApi.http.fetch(
        `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            tabs: [
              {
                kind: "route",
                id: "invalid",
                title: "Invalid",
                href,
              },
            ],
          }),
        },
      );
      expect(updateResponse.status).toBe(400);
    }

    for (const tab of [
      {
        kind: "route",
        id: "designer-blueprint-current",
        title: "Blueprint",
        href: "/integrations",
      },
      {
        kind: "route",
        id: "blueprint-route",
        title: "Blueprint",
        href: "/designer/blueprints/current",
      },
    ]) {
      const updateResponse = await env.controlPlaneApi.http.fetch(
        `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            tabs: [tab],
          }),
        },
      );
      expect(updateResponse.status).toBe(400);
    }
  });

  it("does not expose Designer sessions across organizations", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-designer-session-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-designer-session-org-b@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: firstOrgSession.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-integration-org-boundary",
        prompt: "Build an organization-scoped Designer agent.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    const getFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );
    expect(getFromOtherOrgResponse.status).toBe(404);

    const getBySandboxInstanceFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}`,
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );
    expect(getBySandboxInstanceFromOtherOrgResponse.status).toBe(404);

    const updateFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: secondOrgSession.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              kind: "route",
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(updateFromOtherOrgResponse.status).toBe(404);

    const updateBySandboxInstanceFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: secondOrgSession.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              kind: "route",
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(updateBySandboxInstanceFromOtherOrgResponse.status).toBe(404);
  });

  it("fails explicitly when a Designer session references a missing backing sandbox", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-missing-sandbox@example.com",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: "dsn_missing_backing_sandbox",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_missing_backing_sandbox",
      initialPrompt: "Build a Designer missing sandbox regression.",
      canvasTabs: [],
    });

    const getResponse = await env.controlPlaneApi.http.fetch(
      "/v1/designer/sessions/dsn_missing_backing_sandbox",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(getResponse.status).toBe(404);
    expect(await getResponse.json()).toMatchObject({
      code: "DESIGNER_SESSION_NOT_FOUND",
      message: "Designer session sandbox instance 'sbi_missing_backing_sandbox' was not found.",
    });

    const updateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/designer/sessions/dsn_missing_backing_sandbox/canvas-tabs",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              kind: "route",
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );

    expect(updateResponse.status).toBe(404);
    const persistedDesignerSession = await env.controlPlaneDb.query.designerSessions.findFirst({
      where: (table, { eq }) => eq(table.id, "dsn_missing_backing_sandbox"),
    });
    expect(persistedDesignerSession?.canvasTabs).toEqual([]);
  });

  it("rejects API key actors on Designer routes", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-api-key@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-api-key-rejection-create",
        prompt: "Build an API key rejection test Designer agent.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    const apiKeySecret = generateApiKeySecret();
    await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeys).values({
      id: "apk_designer_session_rejection",
      organizationId: session.organizationId,
      name: "Designer rejection",
      secretPrefix: apiKeySecret.secretPrefix,
      secretHash: apiKeySecret.secretHash,
      secretHashAlgorithm: apiKeySecret.secretHashAlgorithm,
      createdByActorKind: ApiKeyActorKinds.USER,
      createdByActorId: session.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeyPermissions).values([
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_CREATE,
      },
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_READ,
      },
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_UPDATE,
      },
    ]);

    const apiKeyHeaders = {
      authorization: `Bearer ${apiKeySecret.token}`,
      "content-type": "application/json",
    };

    const rejectedCreateResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: apiKeyHeaders,
      body: JSON.stringify({
        idempotencyKey: "designer-session-api-key-rejection-forbidden",
        prompt: "Build a forbidden API key Designer agent.",
      }),
    });
    expect(rejectedCreateResponse.status).toBe(403);

    const rejectedListResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      headers: {
        authorization: `Bearer ${apiKeySecret.token}`,
      },
    });
    expect(rejectedListResponse.status).toBe(403);

    const rejectedGetResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
        },
      },
    );
    expect(rejectedGetResponse.status).toBe(403);

    const rejectedGetBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}`,
      {
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
        },
      },
    );
    expect(rejectedGetBySandboxInstanceResponse.status).toBe(403);

    const rejectedUpdateResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: apiKeyHeaders,
        body: JSON.stringify({
          tabs: [
            {
              kind: "route",
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(rejectedUpdateResponse.status).toBe(403);

    const rejectedUpdateBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}/canvas-tabs`,
      {
        method: "PUT",
        headers: apiKeyHeaders,
        body: JSON.stringify({
          tabs: [
            {
              kind: "route",
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(rejectedUpdateBySandboxInstanceResponse.status).toBe(403);
  });
});

function extractManagedInstructionBlockIds(content: string): string[] {
  const blockIds: string[] = [];
  let openBlockId: string | null = null;
  const markerPattern = /<!-- MISTLE-MANAGED:(START|END) ([^ ]+) -->/g;
  let marker = markerPattern.exec(content);

  while (marker !== null) {
    const markerKind = marker[1];
    const blockId = marker[2];
    if (markerKind === undefined) {
      throw new Error("Expected managed instruction marker to include a marker kind.");
    }
    if (blockId === undefined) {
      throw new Error("Expected managed instruction marker to include a block id.");
    }

    if (markerKind === "START") {
      if (openBlockId !== null) {
        throw new Error(`Managed instruction block '${openBlockId}' was not closed.`);
      }
      openBlockId = blockId;
    } else {
      if (openBlockId === null) {
        throw new Error(`Managed instruction block '${blockId}' ended before it started.`);
      }
      if (openBlockId !== blockId) {
        throw new Error(`Managed instruction block '${openBlockId}' ended with '${blockId}'.`);
      }
      blockIds.push(blockId);
      openBlockId = null;
    }

    marker = markerPattern.exec(content);
  }

  if (openBlockId !== null) {
    throw new Error(`Managed instruction block '${openBlockId}' was not closed.`);
  }

  return blockIds;
}
