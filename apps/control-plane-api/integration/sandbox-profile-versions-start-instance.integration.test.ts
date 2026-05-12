/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { SandboxInstancePersistenceModes } from "@mistle/db/data-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  StartSandboxProfileInstanceBadRequestResponseSchema,
  StartSandboxProfileInstanceConflictResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
  StartSandboxProfileInstanceResponseSchema,
  StartSandboxProfileSetupScriptTestRunResponseSchema,
} from "../src/sandbox-profiles/index.js";
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
        }),
      },
    );

    expect(response.status).toBe(404);
    const body = StartSandboxProfileInstanceNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  });

  it("queues setup script test runs from the base image without passing the persisted setup script", async ({
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
    expect(queuedWorkflowInput.persistenceMode).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
    expect(queuedWorkflowInput.image?.kind).toBe("base");
    expect(queuedWorkflowInput.runtimePlan.image.source).toBe("base");
    expect(queuedWorkflowInput.runtimePlan.agentRuntimes).toHaveLength(1);
    expect(queuedWorkflowInput.runtimePlan).not.toHaveProperty("setupScript");
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

  it("queues an ephemeral launch when the profile default is persistent but organization persistence is disabled", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-start-instance-persistent-default-disabled@example.com",
    });

    await createStartableProfile({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_start_instance_persistent_default_disabled",
      targetKey: "openai-start-instance-persistent-default-disabled",
      connectionId: "icn_start_instance_persistent_default_disabled",
      bindingId: "ibd_start_instance_persistent_default_disabled",
      versionState: SandboxProfileVersionStates.DRAFT,
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_start_instance_persistent_default_disabled/versions/1/instances",
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

    expect(queuedWorkflowInput.persistenceMode).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  });

  it("starts the session in the selected primary repository", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-start-instance-primary-repository@example.com",
    });

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
      },
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
  defaultPersistenceMode?:
    | typeof SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL
    | typeof SandboxProfileVersionDefaultPersistenceModes.PERSISTENT;
  agentRuntimeId?: "codex" | "opencode";
  snapshotImageId?: string;
  git?: {
    targetKey: string;
    connectionId: string;
    bindingId: string;
    repositories: string[];
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
        defaultPersistenceMode:
          input.defaultPersistenceMode ?? SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        agentRuntimeId: input.agentRuntimeId ?? "codex",
        ...DockerSandboxRuntimeColumns,
        publishedAt:
          input.versionState === SandboxProfileVersionStates.PUBLISHED
            ? "2026-04-24T00:00:00.000Z"
            : null,
      }),
      ...(input.snapshotImageId === undefined
        ? {}
        : {
            snapshotImageProvider: "docker",
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
              api_base_url: "https://api.github.com",
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
