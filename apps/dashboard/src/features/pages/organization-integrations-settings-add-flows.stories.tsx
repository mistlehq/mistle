import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  AddFlowStorySpecs,
  IntegrationSettingsAddFlowStory,
} from "./organization-integrations-settings-page-story-support.js";

const AddConnectionProviders: {
  readonly GITHUB_ENTERPRISE_SERVER: "github-enterprise-server";
  readonly GOOGLE_WORKSPACE: "google-workspace";
  readonly GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "google-workspace-service-account";
  readonly LINEAR: "linear";
  readonly SIGNOZ: "signoz";
  readonly SUPABASE: "supabase";
  readonly WASENDERAPI: "wasenderapi";
  readonly WHAPI: "whapi";
} = {
  GITHUB_ENTERPRISE_SERVER: "github-enterprise-server",
  GOOGLE_WORKSPACE: "google-workspace",
  GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "google-workspace-service-account",
  LINEAR: "linear",
  SIGNOZ: "signoz",
  SUPABASE: "supabase",
  WASENDERAPI: "wasenderapi",
  WHAPI: "whapi",
};

type AddConnectionProvider = (typeof AddConnectionProviders)[keyof typeof AddConnectionProviders];

type OrganizationIntegrationsAddFlowStoryArgs = {
  provider: AddConnectionProvider;
};

function OrganizationIntegrationsAddFlowStory(
  input: OrganizationIntegrationsAddFlowStoryArgs,
): React.JSX.Element {
  if (input.provider === AddConnectionProviders.GOOGLE_WORKSPACE) {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.GoogleWorkspace} />;
  }

  if (input.provider === AddConnectionProviders.GOOGLE_WORKSPACE_SERVICE_ACCOUNT) {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.GoogleWorkspaceServiceAccount} />;
  }

  if (input.provider === AddConnectionProviders.LINEAR) {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.Linear} />;
  }

  if (input.provider === AddConnectionProviders.SIGNOZ) {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.SigNoz} />;
  }

  if (input.provider === AddConnectionProviders.SUPABASE) {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.Supabase} />;
  }

  if (input.provider === AddConnectionProviders.WASENDERAPI) {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.WasenderAPI} />;
  }

  if (input.provider === AddConnectionProviders.WHAPI) {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.Whapi} />;
  }

  return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.GitHubEnterpriseServer} />;
}

const meta = {
  title: "Dashboard/Integrations/AddConnection/ProviderForms",
  component: OrganizationIntegrationsAddFlowStory,
  decorators: [withDashboardPageStory],
  argTypes: {
    provider: {
      control: "select",
      options: [
        AddConnectionProviders.GITHUB_ENTERPRISE_SERVER,
        AddConnectionProviders.GOOGLE_WORKSPACE,
        AddConnectionProviders.GOOGLE_WORKSPACE_SERVICE_ACCOUNT,
        AddConnectionProviders.LINEAR,
        AddConnectionProviders.SIGNOZ,
        AddConnectionProviders.SUPABASE,
        AddConnectionProviders.WASENDERAPI,
        AddConnectionProviders.WHAPI,
      ],
    },
  },
  args: {
    provider: AddConnectionProviders.GITHUB_ENTERPRISE_SERVER,
  },
} satisfies Meta<OrganizationIntegrationsAddFlowStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
