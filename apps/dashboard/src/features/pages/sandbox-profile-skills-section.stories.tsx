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
          isDraft
          profileId={version.sandboxProfileId}
          readOnly={false}
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
