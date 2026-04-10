import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import {
  CompiledRuntimePlanSchema,
  DefaultSandboxWorkspaceDir,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import {
  StartSandboxProfileInstanceBadRequestResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
  StartSandboxProfileInstanceResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createDisposableDataPlaneRuntime } from "./helpers/disposable-data-plane-runtime.js";
import { it } from "./test-context.js";

const RuntimePlanPersistTimeoutMs = 30_000;
const RuntimePlanPersistPollIntervalMs = 100;

async function waitForPersistedRuntimePlan(input: {
  dataPlaneDb: Awaited<ReturnType<typeof createDisposableDataPlaneRuntime>>["db"];
  sandboxInstanceId: string;
}) {
  const deadline = Date.now() + RuntimePlanPersistTimeoutMs;

  while (Date.now() < deadline) {
    const persistedRuntimePlan =
      await input.dataPlaneDb.query.sandboxInstanceRuntimePlans.findFirst({
        columns: {
          compiledRuntimePlan: true,
        },
        where: (table, { and, eq, isNull }) =>
          and(eq(table.sandboxInstanceId, input.sandboxInstanceId), isNull(table.supersededAt)),
      });
    if (persistedRuntimePlan !== undefined) {
      return CompiledRuntimePlanSchema.parse(persistedRuntimePlan.compiledRuntimePlan);
    }

    await systemSleeper.sleep(RuntimePlanPersistPollIntervalMs);
  }

  throw new Error(`Timed out waiting for runtime plan for sandbox '${input.sandboxInstanceId}'.`);
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
      const runtimePlan = await waitForPersistedRuntimePlan({
        dataPlaneDb: dataPlaneFixture.db,
        sandboxInstanceId: body.sandboxInstanceId,
      });

      expect(runtimePlan.agentRuntimes[0]?.ptyLaunch.newLaunch.cwd).toBe("/root/mistlehq/platform");
      expect(runtimePlan.agentRuntimes[0]?.ptyLaunch.resumeLaunch.cwd).toBe(
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
      const runtimePlan = await waitForPersistedRuntimePlan({
        dataPlaneDb: dataPlaneFixture.db,
        sandboxInstanceId: body.sandboxInstanceId,
      });

      expect(runtimePlan.agentRuntimes[0]?.ptyLaunch.newLaunch.cwd).toBe(
        DefaultSandboxWorkspaceDir,
      );
      expect(runtimePlan.agentRuntimes[0]?.ptyLaunch.resumeLaunch.cwd).toBe(
        DefaultSandboxWorkspaceDir,
      );
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
