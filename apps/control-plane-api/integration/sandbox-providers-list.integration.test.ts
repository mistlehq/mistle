/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { ListSandboxProvidersResponseSchema } from "../src/sandbox-providers/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox providers catalog integration", () => {
  it("returns supported sandbox providers and marks the deployment default as managed", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-providers-list@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/providers", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);

    const parsed = ListSandboxProvidersResponseSchema.parse(await response.json());
    expect(parsed.items).toEqual([
      {
        id: "docker",
        displayName: "Docker",
        managed: true,
        supportsOrganizationConnection: false,
        resourceCapabilities: null,
      },
      {
        id: "e2b",
        displayName: "E2B",
        managed: false,
        supportsOrganizationConnection: true,
        resourceCapabilities: {
          vcpuCount: {
            min: 1,
            max: 8,
            step: 1,
            default: 2,
          },
          memoryMb: {
            min: 1024,
            max: 8192,
            step: 1024,
            default: 4096,
          },
        },
      },
    ]);
  });
});
