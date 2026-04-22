import type { Meta, StoryObj } from "@storybook/react-vite";

import { OverflowTooltipText } from "./overflow-tooltip-text.js";

type OverflowTooltipTextStoryArgs = React.ComponentProps<typeof OverflowTooltipText> & {
  widthClassName: string;
};

const meta = {
  title: "UI/OverflowTooltipText",
  component: OverflowTooltipText,
  tags: ["autodocs"],
  args: {
    text: "Investigate flaky title rendering",
    widthClassName: "max-w-xs",
  },
  render: function Render(args): React.JSX.Element {
    const { widthClassName, ...componentArgs } = args;

    return (
      <div className="space-y-3 p-6">
        <div className="max-w-2xl">
          <p className="text-muted-foreground text-sm">
            The label truncates within its container and only shows a tooltip when the text actually
            overflows.
          </p>
        </div>
        <div className={`rounded-md border p-3 ${widthClassName}`}>
          <OverflowTooltipText {...componentArgs} containerClassName="block" />
        </div>
      </div>
    );
  },
} satisfies Meta<OverflowTooltipTextStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongTitle: Story = {
  args: {
    text: "Investigate why the billing reconciliation sandbox stalls after reconnect when replaying a payload with 18 invoices, 6 retries, and a downstream timeout on the ledger write path",
  },
};

export const NarrowContainer: Story = {
  args: {
    text: "This is intentionally narrow so the tooltip behavior is easy to verify.",
    widthClassName: "max-w-[12rem]",
  },
};

export const BottomTooltip: Story = {
  args: {
    text: "A long session title can also reveal its tooltip below the trigger when that fits the layout better.",
    tooltipSide: "bottom",
  },
};

export const RightOffsetTooltip: Story = {
  args: {
    text: "Opening the tooltip to the right with a slightly larger gap keeps it out of the way when the surrounding panel is scrollable.",
    tooltipSide: "right",
    tooltipSideOffset: 8,
    widthClassName: "max-w-[12rem]",
  },
};

export const StartTruncation: Story = {
  args: {
    text: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
    truncatePosition: "start",
    widthClassName: "max-w-[16rem]",
  },
};
