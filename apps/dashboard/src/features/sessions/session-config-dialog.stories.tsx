import type { Meta, StoryObj } from "@storybook/react-vite";

import { SessionConfigDialog } from "./session-config-dialog.js";

const meta = {
  title: "Dashboard/Sessions/SessionConfigDialog",
  component: SessionConfigDialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    sandboxInstanceId: "sbi_storybook",
    agentConnectionState: "ready",
    connectedSession: {
      sandboxInstanceId: "sbi_storybook",
      connectedAtIso: "2026-03-08T08:00:00.000Z",
      expiresAtIso: "2026-03-08T10:00:00.000Z",
      threadId: "thread_storybook",
    },
    configJson: JSON.stringify(
      {
        model: "gpt-5",
        model_reasoning_effort: "medium",
        approval_policy: "on-request",
      },
      null,
      2,
    ),
    configRequirementsJson: JSON.stringify(
      {
        required_env: ["OPENAI_API_KEY"],
        writable_paths: ["/home/sandbox/projects/mistle"],
      },
      null,
      2,
    ),
    isReadingConfig: false,
    isReadingConfigRequirements: false,
    isOpen: true,
    onOpenChange: function onOpenChange() {},
  },
} satisfies Meta<typeof SessionConfigDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const Loading: Story = {
  args: {
    configJson: null,
    configRequirementsJson: null,
    isReadingConfig: true,
    isReadingConfigRequirements: true,
  },
};
