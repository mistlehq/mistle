import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { PageFrame } from "../shared/page-frame.js";
import type { AutomationFormShellStatusMessage } from "./automation-form-shell.js";
import { AutomationTypeDisplayField, AutomationTypeSelectField } from "./automation-type-field.js";
import { validateWebhookAutomationFormValues } from "./webhook-automation-form-helpers.js";
import {
  WebhookAutomationForm,
  type WebhookAutomationEventOption,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
  type WebhookAutomationFormValueKey,
} from "./webhook-automation-form.js";
import { DefaultWebhookAutomationMessageTemplate } from "./webhook-automation-input-template.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import { createGitHubEventOption } from "./webhook-automation-test-fixtures.js";
import type { WebhookAutomationTriggerPickerDisabledState } from "./webhook-automation-trigger-picker-state.js";

const GitHubConnectionId = "conn_github_prod";
const GitHubWebhookSourceId = "iws_github_prod";
const SlackConnectionId = "conn_slack_prod";
const SlackWebhookSourceId = "iws_slack_prod";
const StripeConnectionId = "conn_stripe_prod";
const IssueCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
const PullRequestOpenedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.opened",
});
const PullRequestReviewSubmittedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request_review.submitted",
});
const PushDeletedTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.push.deleted",
});
const SlackAppMentionTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: SlackWebhookSourceId,
  eventType: "slack:app_mention",
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
  {
    value: SlackConnectionId,
    label: "Slack Engineering",
    description: "slack-default",
  },
];

const SandboxProfileOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: "sbp_repo_maintainer",
    label: "Repo Maintainer",
  },
  {
    value: "sbp_finance_investigator",
    label: "Finance Investigator",
  },
];

const PrimaryRepositoryOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: "__workspace_root__",
    label: "None",
    path: "workspace root",
  },
  {
    value: "mistlehq/platform",
    label: "mistlehq/platform",
    path: "/root/mistlehq/platform",
  },
  {
    value: "mistlehq/dashboard",
    label: "mistlehq/dashboard",
    path: "/root/mistlehq/dashboard",
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

const StorySlackChannelResources: IntegrationConnectionResources = {
  connectionId: SlackConnectionId,
  familyId: "slack",
  kind: "channel",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_slack_channel_1",
      familyId: "slack",
      kind: "channel",
      externalId: "C_ALERTS_001",
      handle: "C_ALERTS_001",
      displayName: "#alerts",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_slack_channel_2",
      familyId: "slack",
      kind: "channel",
      externalId: "C_ENG_001",
      handle: "C_ENG_001",
      displayName: "#engineering",
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
  queryClient.setQueryData(
    ["automation-trigger-parameters", SlackConnectionId, "channel"],
    StorySlackChannelResources,
  );

  return queryClient;
}

const GitHubWebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  createGitHubEventOption({
    eventType: "github.issue_comment.created",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: IssueCommentCreatedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.issues.opened",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
  }),
  createGitHubEventOption({
    eventType: "github.pull_request.opened",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: PullRequestOpenedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review.submitted",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: PullRequestReviewSubmittedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review_comment.created",
    connectionId: GitHubConnectionId,
    webhookSourceId: GitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
  }),
];

export const SlackWebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    id: SlackAppMentionTriggerId,
    eventType: "slack:app_mention",
    integrationWebhookSourceId: SlackWebhookSourceId,
    connectionId: SlackConnectionId,
    connectionLabel: "Slack Engineering",
    label: "App mention",
    category: "Slack Engineering / Messages",
    logoKey: "slack",
    parameters: [
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
      },
    ],
  },
];

const EmptyCreateValues: WebhookAutomationFormValues = {
  name: "",
  sandboxProfileId: "",
  primaryRepositoryId: "",
  enabled: true,
  inputTemplate: DefaultWebhookAutomationMessageTemplate,
  instructions: "",
  conversationKeyTemplate: "",
  triggerIds: [],
  triggerParameterValues: {},
};

const ExistingAutomationValues: WebhookAutomationFormValues = {
  name: "GitHub pushes to repo triage",
  sandboxProfileId: "sbp_repo_maintainer",
  primaryRepositoryId: "mistlehq/platform",
  enabled: true,
  inputTemplate: [
    "Please review the changes made.",
    "",
    "Event type: {{webhookEvent.eventType}}",
    "Payload:",
    "{{payload}}",
  ].join("\n"),
  instructions: "Keep the response concise and include a short risk summary.",
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

export const ExistingSlackAutomationValues: WebhookAutomationFormValues = {
  name: "Slack mention triage",
  sandboxProfileId: "sbp_repo_maintainer",
  primaryRepositoryId: "mistlehq/platform",
  enabled: true,
  inputTemplate: [
    "Investigate this Slack mention.",
    "",
    "Event type: {{webhookEvent.eventType}}",
    "Payload:",
    "{{payload}}",
  ].join("\n"),
  instructions: "Reply with the root cause and the next recommended action.",
  conversationKeyTemplate: "slack:channel:{{payload.event.channel}}",
  triggerIds: [SlackAppMentionTriggerId],
  triggerParameterValues: {
    [SlackAppMentionTriggerId]: {
      channel: "C_ALERTS_001",
    },
  },
};

const ExistingSlackAutomationWithArchivedChannelValues: WebhookAutomationFormValues = {
  ...ExistingSlackAutomationValues,
  triggerParameterValues: {
    [SlackAppMentionTriggerId]: {
      channel: "C_ARCHIVED_001",
    },
  },
};

export function WebhookAutomationFormStoryHarness(input: {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  fieldErrors?: Partial<Record<WebhookAutomationFormValueKey, string>>;
  validationSummaryError?: string | null;
  formError?: string | null;
  isSaving?: boolean;
  isDeleting?: boolean;
  onDelete?: (() => void) | null;
  triggerPickerDisabledState?: WebhookAutomationTriggerPickerDisabledState | null;
  connectionOptions?: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions?: readonly WebhookAutomationFormOption[];
  sandboxProfileStatusMessage?: AutomationFormShellStatusMessage | undefined;
  primaryRepositoryOptions?: readonly WebhookAutomationFormOption[];
  webhookEventOptions?: readonly WebhookAutomationEventOption[];
  enableSubmitValidation?: boolean;
  automationTypeField?: ReactNode;
}): React.JSX.Element {
  const [queryClient] = useState(() => createWebhookAutomationStoryQueryClient());
  const [values, setValues] = useState(input.values);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<WebhookAutomationFormValueKey, string>>
  >({
    ...(input.fieldErrors ?? {}),
  });
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(
    input.validationSummaryError ?? null,
  );
  const pageTitle = input.mode === "create" ? "Create trigger" : "";
  const automationTypeField =
    input.automationTypeField ??
    (input.mode === "create" ? (
      <AutomationTypeSelectField value="trigger" />
    ) : (
      <AutomationTypeDisplayField value="trigger" />
    ));

  return (
    <QueryClientProvider client={queryClient}>
      <PageFrame width="form" title={pageTitle}>
        <WebhookAutomationForm
          connectionOptions={input.connectionOptions ?? ConnectionOptions}
          fieldErrors={fieldErrors}
          formError={input.formError ?? null}
          validationSummaryError={validationSummaryError}
          isDeleting={input.isDeleting ?? false}
          isSaving={input.isSaving ?? false}
          automationTypeField={automationTypeField}
          mode={input.mode}
          onDelete={input.onDelete ?? null}
          onSubmit={() => {
            if (input.enableSubmitValidation !== true) {
              return;
            }

            const nextFieldErrors = validateWebhookAutomationFormValues(
              values,
              input.webhookEventOptions ?? GitHubWebhookEventOptions,
            );
            setFieldErrors(nextFieldErrors);
            setValidationSummaryError(
              Object.keys(nextFieldErrors).length > 0
                ? "Please address the fields highlighted in red."
                : null,
            );
          }}
          onValueChange={(key, value) => {
            setValues((currentValues) => ({
              ...currentValues,
              [key]: value,
            }));
            if (input.enableSubmitValidation === true) {
              setFieldErrors({});
              setValidationSummaryError(null);
            }
          }}
          {...(input.primaryRepositoryOptions === undefined
            ? {}
            : { primaryRepositoryOptions: input.primaryRepositoryOptions })}
          {...(input.sandboxProfileStatusMessage === undefined
            ? {}
            : { sandboxProfileStatusMessage: input.sandboxProfileStatusMessage })}
          sandboxProfileOptions={input.sandboxProfileOptions ?? SandboxProfileOptions}
          triggerPickerDisabledState={input.triggerPickerDisabledState ?? null}
          webhookEventOptions={input.webhookEventOptions ?? GitHubWebhookEventOptions}
          values={values}
        />
      </PageFrame>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Triggers/Event/Form",
  component: WebhookAutomationFormStoryHarness,
  decorators: [withDashboardPageStory],
  excludeStories: [
    "ExistingSlackAutomationValues",
    "SlackWebhookEventOptions",
    "WebhookAutomationFormStoryHarness",
  ],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof WebhookAutomationFormStoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CreatePageLayout: Story = {
  args: {
    mode: "create",
    triggerPickerDisabledState: {
      reason: "Select a sandbox profile to choose events.",
      variant: "default",
    },
    values: EmptyCreateValues,
  },
};

export const EditPageLayout: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: ExistingAutomationValues,
  },
};

export const ValidationErrors: Story = {
  args: {
    mode: "create",
    validationSummaryError: "Please address the fields highlighted in red.",
    fieldErrors: {
      triggerIds: "Please add an event",
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

export const NoEventCapableIntegrations: Story = {
  args: {
    mode: "create",
    triggerPickerDisabledState: {
      reason:
        "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
      variant: "default",
    },
    values: {
      ...EmptyCreateValues,
      sandboxProfileId: "sbp_repo_maintainer",
    },
    webhookEventOptions: [],
  },
};

export const NoActiveProfileVersion: Story = {
  args: {
    mode: "create",
    sandboxProfileStatusMessage: {
      message:
        "The sandbox profile Repo Maintainer has no active version. Publish the profile before creating triggers.",
      variant: "alert",
    },
    triggerPickerDisabledState: {
      reason: "Select a sandbox profile with an active version to choose events.",
      variant: "default",
    },
    values: {
      ...EmptyCreateValues,
      sandboxProfileId: "sbp_repo_maintainer",
    },
    webhookEventOptions: [],
  },
};

export const WithPrimaryRepositorySelection: Story = {
  args: {
    mode: "create",
    primaryRepositoryOptions: PrimaryRepositoryOptions,
    values: {
      ...EmptyCreateValues,
      sandboxProfileId: "sbp_repo_maintainer",
      primaryRepositoryId: "mistlehq/platform",
    },
  },
};

export const WithWorkspaceRootSelection: Story = {
  args: {
    mode: "create",
    primaryRepositoryOptions: PrimaryRepositoryOptions,
    values: {
      ...EmptyCreateValues,
      sandboxProfileId: "sbp_repo_maintainer",
      primaryRepositoryId: "__workspace_root__",
    },
  },
};

export const LoadingProfileBindings: Story = {
  args: {
    mode: "create",
    triggerPickerDisabledState: {
      reason: "Loading profile bindings...",
      variant: "default",
    },
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
    triggerPickerDisabledState: {
      reason: "Could not load profile bindings.",
      variant: "alert",
    },
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
        integrationWebhookSourceId: GitHubWebhookSourceId,
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
      triggerIds: "Event is unavailable for the selected sandbox profile.",
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
        description: "Event is unavailable for the selected sandbox profile.",
      },
    ],
  },
};

export const SlackAppMentionChannelOnly: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: ExistingSlackAutomationValues,
    webhookEventOptions: SlackWebhookEventOptions,
  },
};

export const SlackUnavailableArchivedChannelSelection: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: ExistingSlackAutomationWithArchivedChannelValues,
    webhookEventOptions: SlackWebhookEventOptions,
  },
};
