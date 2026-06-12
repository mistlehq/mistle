import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Overview",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: DefaultSandboxProfileEditorStoryArgs,
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SavedDraftWithoutPublishWorthyChanges: Story = {
  args: {
    lifecycleState: "draft-with-published",
    publishBlockedMessage: "Make a change to the sandbox profile draft before publishing.",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    const publishButton = canvas.getByRole("button", { name: "Publish" });
    const publishButtonTooltipTrigger = publishButton.parentElement;

    if (publishButtonTooltipTrigger === null) {
      throw new Error("Publish button tooltip trigger was not rendered.");
    }

    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await expect(canvas.queryByRole("button", { name: "Save draft" })).toBeNull();
    await expect(publishButton).toBeDisabled();
    await userEvent.hover(publishButtonTooltipTrigger);
    await expect(
      await body.findByText("Make a change to the sandbox profile draft before publishing."),
    ).toBeVisible();
  },
};

export const Published: Story = {
  args: {
    lifecycleState: "published",
  },
};

export const DuplicateProfileWithoutTriggers: Story = {
  args: {
    duplicateProfileDialogState: "open",
    duplicateProfileTriggerState: "none",
    lifecycleState: "published",
    snapshotState: "snapshot-ready",
  },
};

export const DuplicateProfileWithTriggers: Story = {
  args: {
    duplicateProfileDialogState: "open",
    duplicateProfileTriggerState: "with-triggers",
    lifecycleState: "published",
    snapshotState: "snapshot-ready",
  },
};

export const DuplicateProfileCheckingTriggers: Story = {
  args: {
    duplicateProfileDialogState: "closed",
    duplicateProfileTriggerState: "loading",
    lifecycleState: "published",
    snapshotState: "snapshot-ready",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));

    await expect(body.getByText("Checking triggers...")).toBeVisible();
  },
};

export const DuplicateProfileUnavailable: Story = {
  args: {
    duplicateProfileAvailability: "unavailable",
    lifecycleState: "published",
    snapshotState: "snapshot-unavailable-no-previous",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));

    await expect(
      body.getByText("Requires the active published version to have a usable snapshot."),
    ).toBeVisible();
  },
};

export const DuplicateProfileError: Story = {
  args: {
    duplicateProfileDialogState: "error",
    duplicateProfileTriggerState: "with-triggers",
    lifecycleState: "published",
    snapshotState: "snapshot-ready",
  },
};

export const DuplicateProfileTriggerCheckError: Story = {
  args: {
    duplicateProfileDialogState: "closed",
    duplicateProfileTriggerState: "error",
    lifecycleState: "published",
    snapshotState: "snapshot-ready",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));
    await userEvent.click(body.getByRole("menuitem", { name: "Duplicate" }));

    await expect(body.getByRole("heading", { name: "Duplicate sandbox profile" })).toBeVisible();
    await expect(
      body.getByText(
        "Could not check triggers for this profile. Duplicate will continue without triggers.",
      ),
    ).toBeVisible();
  },
};

export const PublishedOrganizationE2BRuntime: Story = {
  args: {
    lifecycleState: "published",
    runtimeState: "e2b-connection",
  },
};

export const PublishedMistleProvider: Story = {
  args: {
    lifecycleState: "published",
    runtimeState: "mistle-provider",
  },
};

export const MistleProvider: Story = {
  args: {
    runtimeState: "mistle-provider",
  },
};

export const OrganizationE2BRuntime: Story = {
  args: {
    runtimeState: "e2b-connection",
  },
};

export const OrganizationE2BMissingConnection: Story = {
  args: {
    runtimeState: "e2b-missing-connection",
  },
};

export const EmptyTriggersTab: Story = {
  args: {
    initialSectionId: "triggers",
  },
};

export const DraftSaveFailure: Story = {
  args: {
    setupScriptDraft: `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap
pnpm lint`,
    draftSaveErrorMessage:
      "Saving draft failed. Fix the highlighted profile settings below and try again.",
  },
};

export const DraftSaveMissingAgentRuntimeConnection: Story = {
  args: {
    agentRuntimeConnectionErrorMessage: "Select an agent runtime connection.",
    draftSaveErrorMessage:
      "Saving draft failed. Fix the highlighted profile settings below and try again.",
    initialBindings: [],
  },
};
