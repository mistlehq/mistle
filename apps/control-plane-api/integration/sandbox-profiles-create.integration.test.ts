import { SandboxProfileStatuses } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  SandboxProfileSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { it } from "./test-context.js";

describe("sandbox profiles create integration", () => {
  it("creates a sandbox profile in the authenticated user's active organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-create@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Created Profile",
      }),
    });
    expect(response.status).toBe(201);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.organizationId).toBe(authenticatedSession.organizationId);
    expect(body.displayName).toBe("Created Profile");
    expect(body.status).toBe(SandboxProfileStatuses.ACTIVE);

    const persistedProfile = await fixture.db.query.sandboxProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, body.id),
    });
    expect(persistedProfile).toBeDefined();
    if (persistedProfile === undefined) {
      throw new Error("Expected created sandbox profile to be persisted.");
    }
    expect(persistedProfile.organizationId).toBe(authenticatedSession.organizationId);
    expect(persistedProfile.displayName).toBe("Created Profile");
    expect(persistedProfile.status).toBe(SandboxProfileStatuses.ACTIVE);

    const persistedVersions = await fixture.db.query.sandboxProfileVersions.findMany({
      where: (table, { eq }) => eq(table.sandboxProfileId, body.id),
    });
    expect(persistedVersions).toHaveLength(1);

    const [initialVersion] = persistedVersions;
    if (initialVersion === undefined) {
      throw new Error("Expected initial sandbox profile version to exist.");
    }
    expect(initialVersion.sandboxProfileId).toBe(body.id);
    expect(initialVersion.version).toBe(1);
  });

  it("rejects creation when status is provided", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-create-status-not-allowed@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Created Profile",
        status: SandboxProfileStatuses.INACTIVE,
      }),
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("rejects creation without an authenticated session", async ({ fixture }) => {
    const response = await fixture.request("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Unauthenticated",
      }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid create payload", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-create-validation@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "",
      }),
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("does not create a profile in another organization", async ({ fixture }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-create-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-create-org-b@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: firstOrgSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Org A Created Profile",
      }),
    });
    expect(response.status).toBe(201);
    const createdProfile = SandboxProfileSchema.parse(await response.json());

    const secondOrgProfiles = await fixture.db.query.sandboxProfiles.findMany({
      where: (table, { eq }) => eq(table.organizationId, secondOrgSession.organizationId),
    });
    expect(secondOrgProfiles.map((profile) => profile.id)).not.toContain(createdProfile.id);

    const firstOrgProfile = await fixture.db.query.sandboxProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, createdProfile.id),
    });
    expect(firstOrgProfile).toBeDefined();
    if (firstOrgProfile === undefined) {
      throw new Error("Expected created sandbox profile to exist.");
    }
    expect(firstOrgProfile.organizationId).toBe(firstOrgSession.organizationId);
  });
});
