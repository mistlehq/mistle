import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardWorkspaceStory } from "../../../storybook/decorators.js";
import { createCodexThreadNavigatorStoryProps } from "./codex-thread-navigator-story-support.js";
import { CodexThreadNavigator, CodexThreadNavigatorSheet } from "./codex-thread-navigator.js";

function NavigatorRailStory(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigator {...createCodexThreadNavigatorStoryProps()} />
    </div>
  );
}

function EmptyThreadListStory(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigator {...createCodexThreadNavigatorStoryProps({ rows: [] })} />
    </div>
  );
}

function LimitedToLatest20Story(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigator
        {...createCodexThreadNavigatorStoryProps({ isThreadListLimited: true })}
      />
    </div>
  );
}

function MobileSheetStory(): React.JSX.Element {
  const [isOpen, setOpen] = useState(true);

  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigatorSheet
        isOpen={isOpen}
        navigator={createCodexThreadNavigatorStoryProps()}
        onOpenChange={setOpen}
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/CodexThreadNavigator",
  component: CodexThreadNavigator,
  parameters: {
    layout: "fullscreen",
  },
  args: createCodexThreadNavigatorStoryProps(),
  decorators: [withDashboardWorkspaceStory],
} satisfies Meta<typeof CodexThreadNavigator>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DesktopRail: Story = {
  render: () => <NavigatorRailStory />,
};

export const EmptyThreadList: Story = {
  render: () => <EmptyThreadListStory />,
};

export const LimitedToLatest20: Story = {
  name: "Limited to latest 20",
  render: () => <LimitedToLatest20Story />,
};

export const MobileSheet: Story = {
  render: () => <MobileSheetStory />,
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
};
