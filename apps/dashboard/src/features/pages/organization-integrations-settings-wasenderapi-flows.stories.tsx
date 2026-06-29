import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  createDraftWasenderApiConnection,
  WasenderApiSetupPageStory,
} from "./organization-integrations-settings-wasenderapi-story-support.js";

function WasenderApiFlowsStory(): React.JSX.Element {
  return <WasenderApiSetupPageStory connection={createDraftWasenderApiConnection()} />;
}

const pageMeta = {
  title: "Dashboard/Integrations/Setup/WasenderAPI",
  component: WasenderApiFlowsStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof WasenderApiFlowsStory>;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const SetupProviderConfiguration: PageStory = {
  render: function RenderStory() {
    return <WasenderApiSetupPageStory connection={createDraftWasenderApiConnection()} />;
  },
};

export const SetupCredentialsConfigured: PageStory = {
  render: function RenderStory() {
    return (
      <WasenderApiSetupPageStory
        connection={createDraftWasenderApiConnection({
          configuredSecretNames: ["personalAccessToken", "webhookSecret"],
        })}
      />
    );
  },
};
