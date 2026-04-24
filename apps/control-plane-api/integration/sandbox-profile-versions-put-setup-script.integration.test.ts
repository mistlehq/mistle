import {
  sandboxProfiles,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  PutSandboxProfileVersionSetupScriptConflictResponseSchema,
  PutSandboxProfileVersionSetupScriptResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile version put setup script integration", () => {
  it("replaces the setup script for the selected profile version", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-setup-script@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_put_setup_script_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Put Setup Script Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_put_setup_script_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_setup_script_001/versions/1/setup-script",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          setupScript: "pnpm install\npnpm dev:bootstrap",
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionSetupScriptResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      sandboxProfileId: "sbp_put_setup_script_001",
      version: 1,
      setupScript: "pnpm install\npnpm dev:bootstrap",
    });

    const persistedVersion = await fixture.db.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_put_setup_script_001"), eq(table.version, 1)),
    });
    expect(persistedVersion?.setupScript).toBe("pnpm install\npnpm dev:bootstrap");
  }, 60_000);

  it("clears the setup script when the request sets it to null", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-setup-script-clear@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_put_setup_script_clear_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Clear Setup Script Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_put_setup_script_clear_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_setup_script_clear_001/versions/1/setup-script",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          setupScript: null,
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionSetupScriptResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.setupScript).toBeNull();

    const persistedVersion = await fixture.db.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_put_setup_script_clear_001"), eq(table.version, 1)),
    });
    expect(persistedVersion?.setupScript).toBeNull();
  }, 60_000);

  it("returns 400 when the setup script is an empty string", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-setup-script-invalid@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_put_setup_script_invalid_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Invalid Setup Script Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_put_setup_script_invalid_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_setup_script_invalid_001/versions/1/setup-script",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          setupScript: "",
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = ValidationErrorResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("VALIDATION_ERROR");
  }, 60_000);

  it("returns 409 when the selected profile version is published", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-setup-script-published@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_put_setup_script_published_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Published Setup Script Profile",
        activeVersion: 1,
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_put_setup_script_published_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-01T00:01:00.000Z",
        setupScript: "echo keep-published-script",
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_setup_script_published_001/versions/1/setup-script",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          setupScript: "echo should-not-overwrite",
        }),
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PutSandboxProfileVersionSetupScriptConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_DRAFT");

    const persistedVersion = await fixture.db.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_put_setup_script_published_001"), eq(table.version, 1)),
    });
    expect(persistedVersion?.setupScript).toBe("echo keep-published-script");
  }, 60_000);

  it("returns 404 when profile version is missing", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-setup-script-missing@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_put_setup_script_missing_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Missing Setup Script Version Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_setup_script_missing_001/versions/2/setup-script",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          setupScript: "pnpm install",
        }),
      },
    );

    expect(response.status).toBe(404);
    const responseBody = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 60_000);
});
