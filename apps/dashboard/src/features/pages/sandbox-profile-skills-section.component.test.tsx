// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxProfileVersionSkillsSourceReposQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  SandboxProfileVersion,
  SandboxProfileVersionSkillsSourceReposResult,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { SandboxProfileSkillsSection } from "./sandbox-profile-skills-section.js";

afterEach(() => {
  cleanup();
});

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

const GithubBinding = {
  clientId: "binding-github",
  connectionId: GithubConnection.id,
  kind: "git",
  config: {
    repositories: ["mistlehq/skills"],
    tools: [],
  },
} satisfies SandboxProfileBindingEditorRow;

const SkillsOriginUrl = "https://github.com/mistlehq/skills.git";

const SkillsSourceRepos = {
  items: [
    {
      id: "ksr_component_skills",
      originUrl: SkillsOriginUrl,
      commitSha: "abc123",
      lastSyncedAt: "2026-06-07T00:00:00.000Z",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      skills: [
        {
          name: "pr-review",
          description: "Review pull requests.",
          relativePath: ".agents/skills/pr-review",
        },
        {
          name: "release-notes",
          description: "Draft release notes.",
          relativePath: ".agents/skills/release-notes",
        },
      ],
    },
  ],
} satisfies SandboxProfileVersionSkillsSourceReposResult;

describe("SandboxProfileSkillsSection", () => {
  it("shows add public GitHub repo as a separated source repository footer action", () => {
    renderSkillsSection({
      version: createVersion(null),
    });

    const sourceRepositorySelect = screen.getByRole("combobox", { name: "Source repository" });
    expect(sourceRepositorySelect.textContent).toContain("None");

    fireEvent.click(sourceRepositorySelect);

    const addPublicRepoOption = screen.getByRole("option", {
      name: "Add public GitHub repo",
    });
    expect(addPublicRepoOption.previousElementSibling?.getAttribute("data-slot")).toBe(
      "select-separator",
    );

    fireEvent.click(addPublicRepoOption);

    expect(screen.getByRole("dialog", { name: "Add public GitHub repo" })).toBeTruthy();
    expect(sourceRepositorySelect.textContent).toContain("None");
  });

  it("shows only selected skills when the profile is not editable", () => {
    renderSkillsSection({
      isDraft: false,
      readOnly: true,
      skillsSourceRepos: SkillsSourceRepos,
      version: createVersion({
        originUrl: SkillsOriginUrl,
        selectedSkills: [
          {
            name: "pr-review",
            relativePath: ".agents/skills/pr-review",
          },
        ],
      }),
    });

    expect(screen.getByRole("region", { name: "Selected skills" })).toBeTruthy();
    expect(screen.getByText("mistlehq/skills")).toBeTruthy();
    expect(screen.getByText("pr-review")).toBeTruthy();
    expect(screen.queryByText("release-notes")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Source repository" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Search skills" })).toBeNull();
    expect(screen.queryByText("Select all")).toBeNull();
    expect(screen.queryByText("1 selected")).toBeNull();
  });

  it("shows the full discovered skills catalog when the profile is editable", () => {
    renderSkillsSection({
      skillsSourceRepos: SkillsSourceRepos,
      version: createVersion({
        originUrl: SkillsOriginUrl,
        selectedSkills: [
          {
            name: "pr-review",
            relativePath: ".agents/skills/pr-review",
          },
        ],
      }),
    });

    expect(screen.getByRole("region", { name: "Available skills" })).toBeTruthy();
    expect(screen.getByText("pr-review")).toBeTruthy();
    expect(screen.getByText("release-notes")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search skills" })).toBeTruthy();
    expect(screen.getByText("Select all")).toBeTruthy();
  });

  it("keeps the skills list within setup-script-style scroll bounds", () => {
    renderSkillsSection({
      skillsSourceRepos: SkillsSourceRepos,
      version: createVersion({
        originUrl: SkillsOriginUrl,
        selectedSkills: [
          {
            name: "pr-review",
            relativePath: ".agents/skills/pr-review",
          },
        ],
      }),
    });

    const skillsList = screen.getByRole("region", { name: "Available skills" });
    const styles = getComputedStyle(skillsList);

    expect(styles.overflowY).toBe("auto");
    expect(styles.minHeight).toBe("calc(var(--spacing) * 28)");
    expect(styles.maxHeight).toBe("calc((1.5rem * 28) + (var(--spacing) * 4))");
  });

  it("keeps missing selected skills visible when the profile is not editable", () => {
    renderSkillsSection({
      isDraft: false,
      readOnly: true,
      skillsSourceRepos: SkillsSourceRepos,
      version: createVersion({
        originUrl: SkillsOriginUrl,
        selectedSkills: [
          {
            name: "removed-skill",
            relativePath: ".agents/skills/removed-skill",
          },
        ],
      }),
    });

    expect(screen.getByRole("region", { name: "Selected skills" })).toBeTruthy();
    expect(screen.getByText("removed-skill")).toBeTruthy();
    expect(screen.getByText("No longer found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

function renderSkillsSection(input: {
  isDraft?: boolean | undefined;
  readOnly?: boolean | undefined;
  skillsSourceRepos?: SandboxProfileVersionSkillsSourceReposResult | undefined;
  version: SandboxProfileVersion;
}): void {
  const queryClient = createTestQueryClient();
  if (input.skillsSourceRepos !== undefined) {
    queryClient.setQueryData(
      sandboxProfileVersionSkillsSourceReposQueryKey({
        profileId: input.version.sandboxProfileId,
        version: input.version.version,
        originUrl: input.version.skillsConfig?.originUrl ?? null,
      }),
      input.skillsSourceRepos,
    );
  }

  render(
    <QueryClientProvider client={queryClient}>
      <SandboxProfileSkillsSection
        availableConnections={[GithubConnection]}
        availableTargets={[GithubTarget]}
        disabled={false}
        integrationRows={[GithubBinding]}
        integrationRowsHaveUnpersistedChanges={false}
        isDraft={input.isDraft ?? true}
        profileId={input.version.sandboxProfileId}
        readOnly={input.readOnly ?? false}
        version={input.version}
      />
    </QueryClientProvider>,
  );
}

function createVersion(skillsConfig: SandboxProfileVersion["skillsConfig"]): SandboxProfileVersion {
  return {
    sandboxProfileId: "sbp_skills_section_component",
    version: 1,
    state: "draft",
    publishedAt: null,
    agentRuntimeId: "codex",
    gitCommitSigningIntegrationConnectionId: null,
    mistleMcpEnabled: false,
    mistleMcpApiKeyId: null,
    sandboxProvider: "docker",
    sandboxConnectionId: null,
    maintenanceScript: null,
    sandboxResources: null,
    skillsConfig,
    isActive: false,
    usable: false,
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}
