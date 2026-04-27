import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  IntegrationBindingKinds,
  userExternalPrincipalCredentialSecrets,
  UserExternalPrincipalCredentialSecretKinds,
  userExternalPrincipalCredentials,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
  userExternalPrincipals,
} from "@mistle/db/control-plane";
import { sandboxInstances } from "@mistle/db/data-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH } from "../src/internal/sandbox-runtime/index.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;
const StartWorkflowName = "data-plane.sandbox-instances.start";
const ResumeWorkflowName = "data-plane.sandbox-instances.resume";

const WorkflowRunInputSchema = z.looseObject({
  sandboxInstanceId: z.string().min(1),
  gitIdentity: z
    .object({
      name: z.string().min(1),
      email: z.email(),
      signing: z
        .object({
          format: z.literal("ssh"),
          program: z.string().min(1),
          keyRef: z.string().min(1),
          organizationId: z.string().min(1),
          providerFamily: z.string().min(1),
          actingUserId: z.string().min(1),
        })
        .optional(),
    })
    .optional(),
});

async function insertPrincipalCredentialSecret(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  credentialId: string;
  secretKind: (typeof UserExternalPrincipalCredentialSecretKinds)[keyof typeof UserExternalPrincipalCredentialSecretKinds];
  plaintext: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const organizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
  });
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });

    await input.fixture.db.insert(userExternalPrincipalCredentialSecrets).values({
      organizationId: input.organizationId,
      credentialId: input.credentialId,
      secretKind: input.secretKind,
      ciphertext: encryptedSecret.ciphertext,
      nonce: encryptedSecret.nonce,
      organizationCredentialKeyVersion: organizationCredentialKey.version,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}

async function waitForQueuedStartWorkflowInput(input: {
  dataPlaneDbPool: DisposableDataPlaneRuntime["dbPool"];
  workflowNamespaceId: string;
  sandboxInstanceId: string;
}) {
  return await waitForQueuedWorkflowInput({
    ...input,
    workflowName: StartWorkflowName,
  });
}

async function waitForQueuedResumeWorkflowInput(input: {
  dataPlaneDbPool: DisposableDataPlaneRuntime["dbPool"];
  workflowNamespaceId: string;
  sandboxInstanceId: string;
}) {
  return await waitForQueuedWorkflowInput({
    ...input,
    workflowName: ResumeWorkflowName,
  });
}

async function waitForQueuedWorkflowInput(input: {
  dataPlaneDbPool: DisposableDataPlaneRuntime["dbPool"];
  workflowNamespaceId: string;
  workflowName: string;
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
      [input.workflowNamespaceId, input.workflowName, input.sandboxInstanceId],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return WorkflowRunInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued '${input.workflowName}' workflow input for sandbox '${input.sandboxInstanceId}'.`,
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

  it("rejects resume-sandbox-instance requests without internal service token", async ({
    fixture,
  }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/resume-sandbox-instance`,
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

  it("rejects resume-sandbox-instance requests with malformed body", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/resume-sandbox-instance`,
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

  it("queues sandbox resume for internal callers", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_internal_resume",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });

    try {
      await dataPlaneFixture.db.insert(sandboxInstances).values({
        id: "sbi_internal_resume_001",
        organizationId: "org_internal_resume",
        sandboxProfileId: "sbp_internal_resume",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-internal-resume-001",
        status: "stopped",
        startedByKind: "system",
        startedById: "aru_internal_resume",
        source: "webhook",
        failureCode: null,
        failureMessage: null,
      });

      const response = await fixture.request(
        `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}/resume-sandbox-instance`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
          body: JSON.stringify({
            organizationId: "org_internal_resume",
            instanceId: "sbi_internal_resume_001",
            idempotencyKey: "internal-resume-test",
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "accepted",
        sandboxInstanceId: "sbi_internal_resume_001",
      });

      const queuedWorkflowInput = await waitForQueuedResumeWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: "sbi_internal_resume_001",
      });
      expect(queuedWorkflowInput).toMatchObject({
        sandboxInstanceId: "sbi_internal_resume_001",
      });
    } finally {
      await dataPlaneFixture.stop();
    }
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
      state: "draft",
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
      policy: {
        gitCommitSigningMode: "allowed",
      },
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
        preferredEmail: "mistle-user@example.com",
      },
    });
    await fixture.db.insert(userExternalPrincipalCredentials).values({
      id: "upc_internal_start_git_identity_signing",
      organizationId: authenticatedSession.organizationId,
      principalId: "uep_internal_start_git_identity",
      providerFamily: "github",
      credentialKind: "git_ssh_signing_key",
      status: UserExternalPrincipalCredentialStatuses.ACTIVE,
    });
    await insertPrincipalCredentialSecret({
      fixture,
      organizationId: authenticatedSession.organizationId,
      credentialId: "upc_internal_start_git_identity_signing",
      secretKind: UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
      plaintext: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----",
      metadata: {
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestSigningKey mistle-user@example.com",
        publicKeyFingerprint: "SHA256:test-internal-start-signing-key",
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
        signing: {
          format: "ssh",
          program: "/opt/mistle/bin/mistle-ssh-sign",
          keyRef:
            "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestSigningKey mistle-user@example.com",
          organizationId: authenticatedSession.organizationId,
          providerFamily: "github",
          actingUserId: authenticatedSession.userId,
        },
      });
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("starts the sandbox in the selected primary repository for internal callers", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_internal_start_primary_repository",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-internal-start-profile-instance-primary-repository@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_internal_start_primary_repository",
      organizationId: authenticatedSession.organizationId,
      displayName: "Internal Start Primary Repository Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_internal_start_primary_repository",
      version: 1,
      state: "draft",
    });
    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "openai-internal-start-primary-repository",
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
        targetKey: "github-internal-start-primary-repository",
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
        id: "icn_internal_start_primary_repository_agent",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-internal-start-primary-repository",
        displayName: "Internal start primary repository agent connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
      {
        id: "icn_internal_start_primary_repository_git",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-internal-start-primary-repository",
        displayName: "Internal start primary repository git connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_internal_start_primary_repository_agent",
        sandboxProfileId: "sbp_internal_start_primary_repository",
        sandboxProfileVersion: 1,
        connectionId: "icn_internal_start_primary_repository_agent",
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
        id: "ibd_internal_start_primary_repository_git",
        sandboxProfileId: "sbp_internal_start_primary_repository",
        sandboxProfileVersion: 1,
        connectionId: "icn_internal_start_primary_repository_git",
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle", "mistlehq/platform"],
          tools: [],
        },
      },
    ]);

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
            profileId: "sbp_internal_start_primary_repository",
            profileVersion: 1,
            primaryRepositoryId: "mistlehq/platform",
            startedBy: {
              kind: "system",
              id: "aru_internal_start_primary_repository",
            },
            source: "webhook",
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
      const runtimePlan = z
        .object({
          agentRuntimes: z.array(
            z.object({
              ptyLaunch: z.object({
                newLaunch: z.object({
                  cwd: z.string().min(1),
                }),
                resumeLaunch: z.object({
                  cwd: z.string().min(1),
                }),
              }),
            }),
          ),
        })
        .parse(queuedWorkflowInput.runtimePlan);

      expect(runtimePlan.agentRuntimes[0]?.ptyLaunch.newLaunch.cwd).toBe("/root/mistlehq/platform");
      expect(runtimePlan.agentRuntimes[0]?.ptyLaunch.resumeLaunch.cwd).toBe(
        "/root/mistlehq/platform",
      );
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);
});
