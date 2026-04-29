import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  sandboxInstances,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  SandboxInstanceStarterKinds,
} from "@mistle/db/data-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SandboxProvider, createSandboxAdapter } from "@mistle/sandbox";
import { systemSleeper } from "@mistle/time";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  CreateSandboxProfileVersionSetupCheckBadRequestResponseSchema,
  CreateSandboxProfileVersionSetupCheckResponseSchema,
  GetSandboxProfileVersionSetupCheckNotFoundResponseSchema,
  GetSandboxProfileVersionSetupCheckResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createDisposableDataPlaneRuntime } from "./helpers/disposable-data-plane-runtime.js";
import {
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
  createSandboxProfileVersionIntegrationBindingFixture,
} from "./helpers/sandbox-profiles.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;
const StartWorkflowName = "data-plane.sandbox-instances.start";
const StopWorkflowName = "data-plane.sandbox-instances.stop";

const SetupCheckStartWorkflowInputSchema = z.looseObject({
  sandboxInstanceId: z.string().min(1),
  purpose: z.literal("setup_check"),
  persistenceMode: z.literal("ephemeral"),
  runtimePlan: z.looseObject({
    setupScript: z.string().min(1).optional(),
  }),
});

const SetupCheckStopWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    stopReason: z.literal("system"),
  })
  .strict();

async function insertProfileVersionFixture(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  profileId: string;
  version: number;
}) {
  await input.fixture.db.insert(sandboxProfiles).values({
    ...createSandboxProfileFixture({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: "Setup Check Profile",
      createdAt: "2026-04-01T00:00:00.000Z",
    }),
  });
  await input.fixture.db.insert(sandboxProfileVersions).values({
    ...createSandboxProfileVersionFixture({
      sandboxProfileId: input.profileId,
      version: input.version,
      state: SandboxProfileVersionStates.DRAFT,
      setupScript: "echo persisted-script",
    }),
  });
}

async function createSetupCheckDataPlaneRuntime(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  databaseNamePrefix: string;
}) {
  const previousMistleEnv = process.env.MISTLE_ENV;
  process.env.MISTLE_ENV = "development";
  try {
    return await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: input.fixture.databaseStack.directUrl,
      internalAuthServiceToken: input.fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${input.fixture.config.server.host}:${String(input.fixture.config.server.port)}`,
      workflowNamespaceId: input.fixture.config.workflow.namespaceId,
      databaseNamePrefix: input.databaseNamePrefix,
      baseUrl: input.fixture.config.dataPlaneApi.baseUrl,
    });
  } finally {
    if (previousMistleEnv === undefined) {
      delete process.env.MISTLE_ENV;
    } else {
      process.env.MISTLE_ENV = previousMistleEnv;
    }
  }
}

async function waitForQueuedSetupCheckStartWorkflowInput(input: {
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
      return SetupCheckStartWorkflowInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued setup-check start workflow input for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function waitForQueuedSetupCheckStopWorkflowInput(input: {
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
      [input.workflowNamespaceId, StopWorkflowName, input.sandboxInstanceId],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return SetupCheckStopWorkflowInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued setup-check stop workflow input for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function insertGitRepositoryOptionFixture(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  profileId: string;
  version: number;
  repository: string;
}) {
  const targetKey = `${input.profileId}_github`;
  const connectionId = `${input.profileId}_github_connection`;

  await input.fixture.db.insert(integrationTargets).values({
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.fixture.db.insert(integrationConnections).values({
    id: connectionId,
    organizationId: input.organizationId,
    targetKey,
    displayName: "Setup Check GitHub",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    },
  });
  await input.fixture.db.insert(sandboxProfileVersionIntegrationBindings).values(
    createSandboxProfileVersionIntegrationBindingFixture({
      id: `${input.profileId}_git_binding`,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.version,
      connectionId,
      kind: IntegrationBindingKinds.GIT,
      config: {
        repositories: [input.repository],
        tools: [],
      },
    }),
  );
}

describe("sandbox profile version setup checks integration", () => {
  it("starts a tableless setup check using the request setup script", async ({ fixture }) => {
    const dataPlaneFixture = await createSetupCheckDataPlaneRuntime({
      fixture,
      databaseNamePrefix: "mistle_cp_setup_check_create",
    });

    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-setup-check-create@example.com",
      });
      await insertProfileVersionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_create_001",
        version: 1,
      });
      await insertGitRepositoryOptionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_create_001",
        version: 1,
        repository: "mistlehq/platform",
      });

      const response = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_create_001/versions/1/setup-checks",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            setupScript: "echo from-editor-buffer",
            primaryRepositoryId: "mistlehq/platform",
            idempotencyKey: "setup-check-create-001",
          }),
        },
      );

      expect(response.status).toBe(201);
      const responseBody = CreateSandboxProfileVersionSetupCheckResponseSchema.parse(
        await response.json(),
      );
      expect(responseBody).toMatchObject({
        id: responseBody.sandboxInstanceId,
        sandboxProfileId: "sbp_setup_check_create_001",
        sandboxProfileVersion: 1,
        status: "starting_sandbox",
        failurePhase: null,
        failureCode: null,
        failureMessage: null,
        startedAt: null,
        finishedAt: null,
      });
      expect(responseBody.sandboxInstanceId).toMatch(/^sbi_/);
      expect(responseBody.workflowRunId).not.toBeNull();

      const queuedWorkflowInput = await waitForQueuedSetupCheckStartWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: responseBody.sandboxInstanceId,
      });
      expect(queuedWorkflowInput.runtimePlan.setupScript).toBe("echo from-editor-buffer");

      const sandboxInstance = await dataPlaneFixture.db.query.sandboxInstances.findFirst({
        where: (table, { eq }) => eq(table.id, responseBody.sandboxInstanceId),
      });
      expect(sandboxInstance).toMatchObject({
        id: responseBody.sandboxInstanceId,
        organizationId: authenticatedSession.organizationId,
        sandboxProfileId: "sbp_setup_check_create_001",
        sandboxProfileVersion: 1,
        purpose: SandboxInstancePurposes.SETUP_CHECK,
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      });
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("returns the same setup-check sandbox for duplicate idempotency input", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createSetupCheckDataPlaneRuntime({
      fixture,
      databaseNamePrefix: "mistle_cp_setup_check_idempotent",
    });

    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-setup-check-idempotent@example.com",
      });
      await insertProfileVersionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_idempotent_001",
        version: 1,
      });

      const firstResponse = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_idempotent_001/versions/1/setup-checks",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            setupScript: "echo first",
            idempotencyKey: "setup-check-idempotent-001",
          }),
        },
      );
      expect(firstResponse.status).toBe(201);
      const firstBody = CreateSandboxProfileVersionSetupCheckResponseSchema.parse(
        await firstResponse.json(),
      );

      const secondResponse = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_idempotent_001/versions/1/setup-checks",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            setupScript: "echo second",
            idempotencyKey: "setup-check-idempotent-001",
          }),
        },
      );
      expect(secondResponse.status).toBe(201);
      const secondBody = CreateSandboxProfileVersionSetupCheckResponseSchema.parse(
        await secondResponse.json(),
      );

      expect(secondBody.sandboxInstanceId).toBe(firstBody.sandboxInstanceId);
      expect(secondBody.workflowRunId).toBe(firstBody.workflowRunId);
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("returns an idempotent setup check before revalidating changed repository options", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createSetupCheckDataPlaneRuntime({
      fixture,
      databaseNamePrefix: "mistle_cp_setup_check_idempotent_repo",
    });

    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-setup-check-idempotent-repo@example.com",
      });
      await insertProfileVersionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_idempotent_repo_001",
        version: 1,
      });
      await insertGitRepositoryOptionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_idempotent_repo_001",
        version: 1,
        repository: "mistlehq/platform",
      });

      const firstResponse = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_idempotent_repo_001/versions/1/setup-checks",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            setupScript: "echo repo",
            primaryRepositoryId: "mistlehq/platform",
            idempotencyKey: "setup-check-idempotent-repo-001",
          }),
        },
      );
      expect(firstResponse.status).toBe(201);
      const firstBody = CreateSandboxProfileVersionSetupCheckResponseSchema.parse(
        await firstResponse.json(),
      );

      await fixture.db
        .delete(sandboxProfileVersionIntegrationBindings)
        .where(
          eq(
            sandboxProfileVersionIntegrationBindings.id,
            "sbp_setup_check_idempotent_repo_001_git_binding",
          ),
        );

      const secondResponse = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_idempotent_repo_001/versions/1/setup-checks",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            setupScript: "echo repo",
            primaryRepositoryId: "mistlehq/platform",
            idempotencyKey: "setup-check-idempotent-repo-001",
          }),
        },
      );
      expect(secondResponse.status).toBe(201);
      const secondBody = CreateSandboxProfileVersionSetupCheckResponseSchema.parse(
        await secondResponse.json(),
      );
      expect(secondBody.sandboxInstanceId).toBe(firstBody.sandboxInstanceId);
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("maps data-plane setup-check sandbox failure when fetched", async ({ fixture }) => {
    const dataPlaneFixture = await createSetupCheckDataPlaneRuntime({
      fixture,
      databaseNamePrefix: "mistle_cp_setup_check_reconcile",
    });

    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-setup-check-reconcile@example.com",
      });
      await insertProfileVersionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_reconcile_001",
        version: 1,
      });

      const createResponse = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_reconcile_001/versions/1/setup-checks",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            setupScript: "exit 1",
            idempotencyKey: "setup-check-reconcile-001",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const createdBody = CreateSandboxProfileVersionSetupCheckResponseSchema.parse(
        await createResponse.json(),
      );

      await dataPlaneFixture.db
        .update(sandboxInstances)
        .set({
          status: SandboxInstanceStatuses.FAILED,
          failureCode: "sandbox_init_failed",
          failureMessage: "Setup script exited with status 1.",
        })
        .where(eq(sandboxInstances.id, createdBody.sandboxInstanceId));

      const getResponse = await fixture.request(
        `/v1/sandbox/profiles/sbp_setup_check_reconcile_001/versions/1/setup-checks/${createdBody.id}`,
        {
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(getResponse.status).toBe(200);
      const responseBody = GetSandboxProfileVersionSetupCheckResponseSchema.parse(
        await getResponse.json(),
      );
      expect(responseBody).toMatchObject({
        id: createdBody.id,
        status: "failed",
        failurePhase: "start",
        failureCode: "sandbox_init_failed",
        failureMessage: "Setup script exited with status 1.",
      });
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("starts cleanup instead of marking a running setup-check sandbox as succeeded", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createSetupCheckDataPlaneRuntime({
      fixture,
      databaseNamePrefix: "mistle_cp_setup_check_cleanup",
    });
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-setup-check-cleanup@example.com",
      });
      await insertProfileVersionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_cleanup_001",
        version: 1,
      });

      const createResponse = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_cleanup_001/versions/1/setup-checks",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            setupScript: "echo cleanup",
            idempotencyKey: "setup-check-cleanup-001",
          }),
        },
      );

      expect(createResponse.status).toBe(201);
      const createdBody = CreateSandboxProfileVersionSetupCheckResponseSchema.parse(
        await createResponse.json(),
      );

      await dataPlaneFixture.db
        .update(sandboxInstances)
        .set({
          providerSandboxId: sandbox.id,
          status: SandboxInstanceStatuses.RUNNING,
        })
        .where(eq(sandboxInstances.id, createdBody.sandboxInstanceId));
      await dataPlaneFixture.attachSandboxRuntime({
        sandboxInstanceId: createdBody.sandboxInstanceId,
        runtimeReady: true,
      });

      const getResponse = await fixture.request(
        `/v1/sandbox/profiles/sbp_setup_check_cleanup_001/versions/1/setup-checks/${createdBody.id}`,
        {
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(getResponse.status).toBe(200);
      const responseBody = GetSandboxProfileVersionSetupCheckResponseSchema.parse(
        await getResponse.json(),
      );
      expect(responseBody).toMatchObject({
        id: createdBody.id,
        status: "cleaning_up",
        failurePhase: null,
        failureCode: null,
        failureMessage: null,
        finishedAt: null,
      });

      const queuedWorkflowInput = await waitForQueuedSetupCheckStopWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: createdBody.sandboxInstanceId,
      });
      expect(queuedWorkflowInput).toEqual({
        sandboxInstanceId: createdBody.sandboxInstanceId,
        stopReason: "system",
      });
    } finally {
      await adapter.destroy({ id: sandbox.id });
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("rejects unavailable primary repositories before starting a setup check", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-setup-check-invalid-repo@example.com",
    });
    await insertProfileVersionFixture({
      fixture,
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_setup_check_invalid_repo_001",
      version: 1,
    });
    await insertGitRepositoryOptionFixture({
      fixture,
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_setup_check_invalid_repo_001",
      version: 1,
      repository: "mistlehq/platform",
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_setup_check_invalid_repo_001/versions/1/setup-checks",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          setupScript: "echo invalid repo",
          primaryRepositoryId: "mistlehq/other",
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CreateSandboxProfileVersionSetupCheckBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toMatchObject({
      code: "INVALID_PRIMARY_REPOSITORY",
    });
  });

  it("does not expose normal session sandboxes through setup-check get", async ({ fixture }) => {
    const dataPlaneFixture = await createSetupCheckDataPlaneRuntime({
      fixture,
      databaseNamePrefix: "mistle_cp_setup_check_session_hidden",
    });

    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-setup-check-session-hidden@example.com",
      });
      await insertProfileVersionFixture({
        fixture,
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_setup_check_session_hidden_001",
        version: 1,
      });

      await dataPlaneFixture.db.insert(sandboxInstances).values({
        id: "sbi_setup_check_session_hidden_001",
        organizationId: authenticatedSession.organizationId,
        sandboxProfileId: "sbp_setup_check_session_hidden_001",
        sandboxProfileVersion: 1,
        runtimeProvider: SandboxProvider.DOCKER,
        providerSandboxId: null,
        computeGeneration: 1,
        status: SandboxInstanceStatuses.PENDING,
        startedByKind: SandboxInstanceStarterKinds.USER,
        startedById: authenticatedSession.userId,
        source: SandboxInstanceSources.DASHBOARD,
        purpose: SandboxInstancePurposes.SESSION,
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      });

      const response = await fixture.request(
        "/v1/sandbox/profiles/sbp_setup_check_session_hidden_001/versions/1/setup-checks/sbi_setup_check_session_hidden_001",
        {
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(response.status).toBe(404);
      const responseBody = GetSandboxProfileVersionSetupCheckNotFoundResponseSchema.parse(
        await response.json(),
      );
      expect(responseBody).toMatchObject({
        code: "SETUP_CHECK_NOT_FOUND",
      });
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("rejects invalid setup check request bodies", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-setup-check-validation@example.com",
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_setup_check_validation_001/versions/1/setup-checks",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          setupScript: 123,
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = ValidationErrorResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("VALIDATION_ERROR");
  });
});
