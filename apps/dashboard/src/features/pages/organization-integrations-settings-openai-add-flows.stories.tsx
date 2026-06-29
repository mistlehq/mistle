import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  AddFlowStorySpecs,
  IntegrationSettingsAddFlowStory,
} from "./organization-integrations-settings-page-story-support.js";

const OpenAiAddFlowStates: {
  readonly DEFAULT: "default";
  readonly START_DEVICE_AUTHORIZATION: "start-device-authorization";
  readonly PENDING_DEVICE_AUTHORIZATION: "pending-device-authorization";
  readonly DEVICE_AUTHORIZATION_EXPIRING_SOON: "device-authorization-expiring-soon";
  readonly EXPIRED_DEVICE_AUTHORIZATION: "expired-device-authorization";
  readonly FAILED_DEVICE_AUTHORIZATION: "failed-device-authorization";
} = {
  DEFAULT: "default",
  START_DEVICE_AUTHORIZATION: "start-device-authorization",
  PENDING_DEVICE_AUTHORIZATION: "pending-device-authorization",
  DEVICE_AUTHORIZATION_EXPIRING_SOON: "device-authorization-expiring-soon",
  EXPIRED_DEVICE_AUTHORIZATION: "expired-device-authorization",
  FAILED_DEVICE_AUTHORIZATION: "failed-device-authorization",
};

type OpenAiAddFlowState = (typeof OpenAiAddFlowStates)[keyof typeof OpenAiAddFlowStates];

type OpenAiAddFlowStoryArgs = {
  state: OpenAiAddFlowState;
};

function OpenAiAddFlowStory(input: OpenAiAddFlowStoryArgs): React.JSX.Element {
  if (input.state === OpenAiAddFlowStates.START_DEVICE_AUTHORIZATION) {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationStart} />
    );
  }

  if (input.state === OpenAiAddFlowStates.PENDING_DEVICE_AUTHORIZATION) {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationPending} />
    );
  }

  if (input.state === OpenAiAddFlowStates.DEVICE_AUTHORIZATION_EXPIRING_SOON) {
    return (
      <IntegrationSettingsAddFlowStory
        {...AddFlowStorySpecs.OpenAIDeviceAuthorizationExpiringSoon}
      />
    );
  }

  if (input.state === OpenAiAddFlowStates.EXPIRED_DEVICE_AUTHORIZATION) {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationExpired} />
    );
  }

  if (input.state === OpenAiAddFlowStates.FAILED_DEVICE_AUTHORIZATION) {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationFailed} />
    );
  }

  return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAI} />;
}

const meta = {
  title: "Dashboard/Integrations/AddConnection/OpenAIStates",
  component: OpenAiAddFlowStory,
  decorators: [withDashboardPageStory],
  argTypes: {
    state: {
      control: "select",
      options: [
        OpenAiAddFlowStates.DEFAULT,
        OpenAiAddFlowStates.START_DEVICE_AUTHORIZATION,
        OpenAiAddFlowStates.PENDING_DEVICE_AUTHORIZATION,
        OpenAiAddFlowStates.DEVICE_AUTHORIZATION_EXPIRING_SOON,
        OpenAiAddFlowStates.EXPIRED_DEVICE_AUTHORIZATION,
        OpenAiAddFlowStates.FAILED_DEVICE_AUTHORIZATION,
      ],
    },
  },
  args: {
    state: OpenAiAddFlowStates.DEFAULT,
  },
} satisfies Meta<OpenAiAddFlowStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
