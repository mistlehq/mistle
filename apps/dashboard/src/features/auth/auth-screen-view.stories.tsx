import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type SyntheticEvent } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  withDashboardCenteredSurface,
  withDashboardMemoryRouter,
} from "../../storybook/decorators.js";
import { AuthScreenView } from "./auth-screen-view.js";

const meta = {
  title: "Dashboard/Auth/AuthScreenView",
  component: AuthScreenView,
  decorators: [withDashboardMemoryRouter, withDashboardCenteredSurface],
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

export const EmailEntry: Story = {};

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

export const InteractiveFlow: Story = {
  render: function RenderStory(): React.JSX.Element {
    const [authStep, setAuthStep] = useState<"email" | "otp">("email");
    const [email, setEmail] = useState("dev@mistle.so");
    const [otp, setOtp] = useState("");

    async function handleSendOtp(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
      event.preventDefault();
      setAuthStep("otp");
    }

    async function handleVerifyOtp(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
      event.preventDefault();
    }

    function handleUseDifferentEmail(): void {
      setAuthStep("email");
      setOtp("");
    }

    return (
      <AuthScreenView
        authError={null}
        authStep={authStep}
        email={email}
        footerError={null}
        isSendingOtp={false}
        isVerifyingOtp={false}
        onEmailChange={setEmail}
        onOtpChange={setOtp}
        onSendOtp={handleSendOtp}
        onUseDifferentEmail={handleUseDifferentEmail}
        onVerifyOtp={handleVerifyOtp}
        otp={otp}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const continueButton = canvas.getByRole("button", { name: "Continue with email" });

    await expect(continueButton).toBeVisible();

    await userEvent.clear(canvas.getByLabelText("Email address"));
    await userEvent.type(canvas.getByLabelText("Email address"), "story@mistle.so");
    await userEvent.click(continueButton);

    await expect(canvas.getByText(/We sent a one-time code to/i)).toBeVisible();
    await expect(canvas.getByText("story@mistle.so")).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Use a different email" }));
    await expect(canvas.getByRole("button", { name: "Continue with email" })).toBeVisible();
  },
};

export const InteractiveVerification: Story = {
  render: function RenderStory(): React.JSX.Element {
    const [otp, setOtp] = useState("");
    const [statusMessage, setStatusMessage] = useState("Waiting for code entry.");

    async function handleVerifyOtp(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
      event.preventDefault();
      setStatusMessage(`Verification submitted for code ${otp}.`);
    }

    return (
      <div className="flex flex-col gap-3">
        <p aria-live="polite" role="status">
          {statusMessage}
        </p>
        <AuthScreenView
          authError={null}
          authStep="otp"
          email="story@mistle.so"
          footerError={null}
          isSendingOtp={false}
          isVerifyingOtp={false}
          onEmailChange={() => {}}
          onOtpChange={setOtp}
          onSendOtp={async () => {}}
          onUseDifferentEmail={() => {
            setOtp("");
            setStatusMessage("Switched back to email entry.");
          }}
          onVerifyOtp={handleVerifyOtp}
          otp={otp}
        />
      </div>
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("status")).toHaveTextContent("Waiting for code entry.");
    await userEvent.type(canvas.getByLabelText("One-time code"), "123456");
    await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Verification submitted for code 123456.",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Use a different email" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Switched back to email entry.");
  },
};
