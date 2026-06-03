import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardWorkspaceStory } from "../../../storybook/decorators.js";
import {
  createRuntimeConversationNavigatorStoryProps,
  RuntimeConversationNavigatorSubagentLineageStoryRows,
} from "./runtime-conversation-navigator-story-support.js";
import {
  RuntimeConversationNavigator,
  RuntimeConversationNavigatorSheet,
} from "./runtime-conversation-navigator.js";

function NavigatorRailStory(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <RuntimeConversationNavigator {...createRuntimeConversationNavigatorStoryProps()} />
    </div>
  );
}

function EmptyConversationListStory(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <RuntimeConversationNavigator
        {...createRuntimeConversationNavigatorStoryProps({ rows: [] })}
      />
    </div>
  );
}

function LimitedToLatest20Story(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <RuntimeConversationNavigator
        {...createRuntimeConversationNavigatorStoryProps({ isConversationListLimited: true })}
      />
    </div>
  );
}

function SubagentLineageStory(): React.JSX.Element {
  return (
    <div className="h-screen bg-background">
      <RuntimeConversationNavigator
        {...createRuntimeConversationNavigatorStoryProps({
          rows: RuntimeConversationNavigatorSubagentLineageStoryRows,
        })}
      />
    </div>
  );
}

function MobileSheetStory(): React.JSX.Element {
  const [isOpen, setOpen] = useState(true);

  return (
    <div className="h-screen bg-background">
      <RuntimeConversationNavigatorSheet
        isOpen={isOpen}
        navigator={createRuntimeConversationNavigatorStoryProps()}
        onOpenChange={setOpen}
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/RuntimeConversationNavigator",
  component: RuntimeConversationNavigator,
  parameters: {
    layout: "fullscreen",
  },
  args: createRuntimeConversationNavigatorStoryProps(),
  decorators: [withDashboardWorkspaceStory],
} satisfies Meta<typeof RuntimeConversationNavigator>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DesktopRail: Story = {
  render: () => <NavigatorRailStory />,
};

export const EmptyConversationList: Story = {
  render: () => <EmptyConversationListStory />,
};

export const LimitedToLatest20: Story = {
  name: "Limited to latest 20",
  render: () => <LimitedToLatest20Story />,
};

export const SubagentLineage: Story = {
  name: "Subagent lineage",
  render: () => <SubagentLineageStory />,
};

export const MobileSheet: Story = {
  render: () => <MobileSheetStory />,
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
};
