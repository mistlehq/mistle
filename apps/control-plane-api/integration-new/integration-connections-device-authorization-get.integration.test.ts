/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationDeviceAuthorizationAttemptStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  IntegrationConnectionsNotFoundCodes,
  IntegrationDeviceAuthorizationAttemptErrorCodes,
} from "../src/integration-connections/constants.js";
import {
  GetDeviceAuthorizationAttemptNotFoundResponseSchema,
  GetDeviceAuthorizationAttemptResponseSchema,
} from "../src/integration-connections/get-device-authorization-attempt/schema.js";
import {
  encryptDeviceAuthorizationProviderStateForTest,
  seedIntegrationTarget,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connections device authorization get integration", () => {
  it("returns 404 when a device authorization attempt does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-device-auth-missing@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/openai-default-device-auth-missing/device-authorization/attempts/ida_missing",
      {
        method: "GET",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    expect(
      GetDeviceAuthorizationAttemptNotFoundResponseSchema.parse(await response.json()),
    ).toEqual({
      code: IntegrationConnectionsNotFoundCodes.DEVICE_AUTH_ATTEMPT_NOT_FOUND,
      message: "Device authorization attempt 'ida_missing' was not found.",
    });
  });

  it("marks expired pending attempts failed when status is read", async ({ env }) => {
    await seedIntegrationTarget(env, {
      targetKey: "openai-default-device-auth-expired",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    const session = await env.auth.createSession({
      email: "integration-new-device-auth-expired@example.com",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionDeviceAuthorizationAttempts)
      .values({
        id: "ida_integration_new_expired_attempt",
        organizationId: session.organizationId,
        targetKey: "openai-default-device-auth-expired",
        connectionMethodId: "chatgpt-device-code",
        status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
        providerStateEncrypted: encryptDeviceAuthorizationProviderStateForTest({
          value: {
            deviceAuthId: "da_expired",
            userCode: "ABCD-1234",
            intervalSeconds: 5,
          },
        }),
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
        expiresAt: "2026-04-01T00:00:00.000Z",
        pollAfterAt: "2026-04-01T00:00:05.000Z",
      });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/openai-default-device-auth-expired/device-authorization/attempts/ida_integration_new_expired_attempt",
      {
        method: "GET",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(GetDeviceAuthorizationAttemptResponseSchema.parse(await response.json())).toEqual({
      attemptId: "ida_integration_new_expired_attempt",
      status: "failed",
      error: {
        code: IntegrationDeviceAuthorizationAttemptErrorCodes.DEVICE_AUTH_EXPIRED,
        message: "The device authorization attempt expired before approval completed.",
      },
    });

    const persistedAttempt =
      await env.controlPlaneDb.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
        where: (table, { eq }) => eq(table.id, "ida_integration_new_expired_attempt"),
      });

    expect(persistedAttempt?.status).toBe(IntegrationDeviceAuthorizationAttemptStatuses.FAILED);
    expect(persistedAttempt?.errorCode).toBe(
      IntegrationDeviceAuthorizationAttemptErrorCodes.DEVICE_AUTH_EXPIRED,
    );
    expect(persistedAttempt?.errorMessage).toBe(
      "The device authorization attempt expired before approval completed.",
    );
  });
});
