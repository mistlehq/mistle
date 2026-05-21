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

export const ManagedE2BRuntime: Story = {
  args: {
    runtimeState: "e2b-managed",
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
    draftSaveErrorMessage: "Saving draft failed. Please try again later.",
  },
};
