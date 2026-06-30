import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
} from "./sandbox-profile-editor-story-support.js";

const LongMaintenanceScript = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "",
  ...Array.from(
    { length: 80 },
    (_unused, index) =>
      `printf 'Refreshing snapshot maintenance step ${String(index + 1).padStart(2, "0")}\\n'`,
  ),
].join("\n");

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Snapshots",
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

export const CreatingWithLifecycleEvents: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "creating-snapshot-with-events",
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

export const RefreshScheduleNewScheduleEditing: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotRefreshScheduleState: "none",
    snapshotState: "snapshot-ready",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Edit" }));
    await userEvent.click(await canvas.findByRole("switch", { name: "Refresh enabled" }));

    await expect(canvas.getByLabelText("Cron expression")).toHaveValue("0 9 * * *");
  },
};

export const RefreshScheduleExistingWithSetupScript: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotMaintenanceScript: "",
    snapshotRefreshScheduleState: "existing",
    snapshotState: "snapshot-ready",
  },
};

export const SnapshotMaintenanceWithRefreshSchedule: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotMaintenanceScript: `#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm db:migrate`,
    snapshotRefreshScheduleState: "existing",
    snapshotState: "snapshot-ready",
  },
};

export const MaintenanceAssistantPanelReady: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    setupAssistantPanelState: "ready",
    snapshotMaintenanceScript: `#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm db:migrate`,
    snapshotRefreshScheduleState: "existing",
    snapshotState: "snapshot-ready",
  },
};

export const LongSnapshotMaintenanceScriptEditor: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotMaintenanceScript: LongMaintenanceScript,
    snapshotRefreshScheduleState: "existing-editing",
    snapshotState: "snapshot-ready",
  },
};

export const LongSnapshotMaintenanceScriptReadOnly: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotMaintenanceScript: LongMaintenanceScript,
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

export const PublishSnapshotFailedInvalidBindingConnectionReference: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-invalid-binding-connection-reference",
  },
};

export const PublishSnapshotFailedInvalidConnectionTargetReference: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-invalid-connection-target-reference",
  },
};

export const PublishSnapshotFailedConnectionMismatch: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-connection-mismatch",
  },
};

export const PublishSnapshotFailedTargetDisabled: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-target-disabled",
  },
};

export const PublishSnapshotFailedConnectionNotActive: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-connection-not-active",
  },
};

export const PublishSnapshotFailedKindMismatch: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-kind-mismatch",
  },
};

export const PublishSnapshotFailedInvalidTargetConfig: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-invalid-target-config",
  },
};

export const PublishSnapshotFailedInvalidTargetSecrets: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-invalid-target-secrets",
  },
};

export const PublishSnapshotFailedInvalidBindingConfig: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-invalid-binding-config",
  },
};

export const PublishSnapshotFailedRouteConflict: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-route-conflict",
  },
};

export const PublishSnapshotFailedArtifactConflict: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-artifact-conflict",
  },
};

export const PublishSnapshotFailedRuntimeClientSetupConflict: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-runtime-client-setup-conflict",
  },
};

export const PublishSnapshotFailedRuntimeClientSetupInvalidRef: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "snapshot-failed-runtime-client-setup-invalid-ref",
  },
};

export const RefreshFailed: Story = {
  args: {
    initialSectionId: "snapshot",
    lifecycleState: "published",
    snapshotState: "refresh-failed",
  },
};
