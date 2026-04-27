import type { Meta, StoryObj } from "@storybook/react-vite";

import { CopyableValue } from "./copyable-value.js";

const meta = {
  title: "UI/CopyableValue",
  component: CopyableValue,
  tags: ["autodocs"],
} satisfies Meta<typeof CopyableValue>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Field: Story = {
  args: {
    label: "Webhook callback URL",
    value: "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_demo",
  },
};

export const FieldLoading: Story = {
  args: {
    label: "Webhook callback URL",
    loading: true,
  },
};

export const FieldHorizontalOverflow: Story = {
  args: {
    label: "Webhook callback URL",
    value:
      "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_demo_with_a_very_long_unbroken_callback_token_01JZ7TR8S72P9ZV5K4RQXK8M3N_more_path_segments_that_force_horizontal_overflow",
  },
  decorators: [
    function ConstrainedWidthDecorator(Story): React.JSX.Element {
      return (
        <div className="w-[520px] max-w-full">
          <Story />
        </div>
      );
    },
  ],
};
