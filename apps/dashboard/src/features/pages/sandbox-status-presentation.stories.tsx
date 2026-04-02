import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  resolveSandboxStatusBadgeUi,
  type WorkbenchSandboxLifecycleStatus,
} from "./sandbox-status-presentation.js";

function SandboxStatusBadgePreview(input: {
  statuses: readonly WorkbenchSandboxLifecycleStatus[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-6">
      {input.statuses.map((status) => {
        const badgeUi = resolveSandboxStatusBadgeUi(status);
        const statusLabel = status ?? "null";

        return (
          <div
            className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3"
            key={statusLabel}
          >
            <code className="text-muted-foreground text-sm">{statusLabel}</code>
            <Badge className={badgeUi.className} variant={badgeUi.variant}>
              {badgeUi.label}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

const meta = {
  title: "Dashboard/Pages/SandboxStatusPresentation",
  component: SandboxStatusBadgePreview,
  tags: ["autodocs"],
  args: {
    statuses: ["pending", "starting", "running", "stopped", "failed", "resuming", null],
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof SandboxStatusBadgePreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllStates: Story = {};

export const SessionListStates: Story = {
  args: {
    statuses: ["pending", "starting", "running", "stopped", "failed"],
  },
};

export const WorkbenchOnlyStates: Story = {
  args: {
    statuses: ["resuming", null],
  },
};
