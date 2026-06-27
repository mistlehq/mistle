import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  createDraftGitHubConnection,
  GitHubAppSetupPageStory,
} from "./organization-integrations-settings-github-app-flows.stories.js";
import { IntegrationSettingsAddFlowStory } from "./organization-integrations-settings-page-story-support.js";
import {
  createDraftSlackConnection,
  SlackAppSetupPageStory,
} from "./organization-integrations-settings-slack-app-flows.stories.js";
import {
  createDraftWasenderApiConnection,
  WasenderApiSetupPageStory,
} from "./organization-integrations-settings-wasenderapi-story-support.js";

const IntegrationSetupProviders: {
  readonly GITHUB: "github";
  readonly JIRA: "jira";
  readonly SLACK: "slack";
  readonly WASENDERAPI: "wasenderapi";
} = {
  GITHUB: "github",
  JIRA: "jira",
  SLACK: "slack",
  WASENDERAPI: "wasenderapi",
};

type IntegrationSetupProvider =
  (typeof IntegrationSetupProviders)[keyof typeof IntegrationSetupProviders];

const SlackSetupStates: {
  readonly BLANK: "blank";
  readonly CONFIGURED_EXISTING_APP: "configured-existing-app";
} = {
  BLANK: "blank",
  CONFIGURED_EXISTING_APP: "configured-existing-app",
};

type SlackSetupState = (typeof SlackSetupStates)[keyof typeof SlackSetupStates];

const JiraSetupMethods: {
  readonly CHOOSE_METHOD: "choose-method";
  readonly PERSONAL_API_TOKEN: "jira-personal-api-token";
  readonly SERVICE_ACCOUNT_API_TOKEN: "jira-service-account-api-token";
  readonly SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS: "jira-service-account-oauth-client-credentials";
} = {
  CHOOSE_METHOD: "choose-method",
  PERSONAL_API_TOKEN: "jira-personal-api-token",
  SERVICE_ACCOUNT_API_TOKEN: "jira-service-account-api-token",
  SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS: "jira-service-account-oauth-client-credentials",
};

type JiraSetupMethod = (typeof JiraSetupMethods)[keyof typeof JiraSetupMethods];

type IntegrationProviderSetupStatesStoryArgs = {
  jiraMethod: JiraSetupMethod;
  provider: IntegrationSetupProvider;
  slackState: SlackSetupState;
};

function IntegrationProviderSetupStatesStory(
  input: IntegrationProviderSetupStatesStoryArgs,
): React.JSX.Element {
  if (input.provider === IntegrationSetupProviders.GITHUB) {
    return <GitHubAppSetupPageStory connection={createDraftGitHubConnection()} />;
  }

  if (input.provider === IntegrationSetupProviders.SLACK) {
    return (
      <SlackAppSetupPageStory
        connection={
          input.slackState === SlackSetupStates.CONFIGURED_EXISTING_APP
            ? createDraftSlackConnection({
                config: {
                  app_id: "A0123456789",
                  client_id: "3555487893074.10993991013813",
                },
                configuredSecretNames: ["botToken", "clientSecret", "signingSecret"],
                externalSubjectId: "T0123456789",
              })
            : createDraftSlackConnection()
        }
      />
    );
  }

  if (input.provider === IntegrationSetupProviders.JIRA) {
    return (
      <IntegrationSettingsAddFlowStory
        {...(input.jiraMethod === JiraSetupMethods.CHOOSE_METHOD
          ? {}
          : { initialMethodId: input.jiraMethod })}
        variantId="jira-default"
      />
    );
  }

  return <WasenderApiSetupPageStory connection={createDraftWasenderApiConnection()} />;
}

const pageMeta = {
  title: "Dashboard/Integrations/Setup/Provider Setup States",
  component: IntegrationProviderSetupStatesStory,
  decorators: [withDashboardPageStory],
  argTypes: {
    provider: {
      control: "select",
      options: [
        IntegrationSetupProviders.GITHUB,
        IntegrationSetupProviders.SLACK,
        IntegrationSetupProviders.JIRA,
        IntegrationSetupProviders.WASENDERAPI,
      ],
    },
    jiraMethod: {
      control: "select",
      options: [
        JiraSetupMethods.CHOOSE_METHOD,
        JiraSetupMethods.PERSONAL_API_TOKEN,
        JiraSetupMethods.SERVICE_ACCOUNT_API_TOKEN,
        JiraSetupMethods.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      ],
    },
    slackState: {
      control: "select",
      options: [SlackSetupStates.BLANK, SlackSetupStates.CONFIGURED_EXISTING_APP],
    },
  },
  args: {
    jiraMethod: JiraSetupMethods.CHOOSE_METHOD,
    provider: IntegrationSetupProviders.GITHUB,
    slackState: SlackSetupStates.BLANK,
  },
} satisfies Meta<IntegrationProviderSetupStatesStoryArgs>;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const Default: PageStory = {};
