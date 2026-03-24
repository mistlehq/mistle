import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import {
  WebhookAutomationForm,
  type WebhookAutomationEventOption,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
  type WebhookAutomationFormValueKey,
} from "./webhook-automation-form.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-list-helpers.js";

const GitHubConnectionId = "conn_github_prod";
const StripeConnectionId = "conn_stripe_prod";
const IssueCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.issue_comment.created",
});
const PullRequestOpenedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.pull_request.opened",
});
const StripePayoutFailedTriggerId = createWebhookAutomationTriggerId({
  connectionId: StripeConnectionId,
  eventType: "stripe.payout.failed",
});

const ConnectionOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: GitHubConnectionId,
    label: "GitHub Engineering",
    description: "github-cloud",
  },
  {
    value: StripeConnectionId,
    label: "Stripe Production",
    description: "stripe-default",
  },
];

const SandboxProfileOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: "sbp_repo_maintainer",
    label: "Repo Maintainer",
    description: "Latest version pinned at runtime",
  },
  {
    value: "sbp_finance_investigator",
    label: "Finance Investigator",
    description: "Version 12 available",
  },
];

const StoryGithubRepositoryResources: IntegrationConnectionResources = {
  connectionId: GitHubConnectionId,
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

const StoryGithubBranchResources: IntegrationConnectionResources = {
  connectionId: GitHubConnectionId,
  familyId: "github",
  kind: "branch",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_branch_1",
      familyId: "github",
      kind: "branch",
      externalId: "repo_1:main",
      handle: "main",
      displayName: "main",
      status: "accessible",
      metadata: {
        repositoryFullName: "mistlehq/platform",
      },
    },
    {
      id: "icr_github_branch_2",
      familyId: "github",
      kind: "branch",
      externalId: "repo_1:release",
      handle: "release",
      displayName: "release",
      status: "accessible",
      metadata: {
        repositoryFullName: "mistlehq/platform",
      },
    },
  ],
};

const StoryGithubUserResources: IntegrationConnectionResources = {
  connectionId: GitHubConnectionId,
  familyId: "github",
  kind: "user",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_user_1",
      familyId: "github",
      kind: "user",
      externalId: "1001",
      handle: "octocat",
      displayName: "octocat",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_github_user_2",
      familyId: "github",
      kind: "user",
      externalId: "1002",
      handle: "hubot",
      displayName: "hubot",
      status: "accessible",
      metadata: {},
    },
  ],
};

function createWebhookAutomationStoryQueryClient(): QueryClient {
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
  queryClient.setQueryData(
    ["automation-trigger-parameters", GitHubConnectionId, "branch"],
    StoryGithubBranchResources,
  );
  queryClient.setQueryData(
    ["automation-trigger-parameters", GitHubConnectionId, "user"],
    StoryGithubUserResources,
  );

  return queryClient;
}

const GitHubWebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    id: IssueCommentCreatedTriggerId,
    eventType: "github.issue_comment.created",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Issue comment created",
    category: "GitHub Engineering / Issues",
    logoKey: "github",
    parameters: [
      {
        id: "target",
        label: "comment target",
        kind: "enum-select",
        payloadPath: ["issue", "pull_request"],
        matchMode: "exists",
        options: [
          {
            value: "exists",
            label: "pull request",
          },
          {
            value: "not_exists",
            label: "issue",
          },
        ],
        prefix: "in",
        placeholder: "Any comment target",
      },
      {
        id: "commenter",
        label: "commenter",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["sender", "login"],
        prefix: "by",
        placeholder: "Any commenter",
      },
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
    id: createWebhookAutomationTriggerId({
      connectionId: GitHubConnectionId,
      eventType: "github.issue.opened",
    }),
    eventType: "github.issue.opened",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Issue opened",
    category: "GitHub Engineering / Issues",
    logoKey: "github",
  },
  {
    id: PullRequestOpenedTriggerId,
    eventType: "github.pull_request.opened",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Pull request opened",
    category: "GitHub Engineering / Pull requests",
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
      {
        id: "author",
        label: "author",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["sender", "login"],
        prefix: "by",
        placeholder: "Any author",
      },
      {
        id: "baseBranch",
        label: "base branch",
        kind: "resource-select",
        resourceKind: "branch",
        payloadPath: ["pull_request", "base", "ref"],
        prefix: "to",
        placeholder: "Any base branch",
      },
    ],
  },
  {
    id: createWebhookAutomationTriggerId({
      connectionId: GitHubConnectionId,
      eventType: "github.pull_request_review_comment.created",
    }),
    eventType: "github.pull_request_review_comment.created",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Pull request review comment created",
    category: "GitHub Engineering / Pull requests",
    logoKey: "github",
  },
];

const EmptyCreateValues: WebhookAutomationFormValues = {
  name: "",
  sandboxProfileId: "",
  enabled: true,
  instructions: "",
  conversationKeyTemplate: "",
  triggerIds: [],
  triggerParameterValues: {},
};

const ExistingAutomationValues: WebhookAutomationFormValues = {
  name: "GitHub pushes to repo triage",
  sandboxProfileId: "sbp_repo_maintainer",
  enabled: true,
  instructions: "Please review the changes made.",
  conversationKeyTemplate: "{{payload.repository.full_name}}:{{payload.ref}}",
  triggerIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
  triggerParameterValues: {
    [PullRequestOpenedTriggerId]: {
      repository: "mistlehq/platform",
      author: "octocat",
      baseBranch: "main",
    },
    [IssueCommentCreatedTriggerId]: {
      target: "exists",
      commenter: "hubot",
    },
  },
};

function StoryHarness(input: {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  fieldErrors?: Partial<Record<WebhookAutomationFormValueKey, string>>;
  formError?: string | null;
  isSaving?: boolean;
  isDeleting?: boolean;
  onDelete?: (() => void) | null;
  connectionOptions?: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions?: readonly WebhookAutomationFormOption[];
  webhookEventOptions?: readonly WebhookAutomationEventOption[];
}): React.JSX.Element {
  const [queryClient] = useState(() => createWebhookAutomationStoryQueryClient());
  const [values, setValues] = useState(input.values);

  return (
    <QueryClientProvider client={queryClient}>
      <WebhookAutomationForm
        connectionOptions={input.connectionOptions ?? ConnectionOptions}
        fieldErrors={input.fieldErrors ?? {}}
        formError={input.formError ?? null}
        isDeleting={input.isDeleting ?? false}
        isSaving={input.isSaving ?? false}
        mode={input.mode}
        onDelete={input.onDelete ?? null}
        onSubmit={function onSubmit() {}}
        onValueChange={(key, value) => {
          setValues((currentValues) => ({
            ...currentValues,
            [key]: value,
          }));
        }}
        sandboxProfileOptions={input.sandboxProfileOptions ?? SandboxProfileOptions}
        webhookEventOptions={input.webhookEventOptions ?? GitHubWebhookEventOptions}
        values={values}
      />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Automations/WebhookAutomationForm",
  component: StoryHarness,
  decorators: [withDashboardPageWidth],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Create: Story = {
  args: {
    mode: "create",
    values: EmptyCreateValues,
  },
};

export const Edit: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: {
      ...ExistingAutomationValues,
      enabled: false,
      triggerIds: [StripePayoutFailedTriggerId],
      name: "Stripe payouts incident intake",
      sandboxProfileId: "sbp_finance_investigator",
      triggerParameterValues: {},
    },
    webhookEventOptions: [
      {
        id: StripePayoutFailedTriggerId,
        eventType: "stripe.payout.failed",
        connectionId: StripeConnectionId,
        connectionLabel: "Stripe Production",
        label: "Payout failed",
        category: "Stripe Production / Payouts",
        logoKey: "stripe",
      },
    ],
  },
};

export const ValidationErrors: Story = {
  args: {
    mode: "create",
    formError: "The selected triggers do not support this automation setup.",
    fieldErrors: {
      name: "Automation name is required.",
      triggerIds: "Select at least one trigger.",
      sandboxProfileId: "Choose a sandbox profile for the automation target.",
      instructions: "Instructions are required.",
    },
    values: {
      ...EmptyCreateValues,
    },
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    mode: "create",
    connectionOptions: [],
    formError: "Create an integration connection before you configure an automation.",
    values: EmptyCreateValues,
    webhookEventOptions: [],
  },
};

export const Saving: Story = {
  args: {
    mode: "edit",
    isDeleting: false,
    isSaving: true,
    onDelete: function onDelete() {},
    values: ExistingAutomationValues,
  },
};

export const NoTriggersAvailable: Story = {
  args: {
    mode: "create",
    values: EmptyCreateValues,
    webhookEventOptions: [],
  },
};

export const UnavailableSavedEvent: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: {
      ...ExistingAutomationValues,
      triggerIds: [
        IssueCommentCreatedTriggerId,
        createWebhookAutomationTriggerId({
          connectionId: GitHubConnectionId,
          eventType: "github.push.deleted",
        }),
      ],
      triggerParameterValues: {},
    },
    webhookEventOptions: [
      ...GitHubWebhookEventOptions,
      {
        id: createWebhookAutomationTriggerId({
          connectionId: GitHubConnectionId,
          eventType: "github.push.deleted",
        }),
        eventType: "github.push.deleted",
        connectionId: GitHubConnectionId,
        connectionLabel: "GitHub Engineering",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        logoKey: "github",
        unavailable: true,
      },
    ],
  },
};
