import { InfoIcon, WarningIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button.js";
import { Notice } from "./notice.js";

const DefaultStoryAutoHideAfterMs = 5_000;

type NoticeStoryArgs = {
  autoHideAfterMs?: number;
  body: string;
  dismissible: boolean;
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
    dismissible: false,
    showIcon: false,
    showAction: false,
  },
  argTypes: {
    variant: {
      control: "radio",
      options: ["default", "success", "warning", "alert"],
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
    dismissible: {
      control: "boolean",
    },
    autoHideAfterMs: {
      control: {
        type: "number",
        min: DefaultStoryAutoHideAfterMs,
        step: 500,
      },
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
    const autoHideAfterMs = resolveStoryAutoHideAfterMs(args.autoHideAfterMs);
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
        autoHideAfterMs={autoHideAfterMs}
        className="w-[calc(100vw-2rem)] max-w-[560px]"
        dismissible={args.dismissible}
        icon={icon}
        resetKey={`${args.variant}:${args.title ?? ""}:${args.body}:${autoHideAfterMs ?? "off"}`}
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

function resolveStoryAutoHideAfterMs(autoHideAfterMs: number | undefined): number | undefined {
  if (autoHideAfterMs === undefined) {
    return undefined;
  }

  if (!Number.isFinite(autoHideAfterMs) || autoHideAfterMs < DefaultStoryAutoHideAfterMs) {
    return DefaultStoryAutoHideAfterMs;
  }

  return autoHideAfterMs;
}
