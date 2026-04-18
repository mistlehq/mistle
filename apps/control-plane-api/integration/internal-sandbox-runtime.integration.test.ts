import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  IntegrationBindingKinds,
  UserExternalPrincipalStatuses,
  userExternalPrincipals,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH } from "../src/internal/sandbox-runtime/index.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { it } from "./test-context.js";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;
const StartWorkflowName = "data-plane.sandbox-instances.start";

const WorkflowRunInputSchema = z.looseObject({
  sandboxInstanceId: z.string().min(1),
  gitIdentity: z
    .object({
      name: z.string().min(1),
      email: z.email(),
    })
    .optional(),
});

async function waitForQueuedStartWorkflowInput(input: {
  dataPlaneDbPool: DisposableDataPlaneRuntime["dbPool"];
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

describe("internal sandbox runtime", () => {
  it("rejects start-profile-instance requests without internal service token", async ({
    fixture,
  }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/start-profile-instance`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "org_test",
          profileId: "sbp_test",
          profileVersion: 1,
          startedBy: {
            kind: "system",
            id: "aru_test",
          },
          source: "webhook",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects start-profile-instance requests with malformed body", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/start-profile-instance`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_test",
          profileId: "sbp_test",
          profileVersion: "not_a_number",
          startedBy: {
            kind: "system",
            id: "aru_test",
          },
          source: "webhook",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("rejects mint-connection-token requests without internal service token", async ({
    fixture,
  }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/mint-connection-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "org_test",
          instanceId: "sbi_test",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects mint-connection-token requests with malformed body", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/mint-connection-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_test",
          instanceId: "",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("starts a profile instance with acting-user git identity", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_internal_start_git_identity",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-internal-start-profile-instance-git-identity@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_internal_start_git_identity",
      organizationId: authenticatedSession.organizationId,
      displayName: "Internal Start Git Identity Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_internal_start_git_identity",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "openai-internal-start-git-identity",
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
        targetKey: "github-internal-start-git-identity",
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
        id: "icn_internal_start_git_identity_agent",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-internal-start-git-identity",
        displayName: "Internal start git identity agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_internal_start_git_identity_provider",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-internal-start-git-identity",
        displayName: "Internal start git identity provider connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.internalStartGitIdentity",
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_internal_start_git_identity_agent",
      sandboxProfileId: "sbp_internal_start_git_identity",
      sandboxProfileVersion: 1,
      connectionId: "icn_internal_start_git_identity_agent",
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
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      id: "ilp_internal_start_git_identity",
      organizationId: authenticatedSession.organizationId,
      providerFamily: "github",
      status: "active",
      integrationTargetKey: "github-internal-start-git-identity",
      integrationConnectionId: "icn_internal_start_git_identity_provider",
      createdByUserId: authenticatedSession.userId,
      updatedByUserId: authenticatedSession.userId,
    });
    await fixture.db.insert(userExternalPrincipals).values({
      id: "uep_internal_start_git_identity",
      organizationId: authenticatedSession.organizationId,
      userId: authenticatedSession.userId,
      providerFamily: "github",
      providerSubjectId: "12345",
      organizationProviderConfigId: "ilp_internal_start_git_identity",
      integrationConnectionId: "icn_internal_start_git_identity_provider",
      status: UserExternalPrincipalStatuses.ACTIVE,
      profile: {
        login: "mistle-user",
        displayName: "Mistle User",
        email: "mistle-user@example.com",
      },
    });

    try {
      const response = await fixture.request(
        `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/start-profile-instance`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
          body: JSON.stringify({
            organizationId: authenticatedSession.organizationId,
            profileId: "sbp_internal_start_git_identity",
            profileVersion: 1,
            startedBy: {
              kind: "user",
              id: authenticatedSession.userId,
            },
            actingUser: {
              userId: authenticatedSession.userId,
            },
            source: "dashboard",
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      const parsedBody = z
        .object({
          sandboxInstanceId: z.string().min(1),
        })
        .parse(body);

      const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: parsedBody.sandboxInstanceId,
      });
      expect(queuedWorkflowInput.gitIdentity).toEqual({
        name: "Mistle User",
        email: "mistle-user@example.com",
      });
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);
});
