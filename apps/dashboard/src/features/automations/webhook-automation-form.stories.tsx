import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { FormPageFrame } from "../shared/page-frame.js";
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
import type { WebhookAutomationTriggerPickerDisabledState } from "./webhook-automation-trigger-picker.js";

const GitHubConnectionId = "conn_github_prod";
const GitHubWebhookSourceId = "iws_github_prod";
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
  },
  {
    value: "sbp_finance_investigator",
    label: "Finance Investigator",
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
    integrationWebhookSourceId: GitHubWebhookSourceId,
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
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issues.opened",
    }),
    eventType: "github.issues.opened",
    integrationWebhookSourceId: GitHubWebhookSourceId,
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
    integrationWebhookSourceId: GitHubWebhookSourceId,
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
    integrationWebhookSourceId: GitHubWebhookSourceId,
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
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.pull_request_review_comment.created",
    }),
    eventType: "github.pull_request_review_comment.created",
    integrationWebhookSourceId: GitHubWebhookSourceId,
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
  inputTemplate: DefaultWebhookAutomationMessageTemplate,
  conversationKeyTemplate: "",
  triggerIds: [],
  triggerParameterValues: {},
};

const ExistingAutomationValues: WebhookAutomationFormValues = {
  name: "GitHub pushes to repo triage",
  sandboxProfileId: "sbp_repo_maintainer",
  enabled: true,
  inputTemplate: ["Event type: {{webhookEvent.eventType}}", "Payload: {{payload}}"].join("\n"),
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
  triggerPickerDisabledState?: WebhookAutomationTriggerPickerDisabledState | null;
  connectionOptions?: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions?: readonly WebhookAutomationFormOption[];
  webhookEventOptions?: readonly WebhookAutomationEventOption[];
  enableSubmitValidation?: boolean;
  validateOnMount?: boolean;
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
  const pageTitle = input.mode === "create" ? "Create automation" : "";

  useEffect(() => {
    if (input.validateOnMount !== true) {
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
  }, [input.validateOnMount, input.webhookEventOptions, values]);

  return (
    <QueryClientProvider client={queryClient}>
      <FormPageFrame title={pageTitle}>
        <WebhookAutomationForm
          connectionOptions={input.connectionOptions ?? ConnectionOptions}
          fieldErrors={fieldErrors}
          formError={input.formError ?? null}
          validationSummaryError={validationSummaryError}
          isDeleting={input.isDeleting ?? false}
          isSaving={input.isSaving ?? false}
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
          sandboxProfileOptions={input.sandboxProfileOptions ?? SandboxProfileOptions}
          triggerPickerDisabledState={input.triggerPickerDisabledState ?? null}
          webhookEventOptions={input.webhookEventOptions ?? GitHubWebhookEventOptions}
          values={values}
        />
      </FormPageFrame>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Automations/WebhookAutomation/Form",
  component: StoryHarness,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CreatePageLayout: Story = {
  args: {
    mode: "create",
    triggerPickerDisabledState: {
      reason: "Select a sandbox profile to choose triggers.",
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
      triggerIds: "Please add a trigger",
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

export const PlaceholderInstructionsValidation: Story = {
  args: {
    mode: "create",
    enableSubmitValidation: true,
    validateOnMount: true,
    values: {
      ...EmptyCreateValues,
      name: "Review pull requests",
      sandboxProfileId: "sbp_repo_maintainer",
      triggerIds: [PullRequestOpenedTriggerId],
      conversationKeyTemplate:
        "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
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
    triggerPickerDisabledState: {
      reason: "The selected profile has no bindings with automation triggers.",
      variant: "default",
    },
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
