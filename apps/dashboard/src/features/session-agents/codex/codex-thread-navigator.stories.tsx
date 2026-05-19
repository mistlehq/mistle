import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardWorkspaceStory } from "../../../storybook/decorators.js";
import type { CodexThreadNavigatorRow } from "./codex-thread-navigator-model.js";
import {
  CodexThreadNavigator,
  CodexThreadNavigatorSheet,
  type CodexThreadNavigatorProps,
} from "./codex-thread-navigator.js";

const ThreadRows = [
  {
    id: "thread_active",
    title: "Implement thread navigation",
    preview: "Implement thread navigation",
    cwd: "/Users/jonathanlow/mistle-projects/mistle-add-threads-handling",
    cwdSectionLabel: "mistle-add-threads-handling",
    updatedAt: 100,
    createdAt: 50,
    isActive: true,
    isLoaded: true,
    isOpening: false,
    isPinnedCurrent: false,
    pendingServerRequestCount: 0,
  },
  {
    id: "thread_review",
    title: "Review terminal port ownership",
    preview: "Review terminal port ownership",
    cwd: "/Users/jonathanlow/mistle-projects/mistle-add-threads-handling",
    cwdSectionLabel: "mistle-add-threads-handling",
    updatedAt: 80,
    createdAt: 40,
    isActive: false,
    isLoaded: true,
    isOpening: false,
    isPinnedCurrent: false,
    pendingServerRequestCount: 1,
  },
  {
    id: "thread_opening",
    title: "Refresh sandbox setup",
    preview: "Refresh sandbox setup",
    cwd: "/Users/jonathanlow/mistle-projects/mistle-add-threads-handling",
    cwdSectionLabel: "mistle-add-threads-handling",
    updatedAt: 70,
    createdAt: 30,
    isActive: false,
    isLoaded: false,
    isOpening: true,
    isPinnedCurrent: false,
    pendingServerRequestCount: 0,
  },
  {
    id: "thread_other_repo",
    title: "Draft launch note",
    preview: "Draft launch note",
    cwd: "/Users/jonathanlow/mistle-projects/mistle.dev",
    cwdSectionLabel: "mistle.dev",
    updatedAt: 60,
    createdAt: 20,
    isActive: false,
    isLoaded: false,
    isOpening: false,
    isPinnedCurrent: true,
    pendingServerRequestCount: 0,
  },
] satisfies readonly CodexThreadNavigatorRow[];

function createNavigatorProps(input?: {
  isThreadListLimited?: boolean;
  rows?: readonly CodexThreadNavigatorRow[];
}): CodexThreadNavigatorProps {
  return {
    isThreadListLimited: input?.isThreadListLimited ?? false,
    isStartingThread: false,
    onRefreshThreads: function onRefreshThreads() {},
    onSelectThread: function onSelectThread() {},
    onStartThread: function onStartThread() {},
    rows: input?.rows ?? ThreadRows,
  };
}

function NavigatorRailStory(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigator {...createNavigatorProps()} />
    </div>
  );
}

function EmptyThreadListStory(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigator {...createNavigatorProps({ rows: [] })} />
    </div>
  );
}

function LimitedToLatest20Story(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigator {...createNavigatorProps({ isThreadListLimited: true })} />
    </div>
  );
}

function MobileSheetStory(): React.JSX.Element {
  const [isOpen, setOpen] = useState(true);

  return (
    <div className="h-screen bg-background">
      <CodexThreadNavigatorSheet
        isOpen={isOpen}
        navigator={createNavigatorProps()}
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
  args: createNavigatorProps(),
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
