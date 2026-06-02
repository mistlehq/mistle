/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  ListSkillsSourceReposResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { persistSkillsSourceRepoSyncResult } from "../src/skills-source-repos/services/sync-skills-source-repo.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("skills source repos integration", () => {
  it("lists synced skills source repos for a sandbox profile version and origin URL", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-list-skills-source-repos@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-list-other-skills-source-repos@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_list_skills_source_repos",
        organizationId: session.organizationId,
        displayName: "List Skills Source Repos Profile",
        createdAt: "2026-06-02T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_list_skills_source_repos",
        version: 1,
        sandboxProvider: "docker",
      }),
    );

    const alphaRepo = await persistSkillsSourceRepoSyncResult(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        originUrl: "https://github.com/acme/alpha-skills.git",
        discoverOutput: {
          commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          skills: [
            {
              name: "alpha",
              description: "Use alpha skills.",
              relativePath: ".agents/skills/alpha",
            },
          ],
        },
      },
    );
    const betaRepo = await persistSkillsSourceRepoSyncResult(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        originUrl: "https://github.com/acme/beta-skills.git",
        discoverOutput: {
          commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          skills: [
            {
              name: "beta",
              description: "Use beta skills.",
              relativePath: ".agents/skills/beta",
            },
          ],
        },
      },
    );
    await persistSkillsSourceRepoSyncResult(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: otherSession.organizationId,
        originUrl: "https://github.com/acme/alpha-skills.git",
        discoverOutput: {
          commitSha: "cccccccccccccccccccccccccccccccccccccccc",
          skills: [
            {
              name: "other-alpha",
              description: "Use another organization's alpha skills.",
              relativePath: ".agents/skills/other-alpha",
            },
          ],
        },
      },
    );

    const listResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_list_skills_source_repos/versions/1/skills-sources",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(listResponse.status).toBe(200);
    const listBody = ListSkillsSourceReposResponseSchema.parse(await listResponse.json());
    expect(listBody.items).toEqual([
      {
        id: alphaRepo.id,
        originUrl: "https://github.com/acme/alpha-skills.git",
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        skills: [
          {
            name: "alpha",
            description: "Use alpha skills.",
            relativePath: ".agents/skills/alpha",
          },
        ],
        lastSyncedAt: alphaRepo.lastSyncedAt,
        createdAt: alphaRepo.createdAt,
        updatedAt: alphaRepo.updatedAt,
      },
      {
        id: betaRepo.id,
        originUrl: "https://github.com/acme/beta-skills.git",
        commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        skills: [
          {
            name: "beta",
            description: "Use beta skills.",
            relativePath: ".agents/skills/beta",
          },
        ],
        lastSyncedAt: betaRepo.lastSyncedAt,
        createdAt: betaRepo.createdAt,
        updatedAt: betaRepo.updatedAt,
      },
    ]);

    const query = new URLSearchParams({
      originUrl: "https://github.com/acme/beta-skills.git",
    });
    const filteredResponse = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/profiles/sbp_list_skills_source_repos/versions/1/skills-sources?${query.toString()}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(filteredResponse.status).toBe(200);
    const filteredBody = ListSkillsSourceReposResponseSchema.parse(await filteredResponse.json());
    expect(filteredBody.items.map((item) => item.originUrl)).toEqual([
      "https://github.com/acme/beta-skills.git",
    ]);
  });

  it("requires an existing sandbox profile version before listing skills source repos", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-list-skills-source-repos-missing-version@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_list_skills_missing_version",
        organizationId: session.organizationId,
        displayName: "List Skills Source Repos Missing Version",
        createdAt: "2026-06-02T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_list_skills_missing_version/versions/1/skills-sources",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "PROFILE_VERSION_NOT_FOUND",
      message: "Sandbox profile version was not found.",
    });
  });

  it("rejects refresh requests with malformed source origin URLs before starting discovery", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-refresh-skills-source-repos-invalid-origin@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_missing/versions/1/skills-sources/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          originUrl: "not-a-url",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(ValidationErrorResponseSchema.parse(await response.json())).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("rejects refresh requests for source repos outside the profile runtime plan", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-refresh-skills-source-repos-unconfigured-origin@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_refresh_skills_unconfigured_origin",
        organizationId: session.organizationId,
        displayName: "Refresh Skills Source Repo Unconfigured Origin",
        createdAt: "2026-06-02T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_refresh_skills_unconfigured_origin",
        version: 1,
        sandboxProvider: "docker",
        skillsConfig: null,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_skills_unconfigured_origin/versions/1/skills-sources/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          originUrl: "https://github.com/acme/unconfigured-skills.git",
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "PROFILE_VERSION_NOT_USABLE",
      message:
        "Sandbox profile version does not include skills source 'https://github.com/acme/unconfigured-skills.git'.",
    });
  });

  it("upserts discovered skills for an organization and origin URL", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-skills-source-repo-sync@example.com",
    });

    const firstSync = await persistSkillsSourceRepoSyncResult(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        originUrl: "https://github.com/acme/skills.git",
        discoverOutput: {
          commitSha: "1111111111111111111111111111111111111111",
          skills: [
            {
              name: "github-pr-authoring",
              description: "Draft pull requests.",
              relativePath: ".agents/skills/github-pr-authoring",
            },
          ],
        },
      },
    );

    const secondSync = await persistSkillsSourceRepoSyncResult(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        originUrl: "https://github.com/acme/skills.git",
        discoverOutput: {
          commitSha: "2222222222222222222222222222222222222222",
          skills: [
            {
              name: "skills-review",
              description: "Review skill metadata.",
              relativePath: ".agents/skills/skills-review",
            },
          ],
        },
      },
    );

    expect(secondSync.id).toBe(firstSync.id);
    expect(secondSync.commitSha).toBe("2222222222222222222222222222222222222222");
    expect(secondSync.skills).toEqual([
      {
        name: "skills-review",
        description: "Review skill metadata.",
        relativePath: ".agents/skills/skills-review",
      },
    ]);
    expect(secondSync.lastSyncedAt).not.toBeNull();

    const persistedRows = await env.controlPlaneDb.query.skillsSourceRepos.findMany({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.originUrl, "https://github.com/acme/skills.git"),
        ),
    });
    expect(persistedRows).toEqual([
      {
        id: firstSync.id,
      },
    ]);
  });
});
