import type { Meta, StoryObj } from "@storybook/react-vite";

import { BrailleSpinner } from "./braille-spinner.js";

const meta = {
  title: "UI/BrailleSpinner",
  component: BrailleSpinner,
  tags: ["autodocs"],
} satisfies Meta<typeof BrailleSpinner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InlineLoadingState: Story = {
  render: function Render() {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <BrailleSpinner className="text-muted-foreground" />
        <span>Preparing sandbox</span>
      </div>
    );
  },
};
