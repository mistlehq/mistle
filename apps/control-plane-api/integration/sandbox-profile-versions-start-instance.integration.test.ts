import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  UserExternalPrincipalStatuses,
  userExternalPrincipals,
} from "@mistle/db/control-plane";
import {
  CompiledRuntimePlanSchema,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  StartSandboxProfileInstanceBadRequestResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
  StartSandboxProfileInstanceResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createDisposableDataPlaneRuntime } from "./helpers/disposable-data-plane-runtime.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;
const StartWorkflowName = "data-plane.sandbox-instances.start";

const WorkflowRunInputSchema = z.looseObject({
  sandboxInstanceId: z.string().min(1),
  actingUserId: z.string().min(1).optional(),
  runtimePlan: CompiledRuntimePlanSchema,
  gitIdentity: z
    .object({
      name: z.string().min(1),
      email: z.email(),
    })
    .optional(),
});

async function waitForQueuedStartWorkflowInput(input: {
  dataPlaneDbPool: Awaited<ReturnType<typeof createDisposableDataPlaneRuntime>>["dbPool"];
  workflowNamespaceId: string;
  sandboxInstanceId: string;
}) {
  const deadline = Date.now() + WorkflowRunPersistTimeoutMs;

  while (Date.now() < deadline) {
    const result = await input.dataPlaneDbPool.query<{ input: unknown }>(
      `
        select input
        from data_plane_openworkflow.workflow_runs
        where
          namespace_id = $1
          and workflow_name = $2
          and input->>'sandboxInstanceId' = $3
        order by created_at desc
        limit 1
      `,
      [input.workflowNamespaceId, StartWorkflowName, input.sandboxInstanceId],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return WorkflowRunInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued start workflow input for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function insertIdentityLinkProviderConfig(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
  configId: string;
  providerFamily: string;
  targetKey: string;
  connectionId: string;
}): Promise<void> {
  await input.fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
    id: input.configId,
    organizationId: input.organizationId,
    providerFamily: input.providerFamily,
    status: "active",
    integrationTargetKey: input.targetKey,
    integrationConnectionId: input.connectionId,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
  });
}

describe("sandbox profile version start instance integration", () => {
  it("returns 404 when the sandbox profile version does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_missing_version",
      organizationId: authenticatedSession.organizationId,
      displayName: "Missing Version Profile",
      status: "active",
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_missing_version/versions/9/instances",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(404);

    const body = StartSandboxProfileInstanceNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_VERSION_NOT_FOUND");
  });

  it("returns 400 when compile preflight fails", async ({ fixture }) => {
    const targetKey = "openai-start-instance-preflight";
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-compile-error@example.com",
    });
    const otherOrganizationSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-compile-error-other-org@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_compile_error",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Error Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_compile_error",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_missing_connection",
      organizationId: otherOrganizationSession.organizationId,
      targetKey,
      displayName: "Foreign connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_start_instance_compile_error",
      sandboxProfileId: "sbp_start_instance_compile_error",
      sandboxProfileVersion: 1,
      connectionId: "icn_missing_connection",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
        model: {
          defaultModel: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
          },
        },
      },
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_compile_error/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(400);

    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    if (!("code" in body)) {
      throw new Error("Expected sandbox profile compile error response.");
    }
    expect(body.code).toBe("INVALID_BINDING_CONNECTION_REFERENCE");
  });

  it("returns 400 when the sandbox profile version has no agent binding", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-missing-agent-binding@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_missing_agent_binding",
      organizationId: authenticatedSession.organizationId,
      displayName: "Missing Agent Binding Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_missing_agent_binding",
      version: 1,
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_missing_agent_binding/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(400);

    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    if (!("code" in body)) {
      throw new Error("Expected sandbox profile compile error response.");
    }
    expect(body.code).toBe("AGENT_RUNTIME_REQUIRED");
  });

  it("starts the session in the selected primary repository", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_start_instance_repository",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-primary-repository@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_primary_repository",
      organizationId: authenticatedSession.organizationId,
      displayName: "Primary Repository Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_primary_repository",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "openai-start-instance-primary-repository",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
          binding_capabilities_by_connection_method:
            createOpenAiRawBindingCapabilitiesByConnectionMethod(),
        },
      },
      {
        targetKey: "github-start-instance-primary-repository",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    ]);
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_start_instance_primary_repository_agent",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-start-instance-primary-repository",
        displayName: "Primary repository agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_start_instance_primary_repository_git",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-start-instance-primary-repository",
        displayName: "Primary repository git connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_start_instance_primary_repository_agent",
        sandboxProfileId: "sbp_start_instance_primary_repository",
        sandboxProfileVersion: 1,
        connectionId: "icn_start_instance_primary_repository_agent",
        kind: IntegrationBindingKinds.AGENT,
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {
              reasoningEffort: "medium",
            },
          },
        },
      },
      {
        id: "ibd_start_instance_primary_repository_git",
        sandboxProfileId: "sbp_start_instance_primary_repository",
        sandboxProfileVersion: 1,
        connectionId: "icn_start_instance_primary_repository_git",
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle", "mistlehq/platform"],
          tools: [],
        },
      },
    ]);

    try {
      const response = await fixture.request(
        "/v1/sandbox/profiles/sbp_start_instance_primary_repository/versions/1/instances",
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            primaryRepositoryId: "mistlehq/platform",
          }),
        },
      );
      expect(response.status).toBe(201);

      const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
      const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: body.sandboxInstanceId,
      });

      expect(queuedWorkflowInput.runtimePlan?.agentRuntimes[0]?.ptyLaunch.newLaunch.cwd).toBe(
        "/root/mistlehq/platform",
      );
      expect(queuedWorkflowInput.runtimePlan?.agentRuntimes[0]?.ptyLaunch.resumeLaunch.cwd).toBe(
        "/root/mistlehq/platform",
      );
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("starts the session at the workspace root when no primary repository is selected", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_start_instance_workspace_root",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-workspace-root@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_workspace_root",
      organizationId: authenticatedSession.organizationId,
      displayName: "Workspace Root Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_workspace_root",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-start-instance-workspace-root",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
        binding_capabilities_by_connection_method:
          createOpenAiRawBindingCapabilitiesByConnectionMethod(),
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_start_instance_workspace_root_agent",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-start-instance-workspace-root",
      displayName: "Workspace root agent connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_start_instance_workspace_root_agent",
      sandboxProfileId: "sbp_start_instance_workspace_root",
      sandboxProfileVersion: 1,
      connectionId: "icn_start_instance_workspace_root_agent",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
        model: {
          defaultModel: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
          },
        },
      },
    });

    try {
      const response = await fixture.request(
        "/v1/sandbox/profiles/sbp_start_instance_workspace_root/versions/1/instances",
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            primaryRepositoryId: null,
          }),
        },
      );
      expect(response.status).toBe(201);

      const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
      const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: body.sandboxInstanceId,
      });

      expect(queuedWorkflowInput.runtimePlan?.agentRuntimes[0]?.ptyLaunch.newLaunch.cwd).toBe(
        undefined,
      );
      expect(queuedWorkflowInput.runtimePlan?.agentRuntimes[0]?.ptyLaunch.resumeLaunch.cwd).toBe(
        undefined,
      );
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("queues linked GitHub git identity for the acting dashboard user", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_start_instance_git_identity",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-git-identity@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_git_identity",
      organizationId: authenticatedSession.organizationId,
      displayName: "Git Identity Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_git_identity",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "openai-start-instance-git-identity",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
          binding_capabilities_by_connection_method:
            createOpenAiRawBindingCapabilitiesByConnectionMethod(),
        },
      },
      {
        targetKey: "github-start-instance-git-identity",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    ]);
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_start_instance_git_identity_agent",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-start-instance-git-identity",
        displayName: "Git identity agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_start_instance_git_identity_provider",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-start-instance-git-identity",
        displayName: "Git identity provider connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.mistleGitIdentity",
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_start_instance_git_identity_agent",
      sandboxProfileId: "sbp_start_instance_git_identity",
      sandboxProfileVersion: 1,
      connectionId: "icn_start_instance_git_identity_agent",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
        model: {
          defaultModel: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
          },
        },
      },
    });
    await insertIdentityLinkProviderConfig({
      fixture,
      organizationId: authenticatedSession.organizationId,
      userId: authenticatedSession.userId,
      configId: "ilp_start_instance_git_identity",
      providerFamily: "github",
      targetKey: "github-start-instance-git-identity",
      connectionId: "icn_start_instance_git_identity_provider",
    });
    await fixture.db.insert(userExternalPrincipals).values({
      id: "uep_start_instance_git_identity",
      organizationId: authenticatedSession.organizationId,
      userId: authenticatedSession.userId,
      providerFamily: "github",
      providerSubjectId: "12345",
      organizationProviderConfigId: "ilp_start_instance_git_identity",
      integrationConnectionId: "icn_start_instance_git_identity_provider",
      status: UserExternalPrincipalStatuses.ACTIVE,
      profile: {
        login: "mistle-user",
        displayName: "Mistle User",
        email: "mistle-user@example.com",
        avatarUrl: "https://avatars.example.com/u/12345",
      },
    });

    try {
      const response = await fixture.request(
        "/v1/sandbox/profiles/sbp_start_instance_git_identity/versions/1/instances",
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(response.status).toBe(201);
      const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());

      const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: body.sandboxInstanceId,
      });
      expect(queuedWorkflowInput.gitIdentity).toEqual({
        name: "Mistle User",
        email: "mistle-user@example.com",
      });
      expect(queuedWorkflowInput.actingUserId).toBe(authenticatedSession.userId);
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("returns 400 when the selected primary repository is not available", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-invalid-primary-repository@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_invalid_primary_repository",
      organizationId: authenticatedSession.organizationId,
      displayName: "Invalid Primary Repository Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_invalid_primary_repository",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "openai-start-instance-invalid-primary-repository",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
          binding_capabilities_by_connection_method:
            createOpenAiRawBindingCapabilitiesByConnectionMethod(),
        },
      },
      {
        targetKey: "github-start-instance-invalid-primary-repository",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    ]);
    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_start_instance_invalid_primary_repository_agent",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-start-instance-invalid-primary-repository",
        displayName: "Invalid primary repository agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_start_instance_invalid_primary_repository_git",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-start-instance-invalid-primary-repository",
        displayName: "Invalid primary repository git connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_start_instance_invalid_primary_repository_agent",
        sandboxProfileId: "sbp_start_instance_invalid_primary_repository",
        sandboxProfileVersion: 1,
        connectionId: "icn_start_instance_invalid_primary_repository_agent",
        kind: IntegrationBindingKinds.AGENT,
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {
              reasoningEffort: "medium",
            },
          },
        },
      },
      {
        id: "ibd_start_instance_invalid_primary_repository_git",
        sandboxProfileId: "sbp_start_instance_invalid_primary_repository",
        sandboxProfileVersion: 1,
        connectionId: "icn_start_instance_invalid_primary_repository_git",
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle"],
          tools: [],
        },
      },
    ]);

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_invalid_primary_repository/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          primaryRepositoryId: "mistlehq/platform",
        }),
      },
    );
    expect(response.status).toBe(400);

    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    if (!("code" in body)) {
      throw new Error("Expected invalid primary repository response.");
    }
    expect(body.code).toBe("INVALID_PRIMARY_REPOSITORY");
  });
});
