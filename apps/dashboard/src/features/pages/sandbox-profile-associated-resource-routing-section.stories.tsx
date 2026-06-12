import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
} from "@mistle/integrations-core";
import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ComponentProps, useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryGithubConnection,
  StoryGithubResources,
  StoryGithubTarget,
  StorySlackTarget,
} from "./integrations-editor-section-story-support.js";
import {
  SandboxProfileAssociatedResourceRoutingFieldGroup,
  type SandboxProfileAssociatedResourceRoutingDraftState,
} from "./sandbox-profile-associated-resource-routing-section.js";

type AssociatedResourceRoutingStoryArgs = {
  disabled: boolean;
  hasGitHubBinding: boolean;
  hasSlackThreadBinding: boolean;
  initialSaveError?: boolean;
  isDraft: boolean;
  selectedConnectionId?: string | undefined;
  supportedAssociatedResourceEvents?: ComponentProps<
    typeof SandboxProfileAssociatedResourceRoutingFieldGroup
  >["supportedAssociatedResourceEvents"];
  version: SandboxProfileVersion;
};

/**
 * Review the associated resource routing sub-block exactly as it appears inside the sandbox
 * profile integration card. The full editor story shows the surrounding Sandbox Profile context.
 */
const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Associated Resource Routing",
  component: SandboxProfileAssociatedResourceRoutingFieldGroup,
  decorators: [withDashboardCenteredStory],
  render: function RenderStory(args): React.JSX.Element {
    return <AssociatedResourceRoutingStory {...args} />;
  },
  args: {
    disabled: false,
    hasGitHubBinding: true,
    hasSlackThreadBinding: false,
    isDraft: true,
    selectedConnectionId: StoryGithubConnection.id,
    supportedAssociatedResourceEvents: StoryGithubTarget.supportedAssociatedResourceEvents,
    version: createStoryVersion({ associatedResourceEventRoutingConfig: {} }),
  },
} satisfies Meta<AssociatedResourceRoutingStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

function AssociatedResourceRoutingStory(
  args: AssociatedResourceRoutingStoryArgs,
): React.JSX.Element {
  const [queryClient] = useState(() => {
    const nextQueryClient = createIntegrationsEditorSectionStoryQueryClient();
    seedStoryIntegrationResources({
      queryClient: nextQueryClient,
      resources: StoryGithubResources,
    });
    return nextQueryClient;
  });
  const [draftState, setDraftState] =
    useState<SandboxProfileAssociatedResourceRoutingDraftState | null>(null);

  function handleApplySaveError(): void {
    draftState?.applyDraftSaveError?.(new Error("Storybook could not save routing changes."));
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex w-full max-w-3xl flex-col gap-3">
        <SandboxProfileAssociatedResourceRoutingFieldGroup
          disabled={args.disabled}
          hasGitHubBinding={args.hasGitHubBinding}
          hasSlackThreadBinding={args.hasSlackThreadBinding}
          isDraft={args.isDraft}
          onDraftStateChange={setDraftState}
          selectedConnectionId={args.selectedConnectionId}
          supportedAssociatedResourceEvents={args.supportedAssociatedResourceEvents}
          version={args.version}
        />
        {args.initialSaveError === true ? (
          <div>
            <Button
              disabled={draftState?.applyDraftSaveError === undefined}
              onClick={handleApplySaveError}
              type="button"
              variant="outline"
            >
              Apply save error
            </Button>
          </div>
        ) : null}
      </div>
    </QueryClientProvider>
  );
}

export const GitHubPullRequestRouting: Story = {};

export const SlackThreadRouting: Story = {
  args: {
    hasGitHubBinding: false,
    hasSlackThreadBinding: true,
    supportedAssociatedResourceEvents: StorySlackTarget.supportedAssociatedResourceEvents,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("button", { name: "Configure Agent-started Slack threads" }),
    );
    await expect(canvas.getByRole("textbox", { name: "invocation token" })).toBeVisible();
  },
};

export const GitHubAndSlackRouting: Story = {
  args: {
    hasGitHubBinding: true,
    hasSlackThreadBinding: true,
    supportedAssociatedResourceEvents: createMixedSupportedAssociatedResourceEvents(),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole("switch", { name: "Agent PR activity" })).toBeNull();
    await expect(canvas.queryByRole("switch", { name: "Agent-started Slack threads" })).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Configure Agent-started Slack threads" }),
    );
    await expect(canvas.getByRole("checkbox", { name: "Thread replies" })).toBeChecked();
  },
};

export const NarrowedPullRequestEvents: Story = {
  args: {
    version: createStoryVersion({
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [
              AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
              AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
            ],
          },
        ],
      },
    }),
  },
};

export const SavedSlackThreadRouting: Story = {
  args: {
    hasGitHubBinding: false,
    hasSlackThreadBinding: true,
    supportedAssociatedResourceEvents: StorySlackTarget.supportedAssociatedResourceEvents,
    version: createStoryVersion({
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
            eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
          },
        ],
      },
    }),
  },
};

export const MixedSavedRouting: Story = {
  args: {
    hasGitHubBinding: true,
    hasSlackThreadBinding: true,
    supportedAssociatedResourceEvents: createMixedSupportedAssociatedResourceEvents(),
    version: createStoryVersion({
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
            payloadFilter: {
              [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED]: {
                op: "contains_token",
                path: ["comment", "body"],
                value: "@mistle",
              },
            },
          },
          {
            resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
            eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
          },
        ],
      },
    }),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole("switch", { name: "Agent PR activity" })).toBeNull();
    await expect(canvas.queryByRole("switch", { name: "Agent-started Slack threads" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Configure Agent PR activity" }));
    await expect(canvas.getByDisplayValue("@mistle")).toBeVisible();
  },
};

export const FilteredPullRequestComments: Story = {
  args: {
    version: createStoryVersion({
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
            payloadFilter: {
              [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED]: {
                op: "and",
                filters: [
                  {
                    op: "contains_token",
                    path: ["comment", "body"],
                    value: "@mistle",
                  },
                  {
                    op: "eq",
                    path: ["repository", "full_name"],
                    value: "mistlehq/platform",
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Configure Agent PR activity" }));
    await expect(canvas.getByRole("checkbox", { name: "PR comments" })).toBeVisible();
  },
};

export const PublishedReadOnlyEnabled: Story = {
  args: {
    disabled: true,
    isDraft: false,
    version: createStoryVersion({
      state: "published",
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [
              AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
              AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
              AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
            ],
          },
        ],
      },
    }),
  },
};

export const PublishedReadOnlyMixedRouting: Story = {
  args: {
    disabled: true,
    hasGitHubBinding: true,
    hasSlackThreadBinding: true,
    isDraft: false,
    version: createStoryVersion({
      state: "published",
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [
              AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
              AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
            ],
          },
          {
            resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
            eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
          },
        ],
      },
    }),
  },
};

export const PublishedReadOnlyDisabled: Story = {
  args: {
    disabled: true,
    isDraft: false,
    version: createStoryVersion({
      state: "published",
      associatedResourceEventRoutingConfig: {
        enabled: false,
        resources: [],
      },
    }),
  },
};

export const SaveErrorAfterDraftChange: Story = {
  args: {
    initialSaveError: true,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Configure Agent PR activity" }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Review comments" }));
    await userEvent.click(canvas.getByRole("button", { name: "Apply save error" }));

    await expect(canvas.getByText("Storybook could not save routing changes.")).toBeVisible();
  },
};

function createStoryVersion(input?: {
  associatedResourceEventRoutingConfig?: SandboxProfileVersion["associatedResourceEventRoutingConfig"];
  state?: SandboxProfileVersion["state"];
}): SandboxProfileVersion {
  const state = input?.state ?? "draft";

  return {
    sandboxProfileId: "sbp_story_associated_resources",
    version: 2,
    state,
    publishedAt: state === "draft" ? null : "2026-06-11T10:00:00.000Z",
    agentRuntimeId: "codex",
    gitCommitSigningIntegrationConnectionId: null,
    mistleMcpEnabled: false,
    mistleMcpApiKeyId: null,
    sandboxProvider: "docker",
    sandboxConnectionId: null,
    maintenanceScript: null,
    sandboxResources: null,
    skillsConfig: null,
    associatedResourceEventRoutingConfig: input?.associatedResourceEventRoutingConfig ?? {},
    isActive: state !== "draft",
    usable: state !== "draft",
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}

function createMixedSupportedAssociatedResourceEvents(): ComponentProps<
  typeof SandboxProfileAssociatedResourceRoutingFieldGroup
>["supportedAssociatedResourceEvents"] {
  return [
    ...(StoryGithubTarget.supportedAssociatedResourceEvents ?? []),
    ...(StorySlackTarget.supportedAssociatedResourceEvents ?? []),
  ];
}
