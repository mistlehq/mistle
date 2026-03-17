import { generateKeyPairSync } from "node:crypto";

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { encryptIntegrationTargetSecrets } from "../src/integration-credentials/crypto.js";
import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
} from "../src/internal-integration-credentials/index.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

type ConnectionResponse = {
  id: string;
};

async function insertGitHubBindingFixture(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
  connectionId: string;
  bindingId: string;
}) {
  const authSession = await input.fixture.authSession();
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
  const encryptedSecrets = encryptIntegrationTargetSecrets({
    secrets: {
      app_private_key_pem: privateKey,
    },
    masterKeyVersion: 1,
    masterEncryptionKeyMaterial: "integration-master-key-testing",
  });

  await input.fixture.db.insert(integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
      app_id: "123",
    },
    secrets: encryptedSecrets,
  });

  await input.fixture.db.insert(integrationConnections).values({
    id: input.connectionId,
    organizationId: authSession.organizationId,
    targetKey: input.targetKey,
    displayName: "GitHub binding-aware connection",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: "github-app-installation",
      installation_id: "12345",
    },
  });

  await input.fixture.db.insert(sandboxProfiles).values({
    id: "sbp_github_binding_aware",
    organizationId: authSession.organizationId,
    displayName: "GitHub binding-aware profile",
  });

  await input.fixture.db.insert(sandboxProfileVersions).values({
    sandboxProfileId: "sbp_github_binding_aware",
    version: 1,
  });

  await input.fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
    id: input.bindingId,
    sandboxProfileId: "sbp_github_binding_aware",
    sandboxProfileVersion: 1,
    connectionId: input.connectionId,
    kind: IntegrationBindingKinds.GIT,
    config: {
      repositories: ["mistlehq/mistle", "mistlehq/platform", "mistlehq/mistle"],
    },
  });

  return {
    organizationId: authSession.organizationId,
    connectionId: input.connectionId,
    bindingId: input.bindingId,
  };
}

describe("internal integration credentials resolve", () => {
  it("resolves persisted integration credentials for an active connection", async ({ fixture }) => {
    const authSession = await fixture.authSession();

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai_default",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        base_url: "https://api.openai.com/v1",
      },
    });

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/openai_default/api-key",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI internal credential test",
          apiKey: "sk-integration-test",
        }),
      },
    );
    expect(createConnectionResponse.status).toBe(201);
    const connection = (await createConnectionResponse.json()) as ConnectionResponse;

    const resolveResponse = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          connectionId: connection.id,
          secretType: "api_key",
          purpose: "api_key",
        }),
      },
    );

    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toEqual({
      value: "sk-integration-test",
    });
  });

  it("rejects requests with invalid internal service token", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "invalid-service-token",
        },
        body: JSON.stringify({
          connectionId: "icn_missing",
          secretType: "api_key",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects requests without internal service token", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          connectionId: "icn_missing",
          secretType: "api_key",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("resolves encrypted integration target secrets", async ({ fixture }) => {
    const encryptedSecrets = encryptIntegrationTargetSecrets({
      secrets: {
        webhook_secret: "super-secret",
        app_private_key: "private-key",
      },
      masterKeyVersion: 1,
      masterEncryptionKeyMaterial: "integration-master-key-testing",
    });

    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve-target-secrets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
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
    await expect(response.json()).resolves.toEqual({
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

  it("rejects malformed encrypted integration target secrets", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve-target-secrets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
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

  it("rejects custom credential resolution when binding belongs to a different connection", async ({
    fixture,
  }) => {
    const githubFixture = await insertGitHubBindingFixture({
      fixture,
      targetKey: "github-cloud-binding-aware-mismatch",
      connectionId: "icn_github_binding_aware_mismatch",
      bindingId: "ibd_github_binding_aware_mismatch",
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_github_other_connection",
      organizationId: githubFixture.organizationId,
      targetKey: "github-cloud-binding-aware-mismatch",
      displayName: "Other GitHub connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "github-app-installation",
        installation_id: "67890",
      },
    });

    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          connectionId: "icn_github_other_connection",
          bindingId: githubFixture.bindingId,
          secretType: "oauth_access_token",
          resolverKey: "github_app_installation_token",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BINDING_CONNECTION_MISMATCH",
      message:
        "Integration binding 'ibd_github_binding_aware_mismatch' does not belong to connection 'icn_github_other_connection'.",
    });
  });
});
