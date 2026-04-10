import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import type { SessionStatusKind } from "../sessions/session-status.js";
import { resolveSessionStatusBadgeUi } from "./session-status-presentation.js";

function SessionStatusBadgePreview(input: {
  statuses: readonly SessionStatusKind[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-6">
      {input.statuses.map((status) => {
        const badgeUi = resolveSessionStatusBadgeUi(status);
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
  title: "Dashboard/Sessions/SessionList/StatusPresentation",
  component: SessionStatusBadgePreview,
  tags: ["autodocs"],
  args: {
    statuses: [
      "loading",
      "starting",
      "connecting",
      "connected",
      "reconnecting",
      "stopped",
      "failed",
    ],
  },
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
} satisfies Meta<typeof SessionStatusBadgePreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SessionStates: Story = {};
