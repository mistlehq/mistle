import { Fragment, type ReactNode } from "react";

import { useGitHubWebhookSourceActions } from "./github-webhook-source-actions.js";
import type { IntegrationWebhookSourceActionsRefreshTriggerCapabilities } from "./integration-webhook-source-actions-types.js";
import type { IntegrationConnection } from "./integrations-service.js";
import { useSlackWebhookSourceActions } from "./slack-webhook-source-actions.js";

type IntegrationWebhookSourceActionsInput = {
  connections: readonly IntegrationConnection[];
  refreshTriggerCapabilities: IntegrationWebhookSourceActionsRefreshTriggerCapabilities;
  refreshingTriggerCapabilitiesConnectionId: string | null;
};

type IntegrationWebhookSourceActionsResult = {
  dialog: ReactNode;
  renderWebhookSourceActions: (input: { connectionId: string }) => ReactNode;
};

type IntegrationWebhookSourceActionProvider = {
  id: string;
  useActions: (
    input: IntegrationWebhookSourceActionsInput,
  ) => IntegrationWebhookSourceActionsResult;
};

const WebhookSourceActionProviders = [
  {
    id: "github",
    useActions: useGitHubWebhookSourceActions,
  },
  {
    id: "slack",
    useActions: useSlackWebhookSourceActions,
  },
] satisfies readonly IntegrationWebhookSourceActionProvider[];

export function useIntegrationWebhookSourceActions(
  input: IntegrationWebhookSourceActionsInput,
): IntegrationWebhookSourceActionsResult {
  const providerResults = WebhookSourceActionProviders.map((provider) => ({
    id: provider.id,
    result: provider.useActions(input),
  }));

  return {
    dialog: (
      <>
        {providerResults.map((provider) => (
          <Fragment key={provider.id}>{provider.result.dialog}</Fragment>
        ))}
      </>
    ),
    renderWebhookSourceActions: (actionInput) => {
      const actions = providerResults
        .map((provider) => ({
          id: provider.id,
          node: provider.result.renderWebhookSourceActions(actionInput),
        }))
        .filter((provider) => provider.node !== null);

      if (actions.length === 0) {
        return null;
      }

      return (
        <>
          {actions.map((action) => (
            <Fragment key={action.id}>{action.node}</Fragment>
          ))}
        </>
      );
    },
  };
}
