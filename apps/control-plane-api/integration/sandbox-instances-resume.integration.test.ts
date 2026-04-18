import { sandboxInstanceRuntimePlans, sandboxInstances } from "@mistle/db/data-plane";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect } from "vitest";
import { z } from "zod";

import { createControlPlaneApiRuntime } from "../src/main.js";
import {
  SandboxInstancesConflictResponseSchema,
  SandboxInstanceStatusResponseSchema,
  SandboxInstancesNotFoundResponseSchema,
} from "../src/sandbox-instances/index.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import {
  destroyDockerSandboxContainer,
  startDockerSandboxContainer,
  stopDockerSandboxContainer,
} from "./helpers/docker-sandbox-runtime.js";
import { IntegrationPortAccessConfig } from "./helpers/port-access-config.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
};

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

const ResumeWorkflowName = "data-plane.sandbox-instances.resume";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];
const startedSandboxContainerIds: string[] = [];

function createRuntimePlan() {
  return {
    sandboxProfileId: "sbp_resume_integration",
    version: 1,
    image: {
      source: "base" as const,
      imageRef: "registry:resume",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
    }
  }

  while (startedSandboxContainerIds.length > 0) {
    const containerId = startedSandboxContainerIds.pop();
    if (containerId !== undefined) {
      await destroyDockerSandboxContainer(containerId);
    }
  }
});

function createControlPlaneConfig(input: {
  baseConfig: ControlPlaneApiConfig;
  dataPlaneBaseUrl: string;
}): ControlPlaneApiConfig {
  return {
    ...input.baseConfig,
    dataPlaneApi: {
      baseUrl: input.dataPlaneBaseUrl,
    },
  };
}

async function createAuthenticatedControlPlaneSession(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  db: Awaited<ReturnType<typeof createControlPlaneApiRuntime>>["db"];
  email: string;
}) {
  return createAuthenticatedSession({
    request: input.request,
    db: input.db,
    otpLength: input.fixture.config.auth.otpLength,
    email: input.email,
  });
}

async function insertResumableSandboxInstance(input: {
  dataPlaneFixture: DisposableDataPlaneRuntime;
  organizationId: string;
  sandboxInstanceId: string;
  status: "stopped" | "failed" | "running";
  providerSandboxId: string;
}) {
  await input.dataPlaneFixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_resume_integration",
    title: null,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId,
    status: input.status,
    startedByKind: "user",
    startedById: "usr_resume_integration",
    source: "dashboard",
    ...(input.status === "failed"
      ? {
          failureCode: "sandbox_start_failed",
          failureMessage: "Initial start failed.",
        }
      : {}),
  });

  await input.dataPlaneFixture.db.insert(sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: createRuntimePlan(),
    compiledFromProfileId: "sbp_resume_integration",
    compiledFromProfileVersion: 1,
  });
}

async function waitForResumeWorkflowRun(input: {
  dataPlaneFixture: DisposableDataPlaneRuntime;
  workflowNamespaceId: string;
  sandboxInstanceId: string;
}): Promise<WorkflowRunRow> {
  const deadline = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadline) {
    const result = await input.dataPlaneFixture.dbPool.query<WorkflowRunRow>(
      `
        select id, namespace_id, workflow_name, status, input
        from data_plane_openworkflow.workflow_runs
        where
          namespace_id = $1
          and workflow_name = $2
          and input->>'sandboxInstanceId' = $3
        order by created_at asc
        limit 1
      `,
      [input.workflowNamespaceId, ResumeWorkflowName, input.sandboxInstanceId],
    );

    const row = result.rows[0];
    if (row !== undefined) {
      return row;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued resume workflow run for sandbox instance '${input.sandboxInstanceId}'.`,
  );
}

async function countResumeWorkflowRuns(input: {
  dataPlaneFixture: DisposableDataPlaneRuntime;
  workflowNamespaceId: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const result = await input.dataPlaneFixture.dbPool.query<{ count: string }>(
    `
      select count(*)::text as count
      from data_plane_openworkflow.workflow_runs
      where
        namespace_id = $1
        and workflow_name = $2
        and input->>'sandboxInstanceId' = $3
    `,
    [input.workflowNamespaceId, ResumeWorkflowName, input.sandboxInstanceId],
  );

  return result.rows[0]?.count ?? "0";
}

describe("sandbox instance resume integration", () => {
  it("returns starting for a stopped sandbox and queues a resume workflow", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_resume",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-resume-stopped@example.com",
      });

      const sandboxInstanceId = "sbi_cp_resume_stopped_001";
      const providerSandboxId = await startDockerSandboxContainer();
      startedSandboxContainerIds.push(providerSandboxId);
      await stopDockerSandboxContainer(providerSandboxId);
      await insertResumableSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId,
        status: "stopped",
        providerSandboxId,
      });

      const response = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/resume`,
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
      expect(body).toEqual({
        id: sandboxInstanceId,
        title: null,
        status: "starting",
        connectable: false,
        failureCode: null,
        failureMessage: null,
        runtimeContext: null,
        automationConversation: null,
      });

      const queuedRun = await waitForResumeWorkflowRun({
        dataPlaneFixture,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId,
      });
      expect(queuedRun.workflow_name).toBe(ResumeWorkflowName);
      expect(queuedRun.status).toBe("pending");
      expect(WorkflowRunInputSchema.parse(queuedRun.input).sandboxInstanceId).toBe(
        sandboxInstanceId,
      );
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns INSTANCE_FAILED for failed sandboxes", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_resume",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-resume-failed@example.com",
      });

      const sandboxInstanceId = "sbi_cp_resume_failed_001";
      const providerSandboxId = await startDockerSandboxContainer();
      startedSandboxContainerIds.push(providerSandboxId);
      await stopDockerSandboxContainer(providerSandboxId);
      await insertResumableSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId,
        status: "failed",
        providerSandboxId,
      });

      const response = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/resume`,
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(409);
      const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_FAILED");
      expect(body.message).toContain("Initial start failed.");
      expect(
        await countResumeWorkflowRuns({
          dataPlaneFixture,
          workflowNamespaceId: fixture.config.workflow.namespaceId,
          sandboxInstanceId,
        }),
      ).toBe("0");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns the current effective status without queueing a resume workflow", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_resume",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-resume-running@example.com",
      });

      const sandboxInstanceId = "sbi_cp_resume_running_001";
      const providerSandboxId = await startDockerSandboxContainer();
      startedSandboxContainerIds.push(providerSandboxId);
      await insertResumableSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId,
        status: "running",
        providerSandboxId,
      });
      await dataPlaneFixture.attachSandboxRuntime({
        sandboxInstanceId,
      });

      const response = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/resume`,
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
      expect(body).toEqual({
        id: sandboxInstanceId,
        title: null,
        status: "starting",
        connectable: false,
        failureCode: null,
        failureMessage: null,
        runtimeContext: null,
        automationConversation: null,
      });

      expect(
        await countResumeWorkflowRuns({
          dataPlaneFixture,
          workflowNamespaceId: fixture.config.workflow.namespaceId,
          sandboxInstanceId,
        }),
      ).toBe("0");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns INSTANCE_NOT_RESUMABLE for pending sandboxes", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_resume",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-resume-pending@example.com",
      });

      const sandboxInstanceId = "sbi_cp_resume_pending_001";
      await dataPlaneFixture.db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId: authSession.organizationId,
        sandboxProfileId: "sbp_resume_integration",
        title: null,
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: null,
        status: "pending",
        startedByKind: "user",
        startedById: "usr_resume_integration",
        source: "dashboard",
      });

      const response = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/resume`,
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(409);
      const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_NOT_RESUMABLE");
      expect(body.message).toContain("is 'pending' and cannot be resumed");
      expect(
        await countResumeWorkflowRuns({
          dataPlaneFixture,
          workflowNamespaceId: fixture.config.workflow.namespaceId,
          sandboxInstanceId,
        }),
      ).toBe("0");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("deduplicates repeated stopped-sandbox resume requests when the same idempotency key is reused", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_resume",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-resume-idempotent@example.com",
      });

      const sandboxInstanceId = "sbi_cp_resume_stopped_idempotent_001";
      const providerSandboxId = await startDockerSandboxContainer();
      startedSandboxContainerIds.push(providerSandboxId);
      await stopDockerSandboxContainer(providerSandboxId);
      await insertResumableSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId,
        status: "stopped",
        providerSandboxId,
      });

      const resumeBody = JSON.stringify({
        idempotencyKey: "resume-stopped-idempotent-001",
      });
      const firstResponse = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/resume`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authSession.cookie,
          },
          body: resumeBody,
        },
      );
      const secondResponse = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/resume`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authSession.cookie,
          },
          body: resumeBody,
        },
      );

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      SandboxInstanceStatusResponseSchema.parse(await firstResponse.json());
      SandboxInstanceStatusResponseSchema.parse(await secondResponse.json());
      const queuedRun = await waitForResumeWorkflowRun({
        dataPlaneFixture,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId,
      });
      expect(queuedRun.workflow_name).toBe(ResumeWorkflowName);
      expect(queuedRun.status).toBe("pending");
      expect(WorkflowRunInputSchema.parse(queuedRun.input).sandboxInstanceId).toBe(
        sandboxInstanceId,
      );
      expect(
        await countResumeWorkflowRuns({
          dataPlaneFixture,
          workflowNamespaceId: fixture.config.workflow.namespaceId,
          sandboxInstanceId,
        }),
      ).toBe("1");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("returns 404 when the sandbox instance does not exist", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_resume",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      portAccess: IntegrationPortAccessConfig,
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-resume-missing@example.com",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_resume_missing_001/resume",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(404);
      const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_NOT_FOUND");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });
});
