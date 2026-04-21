import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import { SessionBootstrapTranscriptPanel } from "./session-bootstrap-transcript-panel.js";
import {
  createStorySessionBottomPanel,
  renderSessionWorkbenchContentStory,
} from "./session-story-support.js";

const LongerInstallTranscriptLines = [
  "++ copy_optional_local_bootstrap_file .env.test",
  "++ relative_path=.env.test",
  "++ source_path=/Users/jonathanlow/mistle-projects/mistle/.env.test",
  "++ target_path=/Users/jonathanlow/.codex/worktrees/9a2b/mistle/.env.test",
  "++ '[' -e /Users/jonathanlow/.codex/worktrees/9a2b/mistle/.env.test ']'",
  "+++ dirname /Users/jonathanlow/.codex/worktrees/9a2b/mistle/.env.test",
  "++ mkdir -p /Users/jonathanlow/.codex/worktrees/9a2b/mistle",
  "++ cp -p /Users/jonathanlow/mistle-projects/mistle/.env.test /Users/jonathanlow/.codex/worktrees/9a2b/mistle/.env.test",
  "++ copy_optional_local_bootstrap_file integration-targets.provision.json",
  "++ relative_path=integration-targets.provision.json",
  "++ source_path=/Users/jonathanlow/mistle-projects/mistle/integration-targets.provision.json",
  "++ target_path=/Users/jonathanlow/.codex/worktrees/9a2b/mistle/integration-targets.provision.json",
  "+++ dirname /Users/jonathanlow/.codex/worktrees/9a2b/mistle/integration-targets.provision.json",
  "++ mkdir -p /Users/jonathanlow/.codex/worktrees/9a2b/mistle",
  "++ cp -p /Users/jonathanlow/mistle-projects/mistle/integration-targets.provision.json /Users/jonathanlow/.codex/worktrees/9a2b/mistle/integration-targets.provision.json",
  "++ cd /Users/jonathanlow/.codex/worktrees/9a2b/mistle",
  "++ direnv exec /Users/jonathanlow/.codex/worktrees/9a2b/mistle pnpm install",
  "direnv: loading ~/.codex/worktrees/9a2b/mistle/.envrc",
  "direnv: using flake",
  "Scope: all 36 workspace projects",
  "Lockfile is up to date, resolution step is skipped",
  "Progress: resolved 1, reused 0, downloaded 0, added 0",
  "Packages: +2147",
  "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++",
  "Progress: resolved 214, reused 2114, downloaded 0, added 59",
  "Progress: resolved 2147, reused 2114, downloaded 0, added 426",
  "Progress: resolved 2147, reused 2114, downloaded 0, added 647",
  "Progress: resolved 2147, reused 2114, downloaded 0, added 911",
  "Progress: resolved 2147, reused 2114, downloaded 0, added 1228",
  "Progress: resolved 2147, reused 2114, downloaded 0, added 1584",
  "Progress: resolved 2147, reused 2114, downloaded 0, added 1917",
  "Progress: resolved 2147, reused 2114, downloaded 0, added 2147",
] as const;

type SessionBootstrapTranscriptPanelStoryArgs = React.ComponentProps<
  typeof SessionBootstrapTranscriptPanel
>;

function SessionBootstrapTranscriptPanelStory(
  args: SessionBootstrapTranscriptPanelStoryArgs,
): React.JSX.Element {
  return renderSessionWorkbenchContentStory({
    headerStatusUi: {
      label: "Not connected",
      variant: "outline",
    },
    mainContent: (
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 py-6">
        <SessionBootstrapTranscriptPanel {...args} />
      </div>
    ),
    primaryBottomPanel: createStorySessionBottomPanel(),
    sandboxInstanceId: "sbi_storybook_bootstrap",
  });
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/BootstrapTranscriptPanel",
  component: SessionBootstrapTranscriptPanelStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
  args: {
    animateTail: false,
    animationStepMs: 90,
    lines: LongerInstallTranscriptLines,
    simulateStreaming: true,
    streamingStepMs: 180,
    visibleLineCount: 16,
  },
} satisfies Meta<typeof SessionBootstrapTranscriptPanelStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
