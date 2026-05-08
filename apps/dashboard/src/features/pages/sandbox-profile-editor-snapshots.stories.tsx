import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Snapshots",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: DefaultSandboxProfileEditorStoryArgs,
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const UnavailableNoPublishedVersion: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "draft",
    snapshotState: "draft-unavailable",
  },
};

export const SnapshotUnavailableNoPreviousSnapshot: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-unavailable-no-previous",
  },
};

export const CreatingFirstSnapshot: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "creating-first-snapshot",
  },
};

export const CreatingWithPreviousSnapshot: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "creating-snapshot",
  },
};

export const PublishSuccessfulCreatingSnapshot: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    publishSuccessMessage: true,
    snapshotState: "creating-snapshot",
  },
};

export const Ready: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-ready",
  },
};

export const RefreshScheduleNotConfigured: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "none",
    snapshotState: "snapshot-ready",
  },
};

export const RefreshScheduleExisting: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "existing",
    snapshotState: "snapshot-ready",
  },
};

export const RefreshScheduleInvalidPreview: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "invalid-preview",
    snapshotState: "snapshot-ready",
  },
};

export const RefreshScheduleSaveFailure: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "save-failure",
    snapshotState: "snapshot-ready",
  },
};

export const PublishSnapshotFailed: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed",
  },
};

export const RefreshFailed: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "refresh-failed",
  },
};
