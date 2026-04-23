import type { Meta, StoryObj } from "@storybook/react-vite";

import { CopyableValue } from "./copyable-value.js";

const meta = {
  title: "UI/CopyableValue",
  component: CopyableValue,
  tags: ["autodocs"],
  argTypes: {
    surfaceVariant: {
      control: "inline-radio",
      options: ["default", "info"],
    },
  },
} satisfies Meta<typeof CopyableValue>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Field: Story = {
  args: {
    label: "Webhook callback URL",
    surfaceVariant: "default",
    value: "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_demo",
  },
};

export const FieldLoading: Story = {
  args: {
    label: "Webhook callback URL",
    loading: true,
    surfaceVariant: "default",
  },
};

export const FieldInfo: Story = {
  args: {
    label: "Signing key command",
    surfaceVariant: "info",
    value: 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/mistle-signing',
  },
};
