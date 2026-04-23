import type { Meta, StoryObj } from "@storybook/react-vite";

import { Link } from "./link.js";

const meta = {
  title: "UI/Link",
  component: Link,
  tags: ["autodocs"],
  args: {
    children: "GitHub settings",
    href: "https://github.com/settings/keys",
    target: "_blank",
    rel: "noreferrer",
  },
} satisfies Meta<typeof Link>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
