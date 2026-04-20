import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DockviewApi } from "dockview";
import { useState } from "react";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  createStoryPtyChunks,
  renderSessionWorkbenchContentStory,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionTerminalDockviewWorkspaceView } from "./session-terminal-dockview-workspace.js";
import { SessionTerminalSurface } from "./session-terminal-surface.js";

type TerminalWorkspaceStoryArgs = {
  initialCwd: string | null;
  withSplitExample?: boolean;
};

function buildInitialTerminalOutput(input: { cwd: string | null; panelId: string }): string {
  const promptCwd = input.cwd ?? "/root";

  return [
    `root@sandbox:${promptCwd}# printf 'terminal ready\\n'`,
    "terminal ready",
    `root@sandbox:${promptCwd}# git status --short`,
    " M apps/dashboard/src/features/pages/session-terminal-workspace.stories.tsx",
    " M apps/dashboard/src/features/pages/session-terminal-dockview-workspace.tsx",
    "",
  ].join("\n");
}

function StoryDockviewTerminalBody(input: {
  cwd: string | null;
  isPanelVisible: boolean;
  panelId: string;
}): React.JSX.Element {
  const [outputText, setOutputText] = useState(() => buildInitialTerminalOutput(input));

  return (
    <SessionTerminalSurface
      isVisible={input.isPanelVisible}
      lifecycleState={SandboxPtyStates.OPEN}
      onResize={async () => {
        return;
      }}
      onWriteInput={async (nextInput) => {
        setOutputText((currentOutput) => `${currentOutput}${nextInput}`);
      }}
      outputChunks={createStoryPtyChunks(outputText)}
    />
  );
}

function StoryTerminalWorkspace(input: TerminalWorkspaceStoryArgs): React.JSX.Element {
  const [panelSize, setPanelSize] = useState(38);

  return renderSessionWorkbenchContentStory({
    bottomPanel: (
      <SessionTerminalDockviewWorkspaceView
        cwd={input.initialCwd}
        isVisible={true}
        onApiReady={(api) => {
          if (!input.withSplitExample) {
            return;
          }

          seedSplitTerminalExample({
            api,
            cwd: input.initialCwd,
          });
        }}
        onWorkspaceEmpty={() => {
          return;
        }}
        renderTerminalPanel={(panelInput) => <StoryDockviewTerminalBody {...panelInput} />}
      />
    ),
    bottomPanelSize: panelSize,
    isBottomPanelVisible: true,
    mainContent: createStorySessionMainContent(),
    onBottomPanelResize: setPanelSize,
    primaryBottomPanel: createStorySessionBottomPanel(),
    sandboxInstanceId: StorySandboxInstanceId,
  });
}

/**
 * Use this story to exercise the Dockview-backed terminal workspace directly.
 * The tab strip, new-tab action, and close behavior are the real workspace shell,
 * while the panel body is a local Storybook terminal so you can review layout
 * and interaction without a live sandbox transport.
 */
const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/TerminalWorkspace",
  component: StoryTerminalWorkspace,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
  args: {
    initialCwd: "/workspace/apps/dashboard",
    withSplitExample: false,
  },
} satisfies Meta<typeof StoryTerminalWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};

export const SplitView: Story = {
  args: {
    withSplitExample: true,
  },
};

function seedSplitTerminalExample(input: { api: DockviewApi; cwd: string | null }): void {
  if (input.api.totalPanels !== 1 || input.api.activeGroup === undefined) {
    return;
  }

  const middleGroup = input.api.activeGroup;
  input.api.addPanel({
    component: "terminal",
    id: "terminal-2",
    params: {
      cwd: input.cwd,
    },
    position: {
      direction: "right",
      referenceGroup: middleGroup,
    },
    renderer: "always",
    title: "Terminal 2",
  });

  const rightGroup = input.api.activeGroup;
  if (rightGroup === undefined) {
    return;
  }

  input.api.addPanel({
    component: "terminal",
    id: "terminal-3",
    params: {
      cwd: input.cwd,
    },
    position: {
      direction: "right",
      referenceGroup: rightGroup,
    },
    renderer: "always",
    title: "Terminal 3",
  });
}
