import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ComponentProps } from "react";

import { sandboxProfileVersionSkillsSourceReposQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  SandboxProfileVersion,
  SandboxProfileVersionSkillsSourceReposResult,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  StoryGithubConnection,
  StoryIntegrationTargets,
} from "./sandbox-profile-editor-story-support.js";
import { SandboxProfileSkillsSection } from "./sandbox-profile-skills-section.js";

const SkillsOriginUrl = "https://github.com/mistle/main-dashboard.git";
const PublicSkillsOriginUrl = "https://github.com/mistle/public-skills.git";

/**
 * Use these stories to review sandbox profile skills selection in isolation. The long-list stories
 * are intended to verify that the skills rows scroll inside the section while source controls,
 * notices, search, and selection counts remain outside the scroll area.
 */
const meta = {
  title: "Pages/Sandbox Profile/Skills Section",
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const Configured: Story = {
  render: () => (
    <SkillsSectionStoryHarness
      skillsConfig={{
        originUrl: SkillsOriginUrl,
        selectedSkills: [
          {
            name: "pr-review",
            relativePath: ".agents/skills/pr-review",
          },
        ],
      }}
      skillsSourceRepos={{
        items: [
          {
            id: "ksr_story_skills",
            originUrl: SkillsOriginUrl,
            commitSha: "8f7c7a1",
            lastSyncedAt: "2026-05-28T14:05:00.000Z",
            createdAt: "2026-05-28T14:05:00.000Z",
            updatedAt: "2026-05-28T14:05:00.000Z",
            skills: [
              {
                name: "pr-review",
                description: "Review pull requests and request a follow-up review.",
                relativePath: ".agents/skills/pr-review",
              },
              {
                name: "release-notes",
                description: "Draft release notes from merged changes.",
                relativePath: ".agents/skills/release-notes",
              },
            ],
          },
        ],
      }}
    />
  ),
};

export const EditableLongCatalog: Story = {
  name: "Editable Long Catalog",
  render: () => {
    const skillsSourceRepos = createLongSkillsSourceRepos({
      originUrl: SkillsOriginUrl,
      selectedCount: 4,
      totalCount: 36,
    });
    const skillsSourceRepo = getStorySkillsSourceRepo(skillsSourceRepos);

    return (
      <SkillsSectionStoryHarness
        skillsConfig={{
          originUrl: SkillsOriginUrl,
          selectedSkills: skillsSourceRepo.skills.slice(0, 4).map((skill) => ({
            name: skill.name,
            relativePath: skill.relativePath,
          })),
        }}
        skillsSourceRepos={skillsSourceRepos}
      />
    );
  },
};

export const ReadOnlySelectedLongList: Story = {
  name: "Read-only Selected Long List",
  render: () => {
    const skillsSourceRepos = createLongSkillsSourceRepos({
      originUrl: SkillsOriginUrl,
      selectedCount: 24,
      totalCount: 36,
    });
    const skillsSourceRepo = getStorySkillsSourceRepo(skillsSourceRepos);

    return (
      <SkillsSectionStoryHarness
        isDraft={false}
        readOnly
        skillsConfig={{
          originUrl: SkillsOriginUrl,
          selectedSkills: skillsSourceRepo.skills.slice(0, 24).map((skill) => ({
            name: skill.name,
            relativePath: skill.relativePath,
          })),
        }}
        skillsSourceRepos={skillsSourceRepos}
      />
    );
  },
};

export const Unsynced: Story = {
  render: () => (
    <SkillsSectionStoryHarness
      skillsConfig={{
        originUrl: SkillsOriginUrl,
        selectedSkills: [],
      }}
      skillsSourceRepos={{ items: [] }}
    />
  ),
};

export const PublicGitHubSource: Story = {
  name: "Public GitHub Source",
  render: () => (
    <SkillsSectionStoryHarness
      initialBindings={[]}
      skillsConfig={{
        originUrl: PublicSkillsOriginUrl,
        selectedSkills: [
          {
            name: "public-pr-review",
            relativePath: ".agents/skills/public-pr-review",
          },
        ],
      }}
      skillsSourceRepos={{
        items: [
          {
            id: "ksr_story_public_skills",
            originUrl: PublicSkillsOriginUrl,
            commitSha: "6c1f2d9",
            lastSyncedAt: "2026-06-05T10:05:00.000Z",
            createdAt: "2026-06-05T10:05:00.000Z",
            updatedAt: "2026-06-05T10:05:00.000Z",
            skills: [
              {
                name: "public-pr-review",
                description: "Review pull requests using a public skills source.",
                relativePath: ".agents/skills/public-pr-review",
              },
              {
                name: "issue-triage",
                description: "Group incoming issues and identify the next owner.",
                relativePath: ".agents/skills/issue-triage",
              },
            ],
          },
        ],
      }}
    />
  ),
};

export const UnsavedIntegrationChanges: Story = {
  render: () => (
    <SkillsSectionStoryHarness
      integrationRowsHaveUnpersistedChanges
      skillsConfig={{
        originUrl: SkillsOriginUrl,
        selectedSkills: [],
      }}
      skillsSourceRepos={{ items: [] }}
    />
  ),
};

export const NoRepositoryBinding: Story = {
  render: () => (
    <SkillsSectionStoryHarness
      initialBindings={[]}
      skillsConfig={null}
      skillsSourceRepos={{ items: [] }}
    />
  ),
};

function SkillsSectionStoryHarness(input: {
  initialBindings?: ComponentProps<typeof SandboxProfileSkillsSection>["integrationRows"];
  integrationRowsHaveUnpersistedChanges?: boolean;
  isDraft?: boolean;
  readOnly?: boolean;
  skillsConfig: SandboxProfileVersion["skillsConfig"];
  skillsSourceRepos: SandboxProfileVersionSkillsSourceReposResult;
}): React.JSX.Element {
  const version = createStoryVersion(input.skillsConfig);
  const queryClient = useMemo(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    client.setQueryData(
      sandboxProfileVersionSkillsSourceReposQueryKey({
        profileId: version.sandboxProfileId,
        version: version.version,
        originUrl: input.skillsConfig?.originUrl ?? null,
      }),
      input.skillsSourceRepos,
    );
    return client;
  }, [
    input.skillsConfig?.originUrl,
    input.skillsSourceRepos,
    version.sandboxProfileId,
    version.version,
  ]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="max-w-3xl p-6">
        <SandboxProfileSkillsSection
          availableConnections={[StoryGithubConnection]}
          availableTargets={StoryIntegrationTargets}
          disabled={false}
          integrationRows={
            input.initialBindings ?? [
              {
                clientId: "binding-github",
                connectionId: StoryGithubConnection.id,
                kind: "git",
                config: {
                  repositories: ["mistle/main-dashboard", "mistle/control-plane-api"],
                  tools: [],
                },
              },
            ]
          }
          integrationRowsHaveUnpersistedChanges={
            input.integrationRowsHaveUnpersistedChanges ?? false
          }
          isDraft={input.isDraft ?? true}
          profileId={version.sandboxProfileId}
          readOnly={input.readOnly ?? false}
          version={version}
        />
      </div>
    </QueryClientProvider>
  );
}

function createStoryVersion(
  skillsConfig: SandboxProfileVersion["skillsConfig"],
): SandboxProfileVersion {
  return {
    sandboxProfileId: "sbp_story_skills",
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
    refreshSchedule: null,
    latestSnapshotJob: null,
  };
}

function getStorySkillsSourceRepo(
  result: SandboxProfileVersionSkillsSourceReposResult,
): SandboxProfileVersionSkillsSourceReposResult["items"][number] {
  const skillsSourceRepo = result.items[0];
  if (skillsSourceRepo === undefined) {
    throw new Error("Long skills story fixture must include a skills source repo.");
  }

  return skillsSourceRepo;
}

function createLongSkillsSourceRepos(input: {
  originUrl: string;
  selectedCount: number;
  totalCount: number;
}): SandboxProfileVersionSkillsSourceReposResult {
  const names = [
    "pr-review",
    "release-notes",
    "incident-triage",
    "docs-update",
    "dependency-audit",
    "migration-plan",
    "qa-checklist",
    "customer-escalation",
    "security-review",
    "billing-reconciliation",
    "runbook-refresh",
    "schema-change-plan",
  ];

  return {
    items: [
      {
        id: "ksr_story_long_skills",
        originUrl: input.originUrl,
        commitSha: "8f7c7a1",
        lastSyncedAt: "2026-06-07T10:05:00.000Z",
        createdAt: "2026-06-07T10:05:00.000Z",
        updatedAt: "2026-06-07T10:05:00.000Z",
        skills: Array.from({ length: input.totalCount }, (_, index) => {
          const baseName = names[index % names.length] ?? "workflow";
          const ordinal = String(index + 1).padStart(2, "0");
          const selectedHint =
            index < input.selectedCount ? " This skill is selected in the story fixture." : "";

          return {
            name: `${baseName}-${ordinal}`,
            description: `Use this workflow skill to coordinate a focused sandbox task, keep the agent anchored to the right repository context, and produce a compact handoff for reviewers.${selectedHint}`,
            relativePath: `.agents/skills/${baseName}-${ordinal}`,
          };
        }),
      },
    ],
  };
}
