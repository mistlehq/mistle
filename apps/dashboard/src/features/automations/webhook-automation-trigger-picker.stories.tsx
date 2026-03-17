import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { WebhookAutomationTriggerPicker } from "./webhook-automation-trigger-picker.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

const GitHubEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    value: "github.issue_comment.created",
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
    parameters: [
      {
        id: "repository",
        label: "repository",
        kind: "resource-select",
        resourceKind: "repository",
        payloadPath: ["repository", "full_name"],
        prefix: "in",
      },
    ],
  },
  {
    value: "github.issues.opened",
    label: "Issue opened",
    category: "Issues",
    logoKey: "github",
  },
  {
    value: "github.pull_request.opened",
    label: "Pull request opened",
    category: "Pull requests",
    logoKey: "github",
    parameters: [
      {
        id: "repository",
        label: "repository",
        kind: "resource-select",
        resourceKind: "repository",
        payloadPath: ["repository", "full_name"],
        prefix: "in",
      },
    ],
  },
  {
    value: "github.pull_request_review_comment.created",
    label: "Pull request review comment created",
    category: "Pull requests",
    logoKey: "github",
  },
];

const StoryGithubRepositoryResources: IntegrationConnectionResources = {
  connectionId: "conn_github_prod",
  familyId: "github",
  kind: "repository",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_repo_1",
      familyId: "github",
      kind: "repository",
      externalId: "repo_1",
      handle: "mistlehq/platform",
      displayName: "mistlehq/platform",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_github_repo_2",
      familyId: "github",
      kind: "repository",
      externalId: "repo_2",
      handle: "mistlehq/dashboard",
      displayName: "mistlehq/dashboard",
      status: "accessible",
      metadata: {},
    },
  ],
};

function createWebhookAutomationTriggerPickerStoryQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    ["automation-trigger-parameters", "conn_github_prod", "repository"],
    StoryGithubRepositoryResources,
  );

  return queryClient;
}

function StoryHarness(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventTypes: readonly string[];
  triggerParameterValues?: WebhookAutomationTriggerParameterValueMap;
  eventOptions: readonly WebhookAutomationEventOption[];
  error?: string;
}): React.JSX.Element {
  const [queryClient] = useState(() => createWebhookAutomationTriggerPickerStoryQueryClient());
  const [selectedEventTypes, setSelectedEventTypes] = useState([...input.selectedEventTypes]);
  const [triggerParameterValues, setTriggerParameterValues] = useState(
    input.triggerParameterValues ?? {},
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="max-w-3xl">
        <WebhookAutomationTriggerPicker
          error={input.error}
          eventOptions={input.eventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          onTriggerParameterValueChange={({ eventType, parameterId, value }) => {
            setTriggerParameterValues((currentValues) => ({
              ...currentValues,
              [eventType]: {
                ...(currentValues[eventType] ?? {}),
                [parameterId]: value,
              },
            }));
          }}
          onValueChange={setSelectedEventTypes}
          selectedConnectionId={input.selectedConnectionId}
          selectedEventTypes={selectedEventTypes}
          triggerParameterValues={triggerParameterValues}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Automations/WebhookAutomationTriggerPicker",
  component: StoryHarness,
  decorators: [withDashboardPageWidth],
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: "conn_github_prod",
    selectedEventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
    eventOptions: GitHubEventOptions,
  },
};

export const NoSelection: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: "conn_github_prod",
    selectedEventTypes: [],
    eventOptions: GitHubEventOptions,
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    hasConnectedIntegrations: false,
    selectedConnectionId: "",
    selectedEventTypes: [],
    eventOptions: [],
  },
};

export const NoTriggersAvailable: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: "conn_github_prod",
    selectedEventTypes: [],
    eventOptions: [],
  },
};

export const UnavailableSavedTrigger: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedConnectionId: "conn_github_prod",
    selectedEventTypes: ["github.pull_request.opened", "github.push.deleted"],
    eventOptions: [
      ...GitHubEventOptions,
      {
        value: "github.push.deleted",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        logoKey: "github",
        unavailable: true,
      },
    ],
  },
};
