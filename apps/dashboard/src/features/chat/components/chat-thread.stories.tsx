import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ChatEntry } from "../chat-types.js";
import { ChatThread } from "./chat-thread.js";

const meta = {
  title: "Dashboard/Chat/ChatThread",
  component: ChatThread,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatThread>;

export default meta;

type Story = StoryObj<typeof meta>;

const DemoEntries: readonly ChatEntry[] = [
  {
    id: "user-1",
    turnId: "turn-1",
    kind: "user-message",
    status: "completed",
    text: "Review the Storybook rollout and tell me what still needs cleanup.",
  },
  {
    id: "reasoning-1",
    turnId: "turn-1",
    kind: "reasoning",
    source: "summary",
    status: "completed",
    summary:
      "Checking shared Storybook config, static asset ownership, and dashboard component boundaries.",
  },
  {
    id: "plan-1",
    turnId: "turn-1",
    kind: "plan",
    status: "completed",
    text: [
      "1. Validate the shared Storybook package",
      "2. Add selected dashboard stories",
      "3. Identify remaining container splits",
    ].join("\n"),
  },
  {
    id: "assistant-1",
    turnId: "turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "The current setup is usable, but a few cleanup items remain:",
      "",
      "- shared fonts still originate from dashboard-owned assets",
      "- container-heavy dashboard views are not story-friendly yet",
      "- chat approval/file-change blocks need dedicated stories next",
    ].join("\n"),
  },
  {
    id: "user-2",
    turnId: "turn-2",
    kind: "user-message",
    status: "completed",
    text: "What should we refactor next?",
  },
  {
    id: "assistant-2",
    turnId: "turn-2",
    kind: "assistant-message",
    phase: null,
    status: "streaming",
    text: "Next I would split dashboard containers from view components so the remaining stories stay prop-driven...",
  },
];

export const Default: Story = {
  args: {
    entries: DemoEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};
