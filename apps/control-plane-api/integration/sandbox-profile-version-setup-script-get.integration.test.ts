/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  GetSandboxProfileVersionSetupScriptResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profile version setup script get integration", () => {
  it("returns the persisted setup script for the selected profile version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-setup-script-get@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_get_001",
        organizationId: session.organizationId,
        displayName: "Setup Script Get Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_script_get_001",
        version: 1,
        setupScript: "pnpm install\npnpm dev:bootstrap",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_get_001/versions/1/setup-script",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionSetupScriptResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      sandboxProfileId: "sbp_setup_script_get_001",
      version: 1,
      setupScript: "pnpm install\npnpm dev:bootstrap",
    });
  });

  it("returns 404 when profile version is missing", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-setup-script-get-missing@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_get_missing_001",
        organizationId: session.organizationId,
        displayName: "Missing Setup Script Version Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_get_missing_001/versions/7/setup-script",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  });

  it("returns setup script with an API key that has read permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-setup-script-api-key@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile setup script reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_setup_script_api_key_001",
        organizationId: session.organizationId,
        displayName: "API Key Setup Script Profile",
        createdAt: "2026-03-02T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_setup_script_api_key_001",
        version: 1,
        setupScript: "pnpm api-key-bootstrap",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_setup_script_api_key_001/versions/1/setup-script",
      {
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(GetSandboxProfileVersionSetupScriptResponseSchema.parse(await response.json())).toEqual({
      sandboxProfileId: "sbp_setup_script_api_key_001",
      version: 1,
      setupScript: "pnpm api-key-bootstrap",
    });
  });
});
