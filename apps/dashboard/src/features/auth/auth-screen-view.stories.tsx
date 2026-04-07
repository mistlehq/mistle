import { Separator } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";

import { withDashboardMemoryRouter, withDashboardPageStory } from "../../storybook/decorators.js";
import { AuthScreenView } from "./auth-screen-view.js";
import { GoogleSignInButton } from "./google-sign-in-button.js";

const meta = {
  title: "Dashboard/Auth/ScreenView",
  component: AuthScreenView,
  decorators: [withDashboardPageStory, withDashboardMemoryRouter],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    authError: null,
    authStep: "email",
    email: "dev@mistle.so",
    footerError: null,
    isSendingOtp: false,
    isVerifyingOtp: false,
    onEmailChange: () => {},
    onOtpChange: () => {},
    onSendOtp: async () => {},
    onUseDifferentEmail: () => {},
    onVerifyOtp: async () => {},
    otp: "",
  },
} satisfies Meta<typeof AuthScreenView>;

export default meta;

type Story = StoryObj<typeof meta>;

function InteractiveOtpStory(args: Story["args"]): React.JSX.Element {
  const [otp, setOtp] = useState(args?.otp ?? "");

  return <AuthScreenView {...args} onOtpChange={setOtp} otp={otp} />;
}

export const EmailEntry: Story = {
  args: {
    email: "",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Email address")).toHaveFocus();
  },
};

export const SendingOtp: Story = {
  args: {
    isSendingOtp: true,
  },
};

export const GoogleEnabled: Story = {
  args: {
    emailStageAfterForm: (
      <div className="gap-4 pt-1 flex flex-col">
        <div className="items-center gap-4 flex">
          <Separator className="flex-1" />
          <div className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
            Or
          </div>
          <Separator className="flex-1" />
        </div>
        <GoogleSignInButton isPending={false} onClick={async () => {}} />
      </div>
    ),
    title: "Log in",
  },
};

export const GoogleRedirecting: Story = {
  args: {
    emailStageAfterForm: (
      <div className="gap-4 pt-1 flex flex-col">
        <div className="items-center gap-4 flex">
          <Separator className="flex-1" />
          <div className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
            Or
          </div>
          <Separator className="flex-1" />
        </div>
        <GoogleSignInButton isPending={true} onClick={async () => {}} />
      </div>
    ),
    title: "Log in",
  },
};

export const GoogleCallbackError: Story = {
  args: {
    authError: "Google sign-in was cancelled.",
    emailStageAfterForm: (
      <div className="gap-4 pt-1 flex flex-col">
        <div className="items-center gap-4 flex">
          <Separator className="flex-1" />
          <div className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
            Or
          </div>
          <Separator className="flex-1" />
        </div>
        <GoogleSignInButton isPending={false} onClick={async () => {}} />
      </div>
    ),
    title: "Log in",
  },
};

export const EmailError: Story = {
  args: {
    authError: "Please enter a valid email address.",
    email: "invalid-email",
  },
};

export const OtpEntry: Story = {
  args: {
    authStep: "otp",
  },
  render: InteractiveOtpStory,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("One-time code")).toHaveFocus();
  },
};

export const OtpPartialEntry: Story = {
  args: {
    authStep: "otp",
    otp: "12",
  },
  render: InteractiveOtpStory,
};

export const VerifyingOtp: Story = {
  args: {
    authStep: "otp",
    isVerifyingOtp: true,
    otp: "123456",
  },
};

export const OtpError: Story = {
  args: {
    authStep: "otp",
    authError: "The one-time code is invalid or expired.",
    otp: "123456",
  },
  render: InteractiveOtpStory,
};
