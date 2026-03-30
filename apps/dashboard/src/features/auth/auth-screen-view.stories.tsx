import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardMemoryRouter } from "../../storybook/decorators.js";
import { AuthScreenView } from "./auth-screen-view.js";

const meta = {
  title: "Dashboard/Auth/AuthScreenView",
  component: AuthScreenView,
  decorators: [withDashboardMemoryRouter],
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

export const EmailEntry: Story = {
  args: {
    email: "",
  },
};

export const SendingOtp: Story = {
  args: {
    isSendingOtp: true,
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
};
