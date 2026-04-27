import type { Meta, StoryObj } from "@storybook/react-vite";

import { ActivityStatus } from "./activity-status.js";

const meta = {
  title: "Dashboard/Shared/ActivityStatus",
  component: ActivityStatus,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ActivityStatus>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Preparing sandbox",
  },
};

export const SnapshotPanel: Story = {
  args: {
    label: "Creating snapshot",
  },
  render: function Render() {
    return (
      <div className="w-[32rem]">
        <ActivityStatus className="justify-start text-muted-foreground" label="Creating snapshot" />
      </div>
    );
  },
};
