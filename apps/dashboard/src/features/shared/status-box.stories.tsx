import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusBox } from "./status-box.js";

const meta = {
  title: "Dashboard/Shared/StatusBox",
  component: StatusBox,
  args: {
    children: "Status message",
    title: "Could not load integrations",
    tone: "destructive",
    variant: "boxed",
  },
  argTypes: {
    children: {
      control: "text",
    },
    title: {
      control: "text",
    },
    tone: {
      control: "radio",
      options: ["neutral", "destructive"],
    },
    variant: {
      control: "radio",
      options: ["boxed", "subtle"],
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Use controls to preview the dashboard status box across tone, variant, title, and message combinations.",
      },
    },
  },
} satisfies Meta<typeof StatusBox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
