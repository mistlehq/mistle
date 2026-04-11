import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  integrationConnectionDeviceAuthorizationAttempts,
  IntegrationDeviceAuthorizationAttemptStatuses,
  IntegrationCredentialSecretKinds,
  integrationTargets,
} from "@mistle/db/control-plane";
import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { describe, expect } from "vitest";
import { z } from "zod";

import { createApp } from "../src/app.js";
import { createControlPlaneAuth } from "../src/auth/index.js";
import { CancelDeviceAuthorizationAttemptResponseSchema } from "../src/integration-connections/cancel-device-authorization-attempt/schema.js";
import {
  IntegrationDeviceAuthorizationAttemptErrorCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../src/integration-connections/constants.js";
import {
  GetDeviceAuthorizationAttemptNotFoundResponseSchema,
  GetDeviceAuthorizationAttemptResponseSchema,
} from "../src/integration-connections/get-device-authorization-attempt/schema.js";
import { StartDeviceAuthorizationConnectionBadRequestResponseSchema } from "../src/integration-connections/start-device-authorization-connection/schema.js";
import {
  decryptCredentialUtf8,
  decryptDeviceAuthorizationProviderStateUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { createAppResources, stopAppResources } from "../src/resources.js";
import { IntegrationPortAccessConfig } from "./helpers/port-access-config.js";
import { it } from "./test-context.js";

describe("integration connections device authorization integration", () => {
  it("returns 400 when a target does not support device authorization start", async ({
    fixture,
  }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-device-auth-start",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-device-auth-start@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-device-auth-start/device-authorization/attempts",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          methodId: "chatgpt-device-code",
          displayName: "OpenAI Personal",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      StartDeviceAuthorizationConnectionBadRequestResponseSchema.parse({
        code: "DEVICE_AUTH_NOT_SUPPORTED",
        message:
          "Integration target 'openai-default-device-auth-start' does not support device authorization connection method 'chatgpt-device-code'.",
      }),
    );
  });

  it("returns 404 when a device authorization attempt does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-device-auth-missing@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-device-auth-missing/device-authorization/attempts/ida_missing",
      {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(
      GetDeviceAuthorizationAttemptNotFoundResponseSchema.parse({
        code: IntegrationConnectionsNotFoundCodes.DEVICE_AUTH_ATTEMPT_NOT_FOUND,
        message: "Device authorization attempt 'ida_missing' was not found.",
      }),
    );
  });

  it("starts a device authorization attempt, persists it, and returns the pending payload", async ({
    fixture,
  }) => {
    const targetKey = "device-auth-generic-start-success";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-device-auth-service-start@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "device-auth-test",
      variantId: "device-auth-test-default",
      enabled: true,
      config: {
        issuer: "https://example.com",
      },
    });

    const registry = new IntegrationRegistry();
    registry.register({
      familyId: "device-auth-test",
      variantId: "device-auth-test-default",
      kind: "agent",
      displayName: "Device Auth Test",
      logoKey: "openai",
      targetConfigSchema: z
        .object({
          issuer: z.string().min(1),
        })
        .strict(),
      targetSecretSchema: z.object({}).strict(),
      bindingConfigSchema: z.record(z.string(), z.unknown()),
      connectionMethods: [
        {
          id: "chatgpt-device-code",
          label: "ChatGPT subscription",
          kind: "device-authorization",
          ui: {
            create: {
              submitLabel: "Connect",
              helperText: "Connect with device authorization",
            },
            pending: {
              title: "Waiting for approval",
              description: "Approve the device code in your browser.",
            },
          },
        },
      ],
      deviceAuthorization: {
        startDeviceAuthorization: () => ({
          verificationUrl: "https://auth.example.com/device",
          userCode: "WXYZ-9999",
          expiresAt: "2099-04-01T00:00:00.000Z",
          pollAfterMs: 5_000,
          providerState: {
            device_auth_id: "da_123",
            interval_seconds: 5,
          },
        }),
        pollDeviceAuthorization: () => ({
          status: "pending",
          providerState: {
            device_auth_id: "da_123",
            interval_seconds: 5,
          },
          pollAfterMs: 5_000,
        }),
      },
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    const resources = await createAppResources(fixture.config);

    try {
      const auth = createControlPlaneAuth({
        config: {
          authBaseUrl: fixture.config.auth.baseUrl,
          dashboardBaseUrl: fixture.config.dashboard.baseUrl,
          authSecret: fixture.config.auth.secret,
          authTrustedOrigins: fixture.config.auth.trustedOrigins,
          authOTPLength: fixture.config.auth.otpLength,
          authOTPExpiresInSeconds: fixture.config.auth.otpExpiresInSeconds,
          authOTPAllowedAttempts: fixture.config.auth.otpAllowedAttempts,
          authGoogleClientId: fixture.config.auth.google?.clientId ?? null,
          authGoogleClientSecret: fixture.config.auth.google?.clientSecret ?? null,
          activeMasterEncryptionKeyVersion:
            fixture.config.integrations.activeMasterEncryptionKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        },
        db: resources.db,
        openWorkflow: resources.openWorkflow,
      });
      const app = createApp({
        config: fixture.config,
        sandboxConfig: {
          defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
          gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        },
        internalAuthServiceToken: fixture.internalAuthServiceToken,
        db: resources.db,
        objectStore: resources.objectStore,
        integrationRegistry: registry,
        dataPlaneClient: createDataPlaneSandboxInstancesClient({
          baseUrl: fixture.config.dataPlaneApi.baseUrl,
          serviceToken: fixture.internalAuthServiceToken,
        }),
        connectionTokenConfig: {
          secret: "integration-connection-secret",
          issuer: "integration-issuer",
          audience: "integration-audience",
        },
        portAccessConfig: IntegrationPortAccessConfig,
        openWorkflow: resources.openWorkflow,
        auth,
      });

      const response = await app.request(
        `/v1/integration/connections/${targetKey}/device-authorization/attempts`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            methodId: "chatgpt-device-code",
            displayName: "OpenAI Personal",
          }),
        },
      );

      expect(response.status).toBe(200);
      const startedAttempt = await response.json();
      expect(startedAttempt).toMatchObject({
        status: "pending",
        verificationUrl: "https://auth.example.com/device",
        userCode: "WXYZ-9999",
        expiresAt: "2099-04-01T00:00:00.000Z",
        pollAfterMs: 5_000,
      });

      if (
        typeof startedAttempt !== "object" ||
        startedAttempt === null ||
        !("attemptId" in startedAttempt) ||
        typeof startedAttempt.attemptId !== "string"
      ) {
        throw new Error("Expected a device authorization attempt id in the response payload.");
      }

      const persistedAttempt =
        await fixture.db.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
          where: (table, { eq }) => eq(table.id, startedAttempt.attemptId),
        });

      expect(persistedAttempt?.organizationId).toBe(authenticatedSession.organizationId);
      expect(persistedAttempt?.targetKey).toBe(targetKey);
      expect(persistedAttempt?.connectionMethodId).toBe("chatgpt-device-code");
      expect(persistedAttempt?.displayName).toBe("OpenAI Personal");
      expect(persistedAttempt?.status).toBe(IntegrationDeviceAuthorizationAttemptStatuses.PENDING);
      expect(persistedAttempt?.verificationUrl).toBe("https://auth.example.com/device");
      expect(persistedAttempt?.userCode).toBe("WXYZ-9999");
      expect(persistedAttempt?.expiresAt).toBe("2099-04-01T00:00:00.000Z");
      expect(persistedAttempt?.pollAfterAt).not.toBeNull();
      expect(persistedAttempt?.providerStateEncrypted).toBeTruthy();
      expect(persistedAttempt?.providerStateEncrypted).not.toContain("da_123");

      const decryptedProviderState = decryptDeviceAuthorizationProviderStateUtf8({
        ciphertext: persistedAttempt?.providerStateEncrypted ?? "",
        masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
      });

      expect(JSON.parse(decryptedProviderState)).toEqual({
        device_auth_id: "da_123",
        interval_seconds: 5,
      });
    } finally {
      await stopAppResources(resources);
    }
  });

  it("marks expired pending attempts failed when status is read", async ({ fixture }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-device-auth-expired",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-device-auth-expired@example.com",
    });

    await fixture.db.insert(integrationConnectionDeviceAuthorizationAttempts).values({
      id: "ida_expired_attempt",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-default-device-auth-expired",
      connectionMethodId: "chatgpt-device-code",
      status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
      providerStateEncrypted: "v1.1.dGVzdA.dGVzdA.dGVzdA",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
      expiresAt: "2026-04-01T00:00:00.000Z",
      pollAfterAt: "2026-04-01T00:00:05.000Z",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-device-auth-expired/device-authorization/attempts/ida_expired_attempt",
      {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      GetDeviceAuthorizationAttemptResponseSchema.parse({
        attemptId: "ida_expired_attempt",
        status: "failed",
        error: {
          code: IntegrationDeviceAuthorizationAttemptErrorCodes.DEVICE_AUTH_EXPIRED,
          message: "The device authorization attempt expired before approval completed.",
        },
      }),
    );

    const persistedAttempt =
      await fixture.db.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
        where: (table, { eq }) => eq(table.id, "ida_expired_attempt"),
      });

    expect(persistedAttempt?.status).toBe(IntegrationDeviceAuthorizationAttemptStatuses.FAILED);
    expect(persistedAttempt?.errorCode).toBe(
      IntegrationDeviceAuthorizationAttemptErrorCodes.DEVICE_AUTH_EXPIRED,
    );
    expect(persistedAttempt?.errorMessage).toBe(
      "The device authorization attempt expired before approval completed.",
    );
  });

  it("marks pending attempts cancelled", async ({ fixture }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-device-auth-cancel",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-device-auth-cancel@example.com",
    });

    await fixture.db.insert(integrationConnectionDeviceAuthorizationAttempts).values({
      id: "ida_cancel_attempt",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-default-device-auth-cancel",
      connectionMethodId: "chatgpt-device-code",
      status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
      providerStateEncrypted: "v1.1.dGVzdA.dGVzdA.dGVzdA",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "EFGH-5678",
      expiresAt: "2099-04-01T00:00:00.000Z",
      pollAfterAt: "2099-04-01T00:00:05.000Z",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-device-auth-cancel/device-authorization/attempts/ida_cancel_attempt",
      {
        method: "DELETE",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      CancelDeviceAuthorizationAttemptResponseSchema.parse({
        attemptId: "ida_cancel_attempt",
        status: "cancelled",
      }),
    );

    const persistedAttempt =
      await fixture.db.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
        where: (table, { eq }) => eq(table.id, "ida_cancel_attempt"),
      });

    expect(persistedAttempt?.status).toBe(IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED);
    expect(typeof persistedAttempt?.cancelledAt).toBe("string");
  });

  it("completes a device authorization attempt and creates a managed-token connection", async ({
    fixture,
  }) => {
    const targetKey = "device-auth-generic-complete-success";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-device-auth-service-complete@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "device-auth-test",
      variantId: "device-auth-test-complete",
      enabled: true,
      config: {
        issuer: "https://example.com",
      },
    });

    const registry = new IntegrationRegistry();
    registry.register({
      familyId: "device-auth-test",
      variantId: "device-auth-test-complete",
      kind: "agent",
      displayName: "Device Auth Test",
      logoKey: "openai",
      targetConfigSchema: z
        .object({
          issuer: z.string().min(1),
        })
        .strict(),
      targetSecretSchema: z.object({}).strict(),
      bindingConfigSchema: z.record(z.string(), z.unknown()),
      connectionMethods: [
        {
          id: "chatgpt-device-code",
          label: "ChatGPT subscription",
          kind: "device-authorization",
          ui: {
            create: {
              submitLabel: "Connect",
              helperText: "Connect with device authorization",
            },
            pending: {
              title: "Waiting for approval",
              description: "Approve the device code in your browser.",
            },
          },
        },
      ],
      deviceAuthorization: {
        startDeviceAuthorization: () => ({
          verificationUrl: "https://auth.example.com/device",
          userCode: "ABCD-1234",
          expiresAt: "2099-04-01T00:00:00.000Z",
          pollAfterMs: 0,
          providerState: {
            device_auth_id: "da_456",
            interval_seconds: 5,
          },
        }),
        pollDeviceAuthorization: () => ({
          status: "completed",
          externalSubjectId: "thomas@mistle.dev",
          connectionConfig: {
            auth_mode: "chatgpt",
            chatgpt_account_id: "acct_123",
            chatgpt_plan_type: "pro",
          },
          accessToken: "oauth-access-token",
          accessTokenExpiresAt: "2099-04-01T00:05:00.000Z",
          refreshToken: "oauth-refresh-token",
          refreshTokenExpiresAt: "2099-04-30T00:05:00.000Z",
          credentialMetadata: {
            provider: "openai",
          },
        }),
      },
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    const resources = await createAppResources(fixture.config);

    try {
      const auth = createControlPlaneAuth({
        config: {
          authBaseUrl: fixture.config.auth.baseUrl,
          dashboardBaseUrl: fixture.config.dashboard.baseUrl,
          authSecret: fixture.config.auth.secret,
          authTrustedOrigins: fixture.config.auth.trustedOrigins,
          authOTPLength: fixture.config.auth.otpLength,
          authOTPExpiresInSeconds: fixture.config.auth.otpExpiresInSeconds,
          authOTPAllowedAttempts: fixture.config.auth.otpAllowedAttempts,
          authGoogleClientId: fixture.config.auth.google?.clientId ?? null,
          authGoogleClientSecret: fixture.config.auth.google?.clientSecret ?? null,
          activeMasterEncryptionKeyVersion:
            fixture.config.integrations.activeMasterEncryptionKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        },
        db: resources.db,
        openWorkflow: resources.openWorkflow,
      });
      const app = createApp({
        config: fixture.config,
        sandboxConfig: {
          defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
          gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        },
        internalAuthServiceToken: fixture.internalAuthServiceToken,
        db: resources.db,
        objectStore: resources.objectStore,
        integrationRegistry: registry,
        dataPlaneClient: createDataPlaneSandboxInstancesClient({
          baseUrl: fixture.config.dataPlaneApi.baseUrl,
          serviceToken: fixture.internalAuthServiceToken,
        }),
        connectionTokenConfig: {
          secret: "integration-connection-secret",
          issuer: "integration-issuer",
          audience: "integration-audience",
        },
        portAccessConfig: IntegrationPortAccessConfig,
        openWorkflow: resources.openWorkflow,
        auth,
      });

      const startResponse = await app.request(
        `/v1/integration/connections/${targetKey}/device-authorization/attempts`,
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            methodId: "chatgpt-device-code",
            displayName: "OpenAI Personal",
          }),
        },
      );

      expect(startResponse.status).toBe(200);
      const startedAttempt = await startResponse.json();
      if (
        typeof startedAttempt !== "object" ||
        startedAttempt === null ||
        !("attemptId" in startedAttempt) ||
        typeof startedAttempt.attemptId !== "string"
      ) {
        throw new Error("Expected a device authorization attempt id in the start response.");
      }

      const completeResponse = await app.request(
        `/v1/integration/connections/${targetKey}/device-authorization/attempts/${startedAttempt.attemptId}`,
        {
          method: "GET",
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(completeResponse.status).toBe(200);
      const completedAttempt = GetDeviceAuthorizationAttemptResponseSchema.parse(
        await completeResponse.json(),
      );
      expect(completedAttempt.status).toBe("completed");

      if (completedAttempt.status !== "completed") {
        throw new Error("Expected a completed device authorization attempt.");
      }

      const repeatedStatusResponse = await app.request(
        `/v1/integration/connections/${targetKey}/device-authorization/attempts/${startedAttempt.attemptId}`,
        {
          method: "GET",
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(repeatedStatusResponse.status).toBe(200);
      await expect(repeatedStatusResponse.json()).resolves.toEqual({
        attemptId: startedAttempt.attemptId,
        status: "completed",
        connectionId: completedAttempt.connectionId,
      });

      const cancelAfterCompletionResponse = await app.request(
        `/v1/integration/connections/${targetKey}/device-authorization/attempts/${startedAttempt.attemptId}`,
        {
          method: "DELETE",
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(cancelAfterCompletionResponse.status).toBe(200);
      await expect(cancelAfterCompletionResponse.json()).resolves.toEqual({
        attemptId: startedAttempt.attemptId,
        status: "completed",
        connectionId: completedAttempt.connectionId,
      });

      const persistedAttempt =
        await fixture.db.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
          where: (table, { eq }) => eq(table.id, startedAttempt.attemptId),
        });

      expect(persistedAttempt?.status).toBe(
        IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
      );
      expect(persistedAttempt?.connectionId).toBe(completedAttempt.connectionId);
      expect(typeof persistedAttempt?.completedAt).toBe("string");

      const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
        where: (table, { eq }) => eq(table.id, completedAttempt.connectionId),
      });

      expect(persistedConnection).toMatchObject({
        id: completedAttempt.connectionId,
        organizationId: authenticatedSession.organizationId,
        targetKey,
        displayName: "OpenAI Personal",
        externalSubjectId: "thomas@mistle.dev",
        status: "active",
        config: {
          connection_method: "chatgpt-device-code",
          auth_mode: "chatgpt",
          chatgpt_account_id: "acct_123",
          chatgpt_plan_type: "pro",
        },
      });

      const connectionCredentialLinks =
        await fixture.db.query.integrationConnectionCredentials.findMany({
          where: (table, { eq }) => eq(table.connectionId, completedAttempt.connectionId),
        });

      expect(connectionCredentialLinks).toHaveLength(2);
      expect([...connectionCredentialLinks.map((link) => link.slotKey)].sort()).toEqual(
        [
          createOAuth2AuthorizationCodeCredentialSlotKeys({
            familyId: "device-auth-test",
            variantId: "device-auth-test-complete",
          }).accessToken,
          createOAuth2AuthorizationCodeCredentialSlotKeys({
            familyId: "device-auth-test",
            variantId: "device-auth-test-complete",
          }).refreshToken,
        ].sort(),
      );

      const credentialIds = connectionCredentialLinks.map((link) => link.credentialId);
      const storedCredentials = await fixture.db.query.integrationCredentials.findMany({
        where: (table, { inArray }) => inArray(table.id, credentialIds),
      });

      expect(storedCredentials).toHaveLength(2);
      expect([...storedCredentials.map((credential) => credential.secretKind)].sort()).toEqual(
        [
          IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
        ].sort(),
      );

      const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst(
        {
          where: (table, { eq }) => eq(table.organizationId, authenticatedSession.organizationId),
          orderBy: (table, { desc }) => [desc(table.version)],
        },
      );

      if (organizationCredentialKey === undefined) {
        throw new Error("Expected an organization credential key for the completed attempt.");
      }

      const accessCredential = storedCredentials.find(
        (credential) =>
          credential.secretKind === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      );
      const refreshCredential = storedCredentials.find(
        (credential) =>
          credential.secretKind === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      );

      if (accessCredential === undefined || refreshCredential === undefined) {
        throw new Error("Expected both access and refresh credentials to be stored.");
      }

      expect(
        decryptStoredCredential({
          wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
          masterKeyVersion: organizationCredentialKey.masterKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
          nonce: accessCredential.nonce,
          ciphertext: accessCredential.ciphertext,
        }),
      ).toBe("oauth-access-token");
      expect(
        decryptStoredCredential({
          wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
          masterKeyVersion: organizationCredentialKey.masterKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
          nonce: refreshCredential.nonce,
          ciphertext: refreshCredential.ciphertext,
        }),
      ).toBe("oauth-refresh-token");
    } finally {
      await stopAppResources(resources);
    }
  });
});

function decryptStoredCredential(input: {
  wrappedOrganizationKeyCiphertext: string;
  masterKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
  nonce: string;
  ciphertext: string;
}): string {
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.masterKeyVersion,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
  const organizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: input.wrappedOrganizationKeyCiphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}
