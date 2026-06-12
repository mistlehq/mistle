/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  type IntegrationCredentialSecretKind,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackCredentialSlotKeys } from "@mistle/integrations-definitions";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import type { z } from "zod";

import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
} from "../src/internal/integration-credentials/index.js";
import {
  ResolveIntegrationCredentialResponseSchema,
  type ResolveIntegrationCredentialRequestSchema,
} from "../src/internal/integration-credentials/resolve-integration-credential/schema.js";
import { ResolveIntegrationTargetSecretsResponseSchema } from "../src/internal/integration-credentials/resolve-integration-target-secrets/schema.js";
import {
  encryptCredentialUtf8,
  encryptIntegrationTargetSecrets,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import {
  createFormConnection,
  IntegrationIntegrationsConfig,
  seedIntegrationTarget,
} from "./helpers/integration-connections.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("internal integration credential resolution", () => {
  it("resolves persisted API-key credentials for an active connection", async ({ env }) => {
    await seedIntegrationTarget(env, {
      targetKey: "openai-internal-credential-resolve",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
      },
    });
    const session = await env.auth.createSession({
      email: "integration-internal-credential-resolve-openai@example.com",
    });

    const createResponse = await createFormConnection({
      env,
      targetKey: "openai-internal-credential-resolve",
      cookie: session.cookie,
      body: {
        displayName: "OpenAI internal credential test",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-integration-internal-test",
        },
      },
    });
    expect(createResponse.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await createResponse.json());

    const response = await resolveCredential(env, {
      connectionId: connection.id,
      secretType: IntegrationCredentialSecretKinds.API_KEY,
      slotKey: "openai.openai-default.api-key.api-key",
    });

    expect(response.status).toBe(200);
    expect(ResolveIntegrationCredentialResponseSchema.parse(await response.json())).toEqual({
      kind: "value",
      value: "sk-integration-internal-test",
    });
  });

  it("resolves setup credentials even when another required form secret is not configured yet", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-internal-credential-resolve-slack@example.com",
    });
    await seedIntegrationTarget(env, {
      targetKey: "slack-internal-credential-setup-partial",
      familyId: "slack",
      variantId: "slack-default",
      config: {
        api_base_url: "https://slack.com/api",
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_internal_credential_slack_partial",
      organizationId: session.organizationId,
      targetKey: "slack-internal-credential-setup-partial",
      displayName: "Slack manifest setup partial",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "slack-bot-token",
        client_id: "slack-client-id",
      },
    });

    await insertEncryptedCredential({
      env,
      organizationId: session.organizationId,
      id: "icr_internal_slack_partial_client_secret",
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      plaintext: "slack-client-secret",
      intendedFamilyId: "slack",
      connectionId: "icn_internal_credential_slack_partial",
      slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
    });

    const response = await resolveCredential(env, {
      connectionId: "icn_internal_credential_slack_partial",
      secretType: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
    });

    expect(response.status).toBe(200);
    expect(ResolveIntegrationCredentialResponseSchema.parse(await response.json())).toEqual({
      kind: "value",
      value: "slack-client-secret",
    });
  });

  it("resolves persisted AWS secret access keys for active connections", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-internal-credential-resolve-aws@example.com",
    });
    await seedIntegrationTarget(env, {
      targetKey: "aws-internal-credential-secret-key",
      familyId: "aws",
      variantId: "aws-cli-default",
      config: {},
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_internal_credential_aws_secret_key",
      organizationId: session.organizationId,
      targetKey: "aws-internal-credential-secret-key",
      displayName: "Stored AWS secret access key",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
      },
    });
    await insertEncryptedCredential({
      env,
      organizationId: session.organizationId,
      id: "icr_internal_credential_aws_secret_key",
      secretKind: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
      plaintext: "aws-secret-access-key-value",
      intendedFamilyId: "aws",
      connectionId: "icn_internal_credential_aws_secret_key",
      slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
    });

    const response = await resolveCredential(env, {
      connectionId: "icn_internal_credential_aws_secret_key",
      secretType: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
      slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
    });

    expect(response.status).toBe(200);
    expect(ResolveIntegrationCredentialResponseSchema.parse(await response.json())).toEqual({
      kind: "value",
      value: "aws-secret-access-key-value",
    });
  });

  it("returns safe credential resolution failures from AWS AssumeRole resolver errors", async ({
    env,
  }) => {
    const simulatedSts = await startSimulatedAwsStsAccessDeniedServer();
    try {
      const session = await env.auth.createSession({
        email: "integration-internal-credential-resolve-aws-error@example.com",
      });
      await seedIntegrationTarget(env, {
        targetKey: "aws-internal-credential-resolution-error",
        familyId: "aws",
        variantId: "aws-cli-default",
        config: {
          sts_endpoint_url: simulatedSts.url,
        },
      });
      await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
        id: "icn_internal_credential_aws_resolution_error",
        organizationId: session.organizationId,
        targetKey: "aws-internal-credential-resolution-error",
        displayName: "AWS AssumeRole resolution error",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        },
      });
      await insertEncryptedCredential({
        env,
        organizationId: session.organizationId,
        id: "icr_internal_credential_aws_resolution_error",
        secretKind: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
        plaintext: "aws-secret-access-key-value",
        intendedFamilyId: "aws",
        connectionId: "icn_internal_credential_aws_resolution_error",
        slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
      });
      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
        id: "sbp_internal_credential_aws_resolution_error",
        organizationId: session.organizationId,
        displayName: "AWS resolution error profile",
      });
      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
        sandboxProfileId: "sbp_internal_credential_aws_resolution_error",
        version: 1,
      });
      await env.controlPlaneDb
        .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
        .values({
          id: "ibd_internal_credential_aws_resolution_error",
          sandboxProfileId: "sbp_internal_credential_aws_resolution_error",
          sandboxProfileVersion: 1,
          connectionId: "icn_internal_credential_aws_resolution_error",
          kind: IntegrationBindingKinds.CONNECTOR,
          config: {
            services: ["cloudwatch"],
            regions: ["us-east-1"],
            defaultRegion: "us-east-1",
            tools: ["aws-cloudwatch-mcp"],
          },
        });

      const response = await resolveCredential(env, {
        connectionId: "icn_internal_credential_aws_resolution_error",
        bindingId: "ibd_internal_credential_aws_resolution_error",
        secretType: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
        slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
        resolverKey: "assume-role-session",
      });

      expect(response.status).toBe(502);
      const responseBody = await response.json();
      expect(responseBody).toEqual({
        code: "CREDENTIAL_RESOLUTION_FAILED",
        message:
          "AWS AssumeRole credential resolution failed: AWS STS denied the AssumeRole request. Check that the configured access key principal can assume the configured IAM role, the role trust policy allows it, and the external ID matches if one is configured.",
      });
      expect(JSON.stringify(responseBody)).not.toContain("123456789012");
      expect(JSON.stringify(responseBody)).not.toContain("arn:aws:iam::123456789012:role");
      expect(simulatedSts.observedRequestCount()).toBe(1);
    } finally {
      await simulatedSts.close();
    }
  });

  it("resolves persisted OAuth access tokens with structural expiry", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-internal-credential-resolve-oauth@example.com",
    });
    await seedIntegrationTarget(env, {
      targetKey: "openai-internal-credential-oauth",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_internal_credential_oauth_access",
      organizationId: session.organizationId,
      targetKey: "openai-internal-credential-oauth",
      displayName: "Stored OAuth access token",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      },
    });
    await insertEncryptedCredential({
      env,
      organizationId: session.organizationId,
      id: "icr_internal_credential_oauth_access",
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      plaintext: "oauth2-access-token-value",
      intendedFamilyId: "openai",
      connectionId: "icn_internal_credential_oauth_access",
      slotKey: "openai.openai-default.oauth2-authorization-code.access-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });

    const response = await resolveCredential(env, {
      connectionId: "icn_internal_credential_oauth_access",
      secretType: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      slotKey: "openai.openai-default.oauth2-authorization-code.access-token",
    });

    expect(response.status).toBe(200);
    expect(ResolveIntegrationCredentialResponseSchema.parse(await response.json())).toEqual({
      kind: "value",
      value: "oauth2-access-token-value",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("rejects credential resolution without the internal service token", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          connectionId: "icn_missing",
          secretType: IntegrationCredentialSecretKinds.API_KEY,
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects credential resolution with an invalid internal service token", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "invalid-service-token",
        },
        body: JSON.stringify({
          connectionId: "icn_missing",
          secretType: IntegrationCredentialSecretKinds.API_KEY,
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("resolves encrypted integration target secrets for trusted callers", async ({ env }) => {
    const masterEncryptionKeyMaterial = IntegrationIntegrationsConfig.masterEncryptionKeys[1];
    if (masterEncryptionKeyMaterial === undefined) {
      throw new Error("Expected integration master encryption key material.");
    }

    const encryptedSecrets = encryptIntegrationTargetSecrets({
      secrets: {
        webhook_secret: "super-secret",
        app_private_key: "private-key",
      },
      masterKeyVersion: 1,
      masterEncryptionKeyMaterial,
    });

    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve-target-secrets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
        },
        body: JSON.stringify({
          targets: [
            {
              targetKey: "github-cloud",
              encryptedSecrets,
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(ResolveIntegrationTargetSecretsResponseSchema.parse(await response.json())).toEqual({
      targets: [
        {
          targetKey: "github-cloud",
          secrets: {
            webhook_secret: "super-secret",
            app_private_key: "private-key",
          },
        },
      ],
    });
  });

  it("rejects malformed encrypted integration target secrets", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve-target-secrets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
        },
        body: JSON.stringify({
          targets: [
            {
              targetKey: "github-cloud",
              encryptedSecrets: {
                masterKeyVersion: 1,
                nonce: "broken",
                ciphertext: "broken",
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_TARGET_SECRETS",
      message: "Target 'github-cloud' has invalid encrypted target secrets.",
    });
  });

  it("rejects custom credential resolution when the binding belongs to another connection", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-internal-credential-binding-mismatch@example.com",
    });
    await seedGitHubTarget(env, "github-cloud-internal-credential-binding-mismatch");
    const githubConnection = await createGitHubConnection({
      env,
      cookie: session.cookie,
      targetKey: "github-cloud-internal-credential-binding-mismatch",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_internal_credential_binding_mismatch",
      organizationId: session.organizationId,
      displayName: "Binding mismatch profile",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId: "sbp_internal_credential_binding_mismatch",
      version: 1,
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values({
        id: "ibd_internal_credential_binding_mismatch",
        sandboxProfileId: "sbp_internal_credential_binding_mismatch",
        sandboxProfileVersion: 1,
        connectionId: githubConnection.id,
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle"],
        },
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_internal_credential_other_github_connection",
      organizationId: session.organizationId,
      targetKey: "github-cloud-internal-credential-binding-mismatch",
      displayName: "Other GitHub connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        installation_id: "67890",
      },
    });

    const response = await resolveCredential(env, {
      connectionId: "icn_internal_credential_other_github_connection",
      bindingId: "ibd_internal_credential_binding_mismatch",
      secretType: "github_app_installation_token",
      resolverKey: "github_app_installation_token",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BINDING_CONNECTION_MISMATCH",
      message:
        "Integration binding 'ibd_internal_credential_binding_mismatch' does not belong to connection 'icn_internal_credential_other_github_connection'.",
    });
  });
});

async function resolveCredential(
  env: IntegrationTestEnvironment,
  body: z.input<typeof ResolveIntegrationCredentialRequestSchema>,
) {
  return env.controlPlaneApi.http.fetch(
    `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
      },
      body: JSON.stringify(body),
    },
  );
}

async function startSimulatedAwsStsAccessDeniedServer(): Promise<{
  url: string;
  close: () => Promise<void>;
  observedRequestCount: () => number;
}> {
  let requestCount = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requestCount += 1;
    request.resume();

    // AWS Query APIs return structured XML error responses with an Error Code,
    // Message, and RequestId. The STS client parses this into an AccessDenied
    // service exception before the resolver maps it to the public safe message.
    // Source: https://docs.aws.amazon.com/AWSEC2/latest/APIReference/errors-overview.html
    response.writeHead(403, {
      "content-type": "text/xml",
    });
    response.end(`<?xml version="1.0"?>
<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <Error>
    <Type>Sender</Type>
    <Code>AccessDenied</Code>
    <Message>User arn:aws:iam::123456789012:user/raw-reviewer is not authorized to perform sts:AssumeRole on role arn:aws:iam::123456789012:role/mistle-dev</Message>
  </Error>
  <RequestId>00000000-0000-0000-0000-000000000000</RequestId>
</ErrorResponse>`);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error("Expected simulated AWS STS server to listen on a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () => closeServer(server),
    observedRequestCount: () => requestCount,
  };
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

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return address !== null && typeof address !== "string";
}

async function insertEncryptedCredential(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  id: string;
  secretKind: IntegrationCredentialSecretKind;
  plaintext: string;
  intendedFamilyId: string;
  connectionId: string;
  slotKey: string;
  expiresAt?: string;
}): Promise<void> {
  const organizationCredentialKey =
    await input.env.controlPlaneDb.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: IntegrationIntegrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedCredential = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    await input.env.controlPlaneDb
      .insert(input.env.controlPlaneTables.integrationCredentials)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        secretKind: input.secretKind,
        ciphertext: encryptedCredential.ciphertext,
        nonce: encryptedCredential.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: input.intendedFamilyId,
        expiresAt: input.expiresAt,
      });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }

  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnectionCredentials)
    .values({
      connectionId: input.connectionId,
      credentialId: input.id,
      slotKey: input.slotKey,
    });
}

async function seedGitHubTarget(env: IntegrationTestEnvironment, targetKey: string): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
}

async function createGitHubConnection(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  targetKey: string;
}): Promise<{ id: string }> {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });

  const response = await createFormConnection({
    env: input.env,
    targetKey: input.targetKey,
    cookie: input.cookie,
    body: {
      displayName: "GitHub binding-aware connection",
      methodId: "github-app-installation",
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "12345",
      },
      secrets: {
        appPrivateKeyPem: privateKey,
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    },
  });

  expect(response.status).toBe(201);
  const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return {
    id: connection.id,
  };
}
