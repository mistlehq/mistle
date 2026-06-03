/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { GitHubCredentialSlotKeys } from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  StartSandboxProfileInstanceBadRequestResponseSchema,
  StartSandboxProfileInstanceConflictResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
  StartSandboxProfileInstanceResponseSchema,
  StartSandboxProfileSetupScriptTestRunResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { waitForQueuedStartWorkflowInput } from "./helpers/data-plane-workflows.js";
import { seedConnectionCredential } from "./helpers/integration-connections.js";
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
  sandboxStorageMb: null,
} as const;

const TensorlakeSandboxRuntimeColumns = {
  sandboxProvider: "tensorlake",
  sandboxConnectionId: null,
  sandboxVcpuCount: 2,
  sandboxMemoryMb: 4096,
  sandboxStorageMb: null,
} as const;

describe.concurrent("sandbox profile version start instance integration", () => {
  it("returns 404 when the selected profile version does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-missing-version@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_start_instance_missing_version",
        organizationId: session.organizationId,
        displayName: "Missing Version Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_missing_version/versions/9/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const body = StartSandboxProfileInstanceNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_VERSION_NOT_FOUND");
  });

  it("returns 409 when a published version has no usable snapshot", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-not-usable@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_start_instance_not_usable",
        organizationId: session.organizationId,
        displayName: "Not Usable Profile",
        activeVersion: null,
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_start_instance_not_usable",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-24T00:00:00.000Z",
        ...DockerSandboxRuntimeColumns,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_not_usable/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const body = StartSandboxProfileInstanceConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_VERSION_NOT_USABLE");
  });

  it("returns 400 when compile preflight fails", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-compile-error@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-compile-error-other@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_start_instance_compile_error",
        organizationId: session.organizationId,
        displayName: "Compile Error Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_start_instance_compile_error",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        ...DockerSandboxRuntimeColumns,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-start-instance-preflight",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_missing_connection",
        organizationId: otherSession.organizationId,
        targetKey: "openai-start-instance-preflight",
        displayName: "Foreign connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_start_instance_compile_error",
          sandboxProfileId: "sbp_start_instance_compile_error",
          sandboxProfileVersion: 1,
          connectionId: "icn_missing_connection",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_compile_error/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_BINDING_CONNECTION_REFERENCE");
  });

  it("starts an instance when the selected agent runtime has no proxied provider route", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-missing-agent@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_start_instance_missing_agent_binding",
        organizationId: session.organizationId,
        displayName: "Missing Agent Binding Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_start_instance_missing_agent_binding",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        ...DockerSandboxRuntimeColumns,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_missing_agent_binding/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });
    expect(queuedWorkflowInput.runtimePlan.agentRuntimes).toMatchObject([
      {
        runtimeId: "codex",
      },
    ]);
    expect(queuedWorkflowInput.runtimePlan.egressRoutes).toEqual([]);
  });

  it("starts an instance with an API key that has sandbox session create permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-api-key@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_api_key",
      targetKey: "openai-start-instance-api-key",
      connectionId: "icn_start_instance_api_key",
      bindingId: "ibd_start_instance_api_key",
      versionState: SandboxProfileVersionStates.DRAFT,
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Start profile instance",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_CREATE],
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_api_key/versions/1/instances",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
        },
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });

    expect(queuedWorkflowInput.startedBy.kind).toBe("api_key");
    expect(queuedWorkflowInput.actingUserId).toBeUndefined();
  });

  it("starts the active profile version without specifying a version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-active-instance@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_active_instance",
      targetKey: "openai-start-active-instance",
      connectionId: "icn_start_active_instance",
      bindingId: "ibd_start_active_instance",
      versionState: SandboxProfileVersionStates.PUBLISHED,
      snapshotImageId: "sha256:active-version-image",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_active_instance/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });

    expect(queuedWorkflowInput.sandboxProfileVersion).toBe(1);
    expect(queuedWorkflowInput.image).toEqual({
      imageId: "sha256:active-version-image",
      kind: "snapshot",
      provider: "docker",
    });
  });

  it("returns 409 when starting a profile with no active version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-active-no-active-version@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_start_active_no_active_version",
        organizationId: session.organizationId,
        displayName: "No Active Version Profile",
        activeVersion: null,
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_active_no_active_version/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const body = StartSandboxProfileInstanceConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_VERSION_NOT_USABLE");
  });

  it("rejects an API key without sandbox session create permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-api-key-forbidden@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_api_key_forbidden",
      targetKey: "openai-start-instance-api-key-forbidden",
      connectionId: "icn_start_instance_api_key_forbidden",
      bindingId: "ibd_start_instance_api_key_forbidden",
      versionState: SandboxProfileVersionStates.DRAFT,
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Read sandbox sessions",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_READ],
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_api_key_forbidden/versions/1/instances",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
        },
      },
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 when the setup script test run body is blank", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-script-test-blank@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_test_blank",
        organizationId: session.organizationId,
        displayName: "Setup Script Test Blank Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_script_test_blank",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        ...DockerSandboxRuntimeColumns,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_test_blank/versions/1/setup-script/test-runs",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "   \n\t",
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when a setup script test profile version has no sandbox provider", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-script-test-missing-provider@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_test_missing_provider",
        organizationId: session.organizationId,
        displayName: "Setup Script Test Missing Provider Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_script_test_missing_provider",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_test_missing_provider/versions/1/setup-script/test-runs",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "echo hello",
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("SANDBOX_PROVIDER_REQUIRED");
  });

  it("queues setup script test runs with transient runtime settings without saving the draft", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-script-test-runtime-override@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_test_runtime_override",
        organizationId: session.organizationId,
        displayName: "Setup Script Test Runtime Override Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_script_test_runtime_override",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-setup-script-test-runtime-override",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_setup_script_test_runtime_override_agent",
        organizationId: session.organizationId,
        targetKey: "openai-setup-script-test-runtime-override",
        displayName: "Setup script test runtime override agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_setup_script_test_runtime_override_agent",
          sandboxProfileId: "sbp_setup_script_test_runtime_override",
          sandboxProfileVersion: 1,
          connectionId: "icn_setup_script_test_runtime_override_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_test_runtime_override/versions/1/setup-script/test-runs",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "echo transient runtime",
          agentRuntimeId: "opencode",
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileSetupScriptTestRunResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });
    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.sandboxProfileId, "sbp_setup_script_test_runtime_override"),
          eq(table.version, 1),
        ),
    });

    expect(queuedWorkflowInput.sandboxRuntime).toEqual({
      provider: "docker",
    });
    expect(queuedWorkflowInput.runtimePlan.agentRuntimes[0]).toMatchObject({
      runtimeId: "opencode",
    });
    expect(persistedVersion?.sandboxProvider).toBeNull();
    expect(persistedVersion?.agentRuntimeId).toBe("codex");
  });

  it("returns 400 when transient setup script test runtime settings are invalid", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-script-test-invalid-runtime@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_setup_script_test_invalid_runtime",
      targetKey: "openai-setup-script-test-invalid-runtime",
      connectionId: "icn_setup_script_test_invalid_runtime_agent",
      bindingId: "ibd_setup_script_test_invalid_runtime_agent",
      versionState: SandboxProfileVersionStates.DRAFT,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_test_invalid_runtime/versions/1/setup-script/test-runs",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "echo invalid transient runtime",
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 4,
            memoryMb: 8192,
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_SANDBOX_RUNTIME_CONFIG");
  });

  it("returns 404 when the setup script test run profile belongs to another organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-script-test-org@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-script-test-org-other@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_test_other_org",
        organizationId: otherSession.organizationId,
        displayName: "Other Organization Setup Script Test Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_script_test_other_org",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        ...DockerSandboxRuntimeColumns,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_test_other_org/versions/1/setup-script/test-runs",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "pnpm install",
          sandboxProvider: "invalid-provider",
          sandboxConnectionId: null,
          sandboxResources: null,
        }),
      },
    );

    expect(response.status).toBe(404);
    const body = StartSandboxProfileInstanceNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  });

  it("queues setup script test runs from the base image with the requested setup script", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-setup-script-test-launch@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_test_launch",
        organizationId: session.organizationId,
        displayName: "Setup Script Test Launch Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_script_test_launch",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo persisted setup script",
        ...DockerSandboxRuntimeColumns,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-setup-script-test-launch",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_setup_script_test_launch_agent",
        organizationId: session.organizationId,
        targetKey: "openai-setup-script-test-launch",
        displayName: "Setup script test agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_setup_script_test_launch_agent",
          sandboxProfileId: "sbp_setup_script_test_launch",
          sandboxProfileVersion: 1,
          connectionId: "icn_setup_script_test_launch_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_test_launch/versions/1/setup-script/test-runs",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "echo visible editor setup script",
          idempotencyKey: "setup-script-test-launch-001",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileSetupScriptTestRunResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });

    expect(queuedWorkflowInput.purpose).toBe("setup_check");
    expect(queuedWorkflowInput.image?.kind).toBe("base");
    expect(queuedWorkflowInput.runtimePlan.image.source).toBe("base");
    expect(queuedWorkflowInput.runtimePlan.agentRuntimes).toHaveLength(1);
    expect(queuedWorkflowInput.runtimePlan.setupScript).toBe("echo visible editor setup script");
  });

  it("queues launches for usable published versions from the stored snapshot image", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-snapshot-launch@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_snapshot_launch",
      targetKey: "openai-start-instance-snapshot-launch",
      connectionId: "icn_start_instance_snapshot_launch",
      bindingId: "ibd_start_instance_snapshot_launch",
      versionState: SandboxProfileVersionStates.PUBLISHED,
      snapshotImageId: "sha256:snapshot-launch-image",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_snapshot_launch/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });

    expect(queuedWorkflowInput.image).toEqual({
      imageId: "sha256:snapshot-launch-image",
      kind: "snapshot",
      provider: "docker",
    });
    expect(queuedWorkflowInput.runtimePlan.image).toEqual({
      source: "snapshot",
      imageRef: "sha256:snapshot-launch-image",
    });
  });

  it("queues launches with the profile version agent runtime", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-agent-runtime@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_agent_runtime",
      targetKey: "openai-start-instance-agent-runtime",
      connectionId: "icn_start_instance_agent_runtime",
      bindingId: "ibd_start_instance_agent_runtime",
      versionState: SandboxProfileVersionStates.DRAFT,
      agentRuntimeId: "opencode",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_agent_runtime/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });

    expect(queuedWorkflowInput.runtimePlan.agentRuntimes).toHaveLength(1);
    expect(queuedWorkflowInput.runtimePlan.agentRuntimes[0]).toMatchObject({
      runtimeId: "opencode",
      runtimeKey: "opencode-server",
      clientId: "opencode-cli",
      endpointKey: "server",
    });
    expect(queuedWorkflowInput.runtimePlan.runtimeClients[0]?.clientId).toBe("opencode-cli");
    const opencodeAuthFile = queuedWorkflowInput.runtimePlan.runtimeClients[0]?.setup.files.find(
      (file) => file.fileId === "opencode_auth",
    );
    expect(opencodeAuthFile).toMatchObject({
      path: "/root/.local/share/opencode/auth.json",
      mode: 384,
      writeMode: "overwrite",
    });
    expect(
      opencodeAuthFile === undefined ? undefined : JSON.parse(opencodeAuthFile.content),
    ).toEqual({
      openai: {
        type: "api",
        key: "mistle-managed-credential",
      },
    });
    expect(
      queuedWorkflowInput.runtimePlan.artifacts.map((artifact) => artifact.artifactKey),
    ).toEqual(["opencode-cli"]);
  });

  it("queues Tensorlake launches for usable published versions from the stored snapshot image", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-start-instance-tensorlake-snapshot-launch@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_tensorlake_snapshot_launch",
      targetKey: "openai-start-instance-tensorlake-snapshot-launch",
      connectionId: "icn_start_instance_tensorlake_snapshot_launch",
      bindingId: "ibd_start_instance_tensorlake_snapshot_launch",
      versionState: SandboxProfileVersionStates.PUBLISHED,
      runtimeColumns: TensorlakeSandboxRuntimeColumns,
      snapshotImageProvider: "tensorlake",
      snapshotImageId: "tensorlake:image:tensorlake-snapshot-launch-image",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_tensorlake_snapshot_launch/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });

    expect(queuedWorkflowInput.image).toEqual({
      imageId: "tensorlake:image:tensorlake-snapshot-launch-image",
      kind: "snapshot",
      provider: "tensorlake",
    });
    expect(queuedWorkflowInput.sandboxRuntime).toEqual({
      provider: "tensorlake",
      resources: {
        memoryMb: 4096,
        vcpuCount: 2,
      },
    });
    expect(queuedWorkflowInput.runtimePlan.image).toEqual({
      source: "snapshot",
      imageRef: "tensorlake:image:tensorlake-snapshot-launch-image",
    });
  });

  it("queues a launch workflow for a startable draft profile version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-draft-version@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_draft_version",
      targetKey: "openai-start-instance-draft-version",
      connectionId: "icn_start_instance_draft_version",
      bindingId: "ibd_start_instance_draft_version",
      versionState: SandboxProfileVersionStates.DRAFT,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_draft_version/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(201);
    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });
    expect(queuedWorkflowInput.sandboxInstanceId).toBe(body.sandboxInstanceId);
  });

  it("starts the session in the selected primary repository", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-primary-repository@example.com",
    });

    const simulatedGitHub = await startSimulatedGitHubActorApi();
    try {
      await createStartableProfile({
        env,
        organizationId: session.organizationId,
        profileId: "sbp_start_instance_primary_repository",
        targetKey: "openai-start-instance-primary-repository",
        connectionId: "icn_start_instance_primary_repository_agent",
        bindingId: "ibd_start_instance_primary_repository_agent",
        versionState: SandboxProfileVersionStates.DRAFT,
        git: {
          targetKey: "github-start-instance-primary-repository",
          connectionId: "icn_start_instance_primary_repository_git",
          bindingId: "ibd_start_instance_primary_repository_git",
          repositories: ["mistlehq/mistle", "mistlehq/platform"],
          apiBaseUrl: simulatedGitHub.baseUrl,
        },
      });
      await seedConnectionCredential({
        env,
        organizationId: session.organizationId,
        connectionId: "icn_start_instance_primary_repository_git",
        slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
        secretKind: IntegrationCredentialSecretKinds.API_KEY,
        plaintext: "ghp_start_instance_primary_repository",
      });

      const response = await env.controlPlaneApi.http.fetch(
        "/v1/sandbox/profiles/sbp_start_instance_primary_repository/versions/1/instances",
        {
          method: "POST",
          headers: {
            cookie: session.cookie,
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
        env,
        sandboxInstanceId: body.sandboxInstanceId,
      });

      expect(queuedWorkflowInput.runtimePlan.agentRuntimes[0]?.ptyLaunch.newLaunch.cwd).toBe(
        "/root/mistlehq/platform",
      );
      expect(queuedWorkflowInput.runtimePlan.agentRuntimes[0]?.ptyLaunch.resumeLaunch.cwd).toBe(
        "/root/mistlehq/platform",
      );
      expect(queuedWorkflowInput.gitIdentity).toEqual({
        name: "Git Connection Owner",
        email: "git-connection-owner@example.com",
      });
    } finally {
      await simulatedGitHub.stop();
    }
  });

  it("starts the session at the workspace root when no primary repository is selected", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-workspace-root@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_workspace_root",
      targetKey: "openai-start-instance-workspace-root",
      connectionId: "icn_start_instance_workspace_root_agent",
      bindingId: "ibd_start_instance_workspace_root_agent",
      versionState: SandboxProfileVersionStates.DRAFT,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_workspace_root/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
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
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });

    expect(queuedWorkflowInput.runtimePlan.agentRuntimes[0]?.ptyLaunch.newLaunch.cwd).toBe(
      undefined,
    );
    expect(queuedWorkflowInput.runtimePlan.agentRuntimes[0]?.ptyLaunch.resumeLaunch.cwd).toBe(
      undefined,
    );
  });

  it("returns 400 when the selected primary repository is not available", async ({ env }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-start-instance-invalid-primary-repository@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_invalid_primary_repository",
      targetKey: "openai-start-instance-invalid-primary-repository",
      connectionId: "icn_start_instance_invalid_primary_repository_agent",
      bindingId: "ibd_start_instance_invalid_primary_repository_agent",
      versionState: SandboxProfileVersionStates.DRAFT,
      git: {
        targetKey: "github-start-instance-invalid-primary-repository",
        connectionId: "icn_start_instance_invalid_primary_repository_git",
        bindingId: "ibd_start_instance_invalid_primary_repository_git",
        repositories: ["mistlehq/mistle"],
      },
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_invalid_primary_repository/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          primaryRepositoryId: "mistlehq/platform",
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_PRIMARY_REPOSITORY");
  });
});

async function createStartableProfile(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  profileId: string;
  targetKey: string;
  connectionId: string;
  bindingId: string;
  versionState:
    | typeof SandboxProfileVersionStates.DRAFT
    | typeof SandboxProfileVersionStates.PUBLISHED;
  agentRuntimeId?: "codex" | "opencode" | "pi";
  snapshotImageId?: string;
  snapshotImageProvider?: "docker" | "e2b" | "tensorlake";
  runtimeColumns?: typeof DockerSandboxRuntimeColumns | typeof TensorlakeSandboxRuntimeColumns;
  git?: {
    targetKey: string;
    connectionId: string;
    bindingId: string;
    repositories: string[];
    apiBaseUrl?: string;
  };
}) {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values(
    sandboxProfileRow({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: "Startable Profile",
      activeVersion: input.versionState === SandboxProfileVersionStates.PUBLISHED ? 1 : null,
      createdAt: "2026-04-24T00:00:00.000Z",
    }),
  );
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      ...sandboxProfileVersionRow({
        sandboxProfileId: input.profileId,
        version: 1,
        state: input.versionState,
        agentRuntimeId: input.agentRuntimeId ?? "codex",
        ...(input.runtimeColumns ?? DockerSandboxRuntimeColumns),
        publishedAt:
          input.versionState === SandboxProfileVersionStates.PUBLISHED
            ? "2026-04-24T00:00:00.000Z"
            : null,
      }),
      ...(input.snapshotImageId === undefined
        ? {}
        : {
            snapshotImageProvider: input.snapshotImageProvider ?? "docker",
            snapshotImageId: input.snapshotImageId,
          }),
    });

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values([
    integrationTargetRow({
      targetKey: input.targetKey,
      variantId: "openai-default",
      enabled: true,
    }),
    ...(input.git === undefined
      ? []
      : [
          {
            targetKey: input.git.targetKey,
            familyId: "github",
            variantId: "github-cloud",
            enabled: true,
            config: {
              api_base_url: input.git.apiBaseUrl ?? "https://api.github.com",
              web_base_url: "https://github.com",
            },
          },
        ]),
  ]);
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values([
      integrationConnectionRow({
        id: input.connectionId,
        organizationId: input.organizationId,
        targetKey: input.targetKey,
        displayName: "Start instance agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
      ...(input.git === undefined
        ? []
        : [
            integrationConnectionRow({
              id: input.git.connectionId,
              organizationId: input.organizationId,
              targetKey: input.git.targetKey,
              displayName: "Start instance git connection",
              status: IntegrationConnectionStatuses.ACTIVE,
              config: {
                connection_method: IntegrationConnectionMethodIds.API_KEY,
              },
            }),
          ]),
    ]);
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values([
      sandboxProfileVersionIntegrationBindingRow({
        id: input.bindingId,
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: 1,
        connectionId: input.connectionId,
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
      ...(input.git === undefined
        ? []
        : [
            sandboxProfileVersionIntegrationBindingRow({
              id: input.git.bindingId,
              sandboxProfileId: input.profileId,
              sandboxProfileVersion: 1,
              connectionId: input.git.connectionId,
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: input.git.repositories,
                tools: [],
              },
            }),
          ]),
    ]);
}

async function startSimulatedGitHubActorApi(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");

    // GitHub REST "Get the authenticated user": https://docs.github.com/en/rest/users/users#get-the-authenticated-user
    if (requestUrl.pathname === "/user") {
      response.end(
        JSON.stringify({
          id: 1_234_567,
          login: "git-connection-owner",
          name: "Git Connection Owner",
          email: "git-connection-owner@example.com",
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: "Not Found" }));
  });

  await listen(server);

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected simulated GitHub actor API to listen on a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    stop: async () => {
      await closeServer(server);
    },
  };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}
