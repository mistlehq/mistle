import { InfoIcon, WarningIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert.js";
import { Button } from "./button.js";

const meta = {
  title: "UI/Alert",
  component: Alert,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <Alert className="w-[560px]">
        <InfoIcon />
        <AlertTitle>Sandbox session connected</AlertTitle>
        <AlertDescription>
          The session is now attached to its runtime and ready to accept commands.
        </AlertDescription>
      </Alert>
    );
  },
};

export const Destructive: Story = {
  render: function Render() {
    return (
      <Alert className="w-[560px]" variant="destructive">
        <WarningIcon />
        <AlertTitle>Profile validation failed</AlertTitle>
        <AlertDescription>
          One or more required bindings are missing. Update the profile configuration before
          retrying the deployment.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" type="button" variant="outline">
            Review
          </Button>
        </AlertAction>
      </Alert>
    );
  },
};
