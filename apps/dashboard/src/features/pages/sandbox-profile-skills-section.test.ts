import { describe, expect, it } from "vitest";

import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  createSkillOptions,
  normalizeSkillsConfig,
  resolveSkillsConfigSaveBlockedMessage,
  resolveSkillsSourceRepositoryOptions,
  skillsConfigsAreEqual,
} from "./sandbox-profile-skills-section.js";

const GithubConnection = {
  id: "connection-github",
  displayName: "GitHub",
  targetKey: "target-github",
  status: "active",
  config: {
    connection_method: "github-app-installation",
  },
} satisfies IntegrationConnectionSummary;

const GithubTarget = {
  targetKey: "target-github",
  displayName: "GitHub",
  familyId: "github",
  variantId: "github-cloud",
  config: {
    api_base_url: "https://api.github.com",
    web_base_url: "https://github.com",
  },
  targetHealth: {
    configStatus: "valid",
  },
} satisfies IntegrationTargetSummary;

describe("sandbox profile skills section model", () => {
  it("derives canonical skills source origin URLs from Git repository bindings", () => {
    const rows: readonly SandboxProfileBindingEditorRow[] = [
      {
        clientId: "binding-github",
        connectionId: GithubConnection.id,
        kind: "git",
        config: {
          repositories: ["mistlehq/skills", "mistlehq/app", "mistlehq/skills"],
        },
      },
    ];

    expect(
      resolveSkillsSourceRepositoryOptions({
        availableConnections: [GithubConnection],
        availableTargets: [GithubTarget],
        integrationRows: rows,
      }),
    ).toEqual([
      {
        label: "mistlehq/app",
        originUrl: "https://github.com/mistlehq/app.git",
      },
      {
        label: "mistlehq/skills",
        originUrl: "https://github.com/mistlehq/skills.git",
      },
    ]);
  });

  it("preserves GitHub Enterprise Server base paths in skills source origin URLs", () => {
    const target = {
      ...GithubTarget,
      config: {
        api_base_url: "https://github.acme.example/api/v3",
        web_base_url: "https://github.acme.example/git",
      },
    } satisfies IntegrationTargetSummary;

    expect(
      resolveSkillsSourceRepositoryOptions({
        availableConnections: [GithubConnection],
        availableTargets: [target],
        integrationRows: [
          {
            clientId: "binding-ghes",
            connectionId: GithubConnection.id,
            kind: "git",
            config: {
              repositories: ["acme/skills"],
            },
          },
        ],
      }),
    ).toEqual([
      {
        label: "acme/skills",
        originUrl: "https://github.acme.example/git/acme/skills.git",
      },
    ]);
  });

  it("keeps selected skills visible when they are no longer discovered", () => {
    expect(
      createSkillOptions({
        skillsSourceRepo: {
          id: "ksr_1",
          originUrl: "https://github.com/mistlehq/skills.git",
          commitSha: "abc123",
          lastSyncedAt: "2026-05-28T00:00:00.000Z",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
          skills: [
            {
              name: "review",
              description: "Review pull requests.",
              relativePath: "review",
            },
          ],
        },
        selectedSkills: [
          {
            name: "triage",
            relativePath: "triage",
          },
        ],
      }),
    ).toEqual([
      {
        name: "review",
        description: "Review pull requests.",
        relativePath: "review",
        available: true,
      },
      {
        name: "triage",
        description: "",
        relativePath: "triage",
        available: false,
      },
    ]);
  });

  it("compares skills configs independent of selected skill order", () => {
    const left = normalizeSkillsConfig({
      originUrl: "https://github.com/mistlehq/skills.git",
      selectedSkills: [
        {
          name: "review",
          relativePath: "review",
        },
        {
          name: "triage",
          relativePath: "triage",
        },
      ],
    });
    const right = normalizeSkillsConfig({
      originUrl: "https://github.com/mistlehq/skills.git",
      selectedSkills: [
        {
          name: "triage",
          relativePath: "triage",
        },
        {
          name: "review",
          relativePath: "review",
        },
      ],
    });

    expect(skillsConfigsAreEqual(left, right)).toBe(true);
  });

  it("blocks saving when the selected skills source is no longer available", () => {
    expect(
      resolveSkillsConfigSaveBlockedMessage({
        skillsConfig: {
          originUrl: "https://github.com/mistlehq/skills.git",
          selectedSkills: [],
        },
        sourceOptions: [
          {
            originUrl: "https://github.com/mistlehq/app.git",
          },
        ],
      }),
    ).toBe("Choose an available skills source, or clear the skills source before saving.");
  });
});
