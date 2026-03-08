import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatDiffView } from "./chat-diff-view.js";

const meta = {
  title: "Dashboard/Chat/ChatDiffView",
  component: ChatDiffView,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatDiffView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AddedStory: Story = {
  args: {
    path: "apps/dashboard/src/features/chat/components/chat-thread.stories.tsx",
    diff: [
      "@@ -0,0 +1,9 @@",
      '+import type { Meta, StoryObj } from "@storybook/react-vite";',
      "+",
      '+import { ChatThread } from "./chat-thread.js";',
      "+",
      "+export const Default = {",
      "+  args: {",
      "+    entries: DemoEntries,",
      "+  },",
      "+};",
    ].join("\n"),
  },
};

export const UpdatedPreviewConfig: Story = {
  args: {
    path: "packages/storybook/.storybook/preview.ts",
    diff: [
      "@@ -1,2 +1,3 @@",
      ' import "../../../apps/dashboard/src/index.css";',
      ' import "@mistle/ui/styles.css";',
      '+import "./preview-overrides.css";',
    ].join("\n"),
  },
};
