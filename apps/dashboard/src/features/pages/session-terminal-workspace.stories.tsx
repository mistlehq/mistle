import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DockviewApi } from "dockview";
import { useState } from "react";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import {
  createStoryLongCliOutput,
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  renderSessionWorkbenchStory,
  renderSessionWorkbenchStoryWithChrome,
  SessionWorkbenchStoryHeaderActions,
  StoryTerminalSurfaceBody,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionTerminalWorkspaceView } from "./session-terminal-workspace.js";

type TerminalWorkspaceStoryArgs = {
  initialCwd: string | null;
};

function buildInitialTerminalOutput(input: { cwd: string | null }): string {
  const promptCwd = input.cwd ?? "/root";

  return [
    `root@sandbox:${promptCwd}# printf 'terminal ready\\n'`,
    "terminal ready",
    `root@sandbox:${promptCwd}# git status --short`,
    " M apps/dashboard/src/features/pages/session-terminal-workspace.stories.tsx",
    " M apps/dashboard/src/features/pages/session-terminal-workspace.tsx",
    "",
  ].join("\n");
}

function buildLongTerminalOutput(input: { cwd: string | null }): string {
  const promptCwd = input.cwd ?? "/root";

  return [
    `root@sandbox:${promptCwd}# pwd`,
    promptCwd,
    `root@sandbox:${promptCwd}# ${createStoryLongCliOutput("terminal")}`,
    "",
  ].join("\n");
}

function StoryTerminalWorkspace(input: TerminalWorkspaceStoryArgs): React.JSX.Element {
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);

  return renderSessionWorkbenchStoryWithChrome({
    headerActions: (
      <SessionWorkbenchStoryHeaderActions
        isTerminalVisible={isBottomPanelVisible}
        onTerminalToggle={() => {
          setIsBottomPanelVisible((currentValue) => !currentValue);
        }}
      />
    ),
    children: renderSessionWorkbenchStory({
      bottomPanel: (
        <SessionTerminalWorkspaceView
          cwd={input.initialCwd}
          isVisible={isBottomPanelVisible}
          onApiReady={(api) => {
            seedSplitTerminalExample({
              api,
              cwd: input.initialCwd,
            });
          }}
          onWorkspaceEmpty={() => {
            return;
          }}
          renderTerminalPanel={(panelInput) => (
            <StoryTerminalSurfaceBody
              initialOutput={
                panelInput.panelId === "terminal"
                  ? buildLongTerminalOutput({
                      cwd: panelInput.cwd,
                    })
                  : buildInitialTerminalOutput({
                      cwd: panelInput.cwd,
                    })
              }
              isVisible={panelInput.isPanelVisible}
            />
          )}
        />
      ),
      isBottomPanelVisible,
      mainContent: createStorySessionMainContent(),
      primaryBottomPanel: createStorySessionBottomPanel(),
      sandboxInstanceId: StorySandboxInstanceId,
    }),
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
  },
} satisfies Meta<typeof StoryTerminalWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};

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
