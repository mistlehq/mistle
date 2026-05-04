/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationDeviceAuthorizationAttemptStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CancelDeviceAuthorizationAttemptResponseSchema } from "../src/integration-connections/cancel-device-authorization-attempt/schema.js";
import {
  encryptDeviceAuthorizationProviderStateForTest,
  seedIntegrationTarget,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connections device authorization cancel integration", () => {
  it("marks pending attempts cancelled", async ({ env }) => {
    await seedIntegrationTarget(env, {
      targetKey: "openai-default-device-auth-cancel",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    const session = await env.auth.createSession({
      email: "integration-new-device-auth-cancel@example.com",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionDeviceAuthorizationAttempts)
      .values({
        id: "ida_integration_new_cancel_attempt",
        organizationId: session.organizationId,
        targetKey: "openai-default-device-auth-cancel",
        connectionMethodId: "chatgpt-device-code",
        status: IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
        providerStateEncrypted: encryptDeviceAuthorizationProviderStateForTest({
          value: {
            deviceAuthId: "da_cancel",
            userCode: "EFGH-5678",
            intervalSeconds: 5,
          },
        }),
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "EFGH-5678",
        expiresAt: "2099-04-01T00:00:00.000Z",
        pollAfterAt: "2099-04-01T00:00:05.000Z",
      });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/openai-default-device-auth-cancel/device-authorization/attempts/ida_integration_new_cancel_attempt",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(CancelDeviceAuthorizationAttemptResponseSchema.parse(await response.json())).toEqual({
      attemptId: "ida_integration_new_cancel_attempt",
      status: "cancelled",
    });

    const persistedAttempt =
      await env.controlPlaneDb.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
        where: (table, { eq }) => eq(table.id, "ida_integration_new_cancel_attempt"),
      });

    expect(persistedAttempt?.status).toBe(IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED);
    expect(typeof persistedAttempt?.cancelledAt).toBe("string");
  });
});
