import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import { SessionDiffPanel } from "./session-diff-panel.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  renderSessionWorkbenchContentStory,
} from "./session-story-support.js";

const StoryBranchPatch = [
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-page.tsx b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "index 5e8dabc..9cbad42 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "@@ -1,5 +1,6 @@",
  ' import { Badge, Button } from "@mistle/ui";',
  '+import { GitDiffIcon, TerminalIcon } from "@phosphor-icons/react";',
  ' import { useEffect, useMemo } from "react";',
  " ",
  " export function SessionWorkbenchPage(): React.JSX.Element {",
  "@@ -132,6 +133,17 @@ function SessionWorkbenchPageContent(input: {",
  "         >",
  '           <TerminalIcon className="size-4" />',
  "         </Button>",
  "+        <Button",
  '+          aria-label="Diffs"',
  "+          aria-pressed={workbench.diffPanelState.isVisible}",
  '+          size="icon-sm"',
  '+          title="Diffs"',
  '+          type="button"',
  '+          variant="ghost"',
  "+        >",
  '+          <GitDiffIcon className="size-4" />',
  "+        </Button>",
  "       </div>",
  "     ),",
  "     [",
  "diff --git a/apps/dashboard/src/features/pages/session-diff-panel.tsx b/apps/dashboard/src/features/pages/session-diff-panel.tsx",
  "new file mode 100644",
  "index 0000000..1fd1b7a",
  "--- /dev/null",
  "+++ b/apps/dashboard/src/features/pages/session-diff-panel.tsx",
  "@@ -0,0 +1,32 @@",
  '+import { parsePatchFiles } from "@pierre/diffs";',
  '+import { FileDiff } from "@pierre/diffs/react";',
  "+",
  "+export function SessionDiffPanel(): React.JSX.Element {",
  "+  return <div />;",
  "+}",
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx b/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx",
  "index 7b2de0c..bf0af1d 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx",
  "@@ -174,6 +174,15 @@ export const CliSplitWithTerminal: Story = {",
  "       />",
  "     ),",
  "   },",
  "+};",
  "+",
  "+export const ChatWithDiffPanel: Story = {",
  "+  args: {",
  "+    isSecondaryPanelVisible: true,",
  "+    secondaryPanel: <SessionDiffPanel /> ,",
  "+    secondaryPanelSize: 42,",
  "+  },",
  " };",
].join("\n");

type StoryDiffWorkbenchProps = {
  patch: string;
};

function StoryDiffWorkbench({ patch }: StoryDiffWorkbenchProps): React.JSX.Element {
  return renderSessionWorkbenchContentStory({
    isSecondaryPanelVisible: true,
    mainContent: createStorySessionMainContent(),
    primaryBottomPanel: createStorySessionBottomPanel(),
    secondaryPanel: (
      <SessionDiffPanel patch={patch} summaryLabel="Compared with main" title="Current changes" />
    ),
    secondaryPanelSize: 42,
  });
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/DiffPanel",
  component: StoryDiffWorkbench,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
  args: {
    patch: StoryBranchPatch,
  },
} satisfies Meta<typeof StoryDiffWorkbench>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AgainstMain: Story = {};

export const EmptyState: Story = {
  args: {
    patch: "",
  },
};
