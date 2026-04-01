import { InfoIcon, WarningIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button.js";
import { Notice } from "./notice.js";

type NoticeStoryArgs = {
  body: string;
  role?: "alert" | "status";
  showAction: boolean;
  showIcon: boolean;
  title?: string;
} & Pick<React.ComponentProps<typeof Notice>, "tone" | "variant">;

const meta = {
  title: "UI/Notice",
  component: Notice,
  tags: ["autodocs"],
  args: {
    tone: "neutral",
    variant: "boxed",
    role: "status",
    title: "Sandbox session connected",
    body: "The session is now attached to its runtime and ready to accept commands.",
    showIcon: false,
    showAction: false,
  },
  argTypes: {
    tone: {
      control: "radio",
      options: ["neutral", "destructive"],
    },
    variant: {
      control: "radio",
      options: ["boxed", "subtle"],
    },
    role: {
      control: "radio",
      options: ["status", "alert"],
    },
    title: {
      control: "text",
    },
    body: {
      control: "text",
    },
    showIcon: {
      control: "boolean",
    },
    showAction: {
      control: "boolean",
    },
  },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Notice is a neutral feedback primitive for inline or section-scoped messaging. Use role controls to preview urgency semantics separately from visual tone.",
      },
    },
  },
  render: function Render(args: NoticeStoryArgs) {
    const icon = args.showIcon ? (
      args.tone === "destructive" ? (
        <WarningIcon />
      ) : (
        <InfoIcon />
      )
    ) : undefined;

    const action = args.showAction ? (
      <Button size="sm" type="button" variant="outline">
        Review
      </Button>
    ) : undefined;

    return (
      <Notice
        action={action}
        className="w-[560px]"
        icon={icon}
        role={args.role}
        title={args.title === "" ? undefined : args.title}
        tone={args.tone}
        variant={args.variant}
      >
        {args.body}
      </Notice>
    );
  },
} satisfies Meta<NoticeStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
