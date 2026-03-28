import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { FormPageShell } from "../shared/form-page.js";
import {
  WebhookAutomationForm,
  type WebhookAutomationEventOption,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
  type WebhookAutomationFormValueKey,
} from "./webhook-automation-form.js";
import { DefaultWebhookAutomationInputTemplate } from "./webhook-automation-input-template.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";

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
const PullRequestReviewSubmittedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.pull_request_review.submitted",
});
const PushDeletedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.push.deleted",
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
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["comment", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
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
      eventType: "github.issues.opened",
    }),
    eventType: "github.issues.opened",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Issue opened",
    category: "GitHub Engineering / Issues",
    logoKey: "github",
    parameters: [
      {
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["issue", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
    ],
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
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["pull_request", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
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
    id: PullRequestReviewSubmittedTriggerId,
    eventType: "github.pull_request_review.submitted",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Pull request review submitted",
    category: "GitHub Engineering / Pull requests",
    logoKey: "github",
    parameters: [
      {
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["review", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
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
    parameters: [
      {
        id: "explicitInvocation",
        label: "explicit mention",
        kind: "string",
        payloadPath: ["comment", "body"],
        matchMode: "contains_token",
        defaultValue: "@mistlebot",
        defaultEnabled: true,
        controlVariant: "explicit-invocation",
        placeholder: 'Require "@mistlebot"',
      },
    ],
  },
];

const EmptyCreateValues: WebhookAutomationFormValues = {
  name: "",
  sandboxProfileId: "",
  enabled: true,
  inputTemplate: DefaultWebhookAutomationInputTemplate,
  conversationKeyTemplate: "",
  triggerIds: [],
  triggerParameterValues: {},
};

const ExistingAutomationValues: WebhookAutomationFormValues = {
  name: "GitHub pushes to repo triage",
  sandboxProfileId: "sbp_repo_maintainer",
  enabled: true,
  inputTemplate: [
    "Please review the changes made.",
    "",
    "Event type: {{webhookEvent.eventType}}",
    "Payload:",
    "{{payload}}",
  ].join("\n"),
  conversationKeyTemplate: "{{payload.repository.full_name}}:{{payload.ref}}",
  triggerIds: [PullRequestOpenedTriggerId],
  triggerParameterValues: {
    [PullRequestOpenedTriggerId]: {
      repository: "mistlehq/platform",
      author: "octocat",
      baseBranch: "main",
    },
  },
};

function StoryHarness(input: {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  fieldErrors?: Partial<Record<WebhookAutomationFormValueKey, string>>;
  validationSummaryError?: string | null;
  formError?: string | null;
  isSaving?: boolean;
  isDeleting?: boolean;
  onDelete?: (() => void) | null;
  triggerPickerDisabledReason?: string | null;
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
        validationSummaryError={input.validationSummaryError ?? null}
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
        triggerPickerDisabledReason={input.triggerPickerDisabledReason ?? null}
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

export const CreatePageLayout: Story = {
  args: {
    mode: "create",
    triggerPickerDisabledReason: "Select a sandbox profile to choose triggers.",
    values: EmptyCreateValues,
  },
  render: function RenderStory(args): React.JSX.Element {
    return (
      <FormPageShell>
        <StoryHarness {...args} />
      </FormPageShell>
    );
  },
};

export const EditPageLayout: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: ExistingAutomationValues,
  },
  render: function RenderStory(args): React.JSX.Element {
    return (
      <FormPageShell>
        <StoryHarness {...args} />
      </FormPageShell>
    );
  },
};

export const ValidationErrors: Story = {
  args: {
    mode: "create",
    validationSummaryError: "Please address the fields highlighted in red.",
    fieldErrors: {
      triggerIds: "Select at least one trigger.",
      name: "Required field.",
      sandboxProfileId: "Required field.",
      inputTemplate: "Required field.",
    },
    values: {
      ...EmptyCreateValues,
      inputTemplate: "",
    },
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    mode: "create",
    connectionOptions: [],
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
    triggerPickerDisabledReason: "The selected profile has no bindings with automation triggers.",
    values: {
      ...EmptyCreateValues,
      sandboxProfileId: "sbp_repo_maintainer",
    },
    webhookEventOptions: [],
  },
};

export const LoadingProfileBindings: Story = {
  args: {
    mode: "create",
    triggerPickerDisabledReason: "Loading profile bindings...",
    values: {
      ...EmptyCreateValues,
      sandboxProfileId: "sbp_repo_maintainer",
    },
    webhookEventOptions: [],
  },
};

export const ProfileBindingsLoadFailure: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    triggerPickerDisabledReason: "Could not load profile bindings.",
    values: ExistingAutomationValues,
  },
};

export const UnavailableSavedEvent: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: {
      ...ExistingAutomationValues,
      triggerIds: [PushDeletedTriggerId],
      triggerParameterValues: {},
    },
    webhookEventOptions: [
      ...GitHubWebhookEventOptions,
      {
        id: PushDeletedTriggerId,
        eventType: "github.push.deleted",
        connectionId: GitHubConnectionId,
        connectionLabel: "GitHub Engineering",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        logoKey: "github",
        availability: "missing_integration",
      },
    ],
  },
};

export const WrongProfileSavedEvent: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    fieldErrors: {
      triggerIds: "Trigger is unavailable for the selected sandbox profile.",
    },
    values: {
      ...ExistingAutomationValues,
      sandboxProfileId: "sbp_finance_investigator",
      triggerIds: [IssueCommentCreatedTriggerId],
      triggerParameterValues: {},
    },
    webhookEventOptions: [
      {
        ...GitHubWebhookEventOptions[0]!,
        availability: "wrong_profile",
        description: "Trigger is unavailable for the selected sandbox profile.",
      },
    ],
  },
};
