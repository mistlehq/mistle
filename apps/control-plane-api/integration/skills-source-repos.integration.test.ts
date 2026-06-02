/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { persistSkillsSourceRepoSyncResult } from "../src/skills-source-repos/services/sync-skills-source-repo.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("skills source repos integration", () => {
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
