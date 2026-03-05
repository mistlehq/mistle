import { describe, expect } from "vitest";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal-integration-credentials/index.js";
import { INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH } from "../src/internal-sandbox-runtime/index.js";
import { it } from "./test-context.js";

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
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        name: "ZodError",
      },
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
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        name: "ZodError",
      },
    });
  });
});
