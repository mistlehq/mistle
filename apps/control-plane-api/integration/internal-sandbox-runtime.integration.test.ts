/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  E2BSandboxRuntimeCredentialSlotKeys,
  E2BSandboxRuntimeFamilyId,
  E2BSandboxRuntimeVariantId,
} from "@mistle/integrations-definitions/sandbox-runtimes";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH } from "../src/internal/sandbox-runtime/index.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import {
  waitForQueuedResumeWorkflowInput,
  waitForQueuedStartWorkflowInput,
} from "./helpers/data-plane-workflows.js";
import {
  createFormConnection,
  expectCredentialSlots,
  seedIntegrationTarget,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const IntegrationMasterEncryptionKeys = {
  1: "integration-new-master-key-testing",
};

const StartProfileInstanceResponseSchema = z.object({
  sandboxInstanceId: z.string().min(1),
});

describe.concurrent("internal sandbox runtime integration", () => {
  it("rejects start-profile-instance requests without internal service token", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
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

  it("rejects start-profile-instance requests with malformed body", async ({ env }) => {
    const response = await internalSandboxRuntimeRequest(env, {
      path: "/start-profile-instance",
      body: {
        organizationId: "org_test",
        profileId: "sbp_test",
        profileVersion: "not_a_number",
        startedBy: {
          kind: "system",
          id: "aru_test",
        },
        source: "webhook",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("rejects mint-connection-token requests without internal service token", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
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

  it("rejects mint-connection-token requests with malformed body", async ({ env }) => {
    const response = await internalSandboxRuntimeRequest(env, {
      path: "/mint-connection-token",
      body: {
        organizationId: "org_test",
        instanceId: "",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("rejects resume-sandbox-instance requests without internal service token", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
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

  it("rejects resume-sandbox-instance requests with malformed body", async ({ env }) => {
    const response = await internalSandboxRuntimeRequest(env, {
      path: "/resume-sandbox-instance",
      body: {
        organizationId: "org_test",
        instanceId: "",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("resolves E2B sandbox runtime credentials from a sandbox connection", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-internal-sandbox-runtime-e2b-credentials@example.com",
    });
    await seedIntegrationTarget(env, {
      targetKey: "e2b-internal-runtime-credentials",
      familyId: E2BSandboxRuntimeFamilyId,
      variantId: E2BSandboxRuntimeVariantId,
      config: {
        domain: "e2b.internal.example.com",
      },
    });

    const createResponse = await createFormConnection({
      env,
      targetKey: "e2b-internal-runtime-credentials",
      cookie: session.cookie,
      body: {
        displayName: "E2B runtime credentials",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {},
        secrets: {
          apiKey: "e2b-connection-api-key",
        },
      },
    });

    expect(createResponse.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await createResponse.json());
    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: E2BSandboxRuntimeCredentialSlotKeys.API_KEY,
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          intendedFamilyId: E2BSandboxRuntimeFamilyId,
          plaintext: "e2b-connection-api-key",
        },
      ],
    });

    const response = await internalSandboxRuntimeRequest(env, {
      path: "/resolve-credentials",
      body: {
        organizationId: session.organizationId,
        provider: "e2b",
        connectionId: connection.id,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: "e2b",
      source: "connection",
      apiKey: "e2b-connection-api-key",
      domain: "e2b.internal.example.com",
    });
  });

  it("queues sandbox resume for internal callers", async ({ env }) => {
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
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

    const response = await internalSandboxRuntimeRequest(env, {
      path: "/resume-sandbox-instance",
      body: {
        organizationId: "org_internal_resume",
        instanceId: "sbi_internal_resume_001",
        idempotencyKey: "internal-resume-test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "accepted",
      sandboxInstanceId: "sbi_internal_resume_001",
    });

    const queuedWorkflowInput = await waitForQueuedResumeWorkflowInput({
      env,
      sandboxInstanceId: "sbi_internal_resume_001",
    });
    expect(queuedWorkflowInput).toMatchObject({
      sandboxInstanceId: "sbi_internal_resume_001",
    });
  });

  it("starts a profile instance with acting-user git identity", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-internal-start-profile-instance-git-identity@example.com",
    });

    await seedProfileWithAgent(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_start_git_identity",
      openAiTargetKey: "openai-internal-start-git-identity",
      openAiConnectionId: "icn_internal_start_git_identity_agent",
      agentBindingId: "ibd_internal_start_git_identity_agent",
    });
    await seedGitIdentityProvider(env, {
      organizationId: session.organizationId,
      userId: session.userId,
    });

    const response = await internalSandboxRuntimeRequest(env, {
      path: "/start-profile-instance",
      body: {
        organizationId: session.organizationId,
        profileId: "sbp_internal_start_git_identity",
        profileVersion: 1,
        startedBy: {
          kind: "user",
          id: session.userId,
        },
        actingUser: {
          userId: session.userId,
        },
        source: "dashboard",
      },
    });

    expect(response.status).toBe(200);
    const body = StartProfileInstanceResponseSchema.parse(await response.json());

    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
    });
    expect(queuedWorkflowInput.gitIdentity).toEqual({
      name: "Mistle User",
      email: "mistle-user@example.com",
      signing: {
        format: "ssh",
        program: "/opt/mistle/bin/mistle-ssh-sign",
        keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestSigningKey mistle-user@example.com",
        organizationId: session.organizationId,
        providerFamily: "github",
        actingUserId: session.userId,
      },
    });
  });

  it("starts the sandbox in the selected primary repository for internal callers", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-internal-start-profile-instance-primary-repository@example.com",
    });

    await seedProfileWithAgent(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_start_primary_repository",
      openAiTargetKey: "openai-internal-start-primary-repository",
      openAiConnectionId: "icn_internal_start_primary_repository_agent",
      agentBindingId: "ibd_internal_start_primary_repository_agent",
    });
    await seedGitBinding(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_start_primary_repository",
    });

    const response = await internalSandboxRuntimeRequest(env, {
      path: "/start-profile-instance",
      body: {
        organizationId: session.organizationId,
        profileId: "sbp_internal_start_primary_repository",
        profileVersion: 1,
        primaryRepositoryId: "mistlehq/platform",
        startedBy: {
          kind: "system",
          id: "aru_internal_start_primary_repository",
        },
        source: "webhook",
      },
    });

    expect(response.status).toBe(200);
    const body = StartProfileInstanceResponseSchema.parse(await response.json());

    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: body.sandboxInstanceId,
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
  });
});

async function internalSandboxRuntimeRequest(
  env: IntegrationTestEnvironment,
  input: {
    path: string;
    body: Record<string, unknown>;
  },
) {
  return await env.controlPlaneApi.http.fetch(
    `${INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH}${input.path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "integration-new-internal-service-token",
      },
      body: JSON.stringify(input.body),
    },
  );
}

async function seedProfileWithAgent(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    openAiTargetKey: string;
    openAiConnectionId: string;
    agentBindingId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: "Internal Start Profile",
    status: "active",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: 1,
    state: "draft",
    sandboxProvider: "docker",
    sandboxConnectionId: null,
    sandboxVcpuCount: null,
    sandboxMemoryMb: null,
    sandboxStorageMb: null,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
    targetKey: input.openAiTargetKey,
    familyId: "openai",
    variantId: "openai-default",
    enabled: true,
    config: {
      api_base_url: "https://api.openai.com/v1",
    },
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: input.openAiConnectionId,
    organizationId: input.organizationId,
    targetKey: input.openAiTargetKey,
    displayName: "Internal start agent connection",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    },
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: input.agentBindingId,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: 1,
      connectionId: input.openAiConnectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
      },
    });
}

async function seedGitIdentityProvider(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
    targetKey: "github-internal-start-git-identity",
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: "icn_internal_start_git_identity_provider",
    organizationId: input.organizationId,
    targetKey: "github-internal-start-git-identity",
    displayName: "Internal start git identity provider connection",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      app_id: "123",
      app_slug: "mistle-github-app",
      client_id: "Iv1.internalStartGitIdentity",
    },
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
    .values({
      id: "ilp_internal_start_git_identity",
      organizationId: input.organizationId,
      providerFamily: "github",
      status: "active",
      integrationTargetKey: "github-internal-start-git-identity",
      integrationConnectionId: "icn_internal_start_git_identity_provider",
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
      policy: {
        gitCommitSigningMode: "allowed",
      },
    });
  await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipals).values({
    id: "uep_internal_start_git_identity",
    organizationId: input.organizationId,
    userId: input.userId,
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
  await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipalCredentials).values({
    id: "upc_internal_start_git_identity_signing",
    organizationId: input.organizationId,
    principalId: "uep_internal_start_git_identity",
    providerFamily: "github",
    credentialKind: "git_ssh_signing_key",
    status: UserExternalPrincipalCredentialStatuses.ACTIVE,
  });
  await insertPrincipalCredentialSecret(env, {
    organizationId: input.organizationId,
    credentialId: "upc_internal_start_git_identity_signing",
    secretKind: UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
    plaintext: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----",
    metadata: {
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestSigningKey mistle-user@example.com",
      publicKeyFingerprint: "SHA256:test-internal-start-signing-key",
    },
  });
}

async function seedGitBinding(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
    targetKey: "github-internal-start-primary-repository",
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: "icn_internal_start_primary_repository_git",
    organizationId: input.organizationId,
    targetKey: "github-internal-start-primary-repository",
    displayName: "Internal start primary repository git connection",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    },
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: "ibd_internal_start_primary_repository_git",
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: 1,
      connectionId: "icn_internal_start_primary_repository_git",
      kind: IntegrationBindingKinds.GIT,
      config: {
        repositories: ["mistlehq/mistle", "mistlehq/platform"],
        tools: [],
      },
    });
}

async function insertPrincipalCredentialSecret(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    credentialId: string;
    secretKind: typeof UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY;
    plaintext: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const organizationCredentialKey =
    await env.controlPlaneDb.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: IntegrationMasterEncryptionKeys,
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

    await env.controlPlaneDb
      .insert(env.controlPlaneTables.userExternalPrincipalCredentialSecrets)
      .values({
        organizationId: input.organizationId,
        credentialId: input.credentialId,
        secretKind: input.secretKind,
        ciphertext: encryptedSecret.ciphertext,
        nonce: encryptedSecret.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        metadata: input.metadata,
      });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}
