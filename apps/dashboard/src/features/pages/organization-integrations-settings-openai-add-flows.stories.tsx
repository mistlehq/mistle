import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  AddFlowStorySpecs,
  IntegrationSettingsAddFlowStory,
} from "./organization-integrations-settings-page-story-support.js";

function OpenAiAddFlowStory(): React.JSX.Element {
  return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAI} />;
}

const meta = {
  title: "Dashboard/Integrations/OpenAI/AddFlows",
  component: OpenAiAddFlowStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof OpenAiAddFlowStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Default",
  render: function RenderStory() {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAI} />;
  },
};

export const StartDeviceAuthorization: Story = {
  name: "Start device authorization",
  render: function RenderStory() {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationStart} />
    );
  },
};

export const PendingDeviceAuthorization: Story = {
  name: "Pending device authorization",
  render: function RenderStory() {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationPending} />
    );
  },
};

export const DeviceAuthorizationExpiringSoon: Story = {
  name: "Device authorization expiring soon",
  render: function RenderStory() {
    return (
      <IntegrationSettingsAddFlowStory
        {...AddFlowStorySpecs.OpenAIDeviceAuthorizationExpiringSoon}
      />
    );
  },
};

export const ExpiredDeviceAuthorization: Story = {
  name: "Expired device authorization",
  render: function RenderStory() {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationExpired} />
    );
  },
};

export const FailedDeviceAuthorization: Story = {
  name: "Failed device authorization",
  render: function RenderStory() {
    return (
      <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAIDeviceAuthorizationFailed} />
    );
  },
};
