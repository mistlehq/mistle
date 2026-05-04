/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { StartDeviceAuthorizationConnectionBadRequestResponseSchema } from "../src/integration-connections/start-device-authorization-connection/schema.js";
import { seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connections device authorization start integration", () => {
  it("returns 400 when the target does not support the requested device authorization method", async ({
    env,
  }) => {
    await seedIntegrationTarget(env, {
      targetKey: "github-cloud-device-auth-start",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    });
    const session = await env.auth.createSession({
      email: "integration-new-device-auth-start@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/github-cloud-device-auth-start/device-authorization/attempts",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          methodId: "chatgpt-device-code",
          displayName: "OpenAI Personal",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(
      StartDeviceAuthorizationConnectionBadRequestResponseSchema.parse(await response.json()),
    ).toEqual({
      code: "DEVICE_AUTH_NOT_SUPPORTED",
      message:
        "Integration target 'github-cloud-device-auth-start' does not support device authorization connection method 'chatgpt-device-code'.",
    });
  });
});
