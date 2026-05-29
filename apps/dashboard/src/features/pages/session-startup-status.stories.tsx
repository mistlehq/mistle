import { systemScheduler } from "@mistle/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import { SessionStartupStatus, type SessionStartupState } from "./session-startup-status.js";
import {
  createStorySessionBottomPanel,
  renderSessionWorkbenchContentStory,
} from "./session-story-support.js";

const StartupStates: readonly SessionStartupState[] = [
  "loading_status",
  "preparing_sandbox",
  "running_setup",
  "connecting_chat",
] as const;
const StartupStateStepMs = 1_800;

function SessionStartupStatusStory(): React.JSX.Element {
  const [startupStateIndex, setStartupStateIndex] = useState(0);
  const startupState = StartupStates.at(startupStateIndex) ?? "loading_status";

  useEffect(() => {
    if (startupStateIndex >= StartupStates.length - 1) {
      return;
    }

    const handle = systemScheduler.schedule(() => {
      setStartupStateIndex((currentIndex) =>
        currentIndex >= StartupStates.length - 1 ? currentIndex : currentIndex + 1,
      );
    }, StartupStateStepMs);

    return () => {
      systemScheduler.cancel(handle);
    };
  }, [startupStateIndex]);

  return renderSessionWorkbenchContentStory({
    headerStatusUi: {
      label: "Not connected",
      variant: "outline",
      indicatorClassName: "border-amber-600 bg-amber-500",
    },
    mainContent: (
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center px-4 py-6">
        <div className="flex min-h-0 flex-col items-center justify-center">
          <SessionStartupStatus state={startupState} />
        </div>
      </div>
    ),
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: createStorySessionBottomPanel(),
    sandboxInstanceId: "sbi_storybook_bootstrap",
  });
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/StartupStatus",
  component: SessionStartupStatusStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
} satisfies Meta<typeof SessionStartupStatusStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
