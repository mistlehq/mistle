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
} & Pick<React.ComponentProps<typeof Notice>, "appearance" | "variant">;

const meta = {
  title: "UI/Notice",
  component: Notice,
  tags: ["autodocs"],
  args: {
    appearance: "boxed",
    variant: "default",
    role: "status",
    title: "Sandbox session connected",
    body: "The session is now attached to its runtime and ready to accept commands.",
    showIcon: false,
    showAction: false,
  },
  argTypes: {
    variant: {
      control: "radio",
      options: ["default", "warning", "alert"],
    },
    appearance: {
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
          "Notice is an inline feedback primitive for section-scoped messaging. Use the variant control to preview alert semantics and appearance to preview chrome.",
      },
    },
  },
  render: function Render(args: NoticeStoryArgs) {
    const icon = args.showIcon ? (
      args.variant === "alert" ? (
        <WarningIcon />
      ) : args.variant === "warning" ? (
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
        appearance={args.appearance}
        className="w-[560px]"
        icon={icon}
        role={args.role}
        title={args.title === "" ? undefined : args.title}
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
