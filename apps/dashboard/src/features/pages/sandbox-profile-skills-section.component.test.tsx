// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
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
});

function renderSkillsSection(input: { version: SandboxProfileVersion }): void {
  const queryClient = createTestQueryClient();

  render(
    <QueryClientProvider client={queryClient}>
      <SandboxProfileSkillsSection
        availableConnections={[GithubConnection]}
        availableTargets={[GithubTarget]}
        disabled={false}
        integrationRows={[GithubBinding]}
        integrationRowsHaveUnpersistedChanges={false}
        isDraft={true}
        profileId={input.version.sandboxProfileId}
        readOnly={false}
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
