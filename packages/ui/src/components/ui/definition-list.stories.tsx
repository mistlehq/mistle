import type { Meta, StoryObj } from "@storybook/react-vite";

import { DefinitionList } from "./definition-list.js";

const meta = {
  title: "UI/DefinitionList",
  component: DefinitionList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    items: [
      { id: "method", label: "Method", value: "GitHub App installation" },
      { id: "app-private-key", label: "App private key PEM", value: "**********" },
      { id: "webhook-secret", label: "Webhook secret", value: "**********" },
    ],
  },
  render: function Render(args): React.JSX.Element {
    return (
      <div className="w-full max-w-3xl">
        <DefinitionList {...args} />
      </div>
    );
  },
} satisfies Meta<typeof DefinitionList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
