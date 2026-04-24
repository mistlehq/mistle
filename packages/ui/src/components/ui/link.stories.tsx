import type { Meta, StoryObj } from "@storybook/react-vite";

import { TextLink } from "./link.js";

const meta = {
  title: "UI/TextLink",
  component: TextLink,
  tags: ["autodocs"],
  args: {
    children: "GitHub settings",
    href: "https://github.com/settings/keys",
  },
} satisfies Meta<typeof TextLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OpensInNewWindow: Story = {
  args: {
    opensInNewWindow: true,
  },
};

export const ListItem: Story = {
  args: {
    children: "Session title",
    href: "/sessions/example",
    variant: "listItem",
  },
};

export const Subtle: Story = {
  args: {
    children: "PR #124",
    href: "https://github.com/mistle/example/pull/124",
    opensInNewWindow: true,
    variant: "subtle",
  },
};
