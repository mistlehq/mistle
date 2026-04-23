import { sandboxProfiles, sandboxProfileVersions } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  GetSandboxProfileVersionSetupScriptResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile version setup script get integration", () => {
  it("returns the persisted setup script for the selected profile version", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-setup-script-get@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_setup_script_get_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Setup Script Get Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_setup_script_get_001",
        version: 1,
        setupScript: "pnpm install\npnpm dev:bootstrap",
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_setup_script_get_001/versions/1/setup-script",
      {
        headers: {
          cookie: authenticatedSession.cookie,
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
  }, 60_000);

  it("returns 404 when profile version is missing", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-setup-script-get-missing@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_setup_script_get_missing_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Missing Setup Script Version Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_setup_script_get_missing_001/versions/7/setup-script",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 60_000);
});
