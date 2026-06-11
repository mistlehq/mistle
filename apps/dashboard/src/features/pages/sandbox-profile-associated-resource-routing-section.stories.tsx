import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
} from "@mistle/integrations-core";
import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  SandboxProfileAssociatedResourceRoutingFieldGroup,
  type SandboxProfileAssociatedResourceRoutingDraftState,
} from "./sandbox-profile-associated-resource-routing-section.js";

type AssociatedResourceRoutingStoryArgs = {
  disabled: boolean;
  hasGitHubBinding: boolean;
  initialSaveError?: boolean;
  isDraft: boolean;
  version: SandboxProfileVersion;
};

/**
 * Review the pull request activity sub-block exactly as it appears inside the sandbox profile Git
 * connection card. The full editor story shows the surrounding Sandbox Profile context.
 */
const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Pull Request Activity",
  component: SandboxProfileAssociatedResourceRoutingFieldGroup,
  decorators: [withDashboardCenteredStory],
  render: function RenderStory(args): React.JSX.Element {
    return <AssociatedResourceRoutingStory {...args} />;
  },
  args: {
    disabled: false,
    hasGitHubBinding: true,
    isDraft: true,
    version: createStoryVersion({ associatedResourceEventRoutingConfig: {} }),
  },
} satisfies Meta<AssociatedResourceRoutingStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

function AssociatedResourceRoutingStory(
  args: AssociatedResourceRoutingStoryArgs,
): React.JSX.Element {
  const [draftState, setDraftState] =
    useState<SandboxProfileAssociatedResourceRoutingDraftState | null>(null);

  function handleApplySaveError(): void {
    draftState?.applyDraftSaveError?.(new Error("Storybook could not save routing changes."));
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3">
      <SandboxProfileAssociatedResourceRoutingFieldGroup
        disabled={args.disabled}
        hasGitHubBinding={args.hasGitHubBinding}
        isDraft={args.isDraft}
        onDraftStateChange={setDraftState}
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
  );
}

export const GitHubPullRequestRouting: Story = {};

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

    await userEvent.click(canvas.getByRole("switch", { name: "Agent PR activity" }));
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
