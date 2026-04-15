import type { Meta, StoryObj } from "@storybook/react-vite";

import { BadgeListField } from "./badge-list-field.js";

const meta = {
  title: "UI/BadgeListField",
  component: BadgeListField,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    items: [
      { id: "jira:issue_created", label: "Jira issue created" },
      { id: "jira:issue_updated", label: "Jira issue updated" },
      { id: "comment_created", label: "Comment created" },
      { id: "comment_updated", label: "Comment updated" },
    ],
    label: "Registered events",
  },
  render: function Render(args): React.JSX.Element {
    return (
      <div className="w-full max-w-3xl">
        <BadgeListField {...args} />
      </div>
    );
  },
} satisfies Meta<typeof BadgeListField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
