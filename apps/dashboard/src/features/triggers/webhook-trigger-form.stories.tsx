import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { PageFrame } from "../shared/page-frame.js";
import type { TriggerFormShellStatusMessage } from "./trigger-form-shell.js";
import { TriggerTypeDisplayField, TriggerTypeSelectField } from "./trigger-type-field.js";
import type { WebhookTriggerEventPickerDisabledState } from "./webhook-trigger-event-picker-state.js";
import { validateWebhookTriggerFormValues } from "./webhook-trigger-form-helpers.js";
import {
  WebhookTriggerForm,
  type WebhookTriggerEventOption,
  type WebhookTriggerFormOption,
  type WebhookTriggerFormValues,
  type WebhookTriggerFormValueKey,
} from "./webhook-trigger-form.js";
import { DefaultWebhookTriggerMessageTemplate } from "./webhook-trigger-input-template.js";
import {
  createWebhookTriggerStoryQueryClient,
  isNotRule,
  isRule,
  StoryGitHubConnectionId,
  StoryGitHubEventOptions,
  StoryGitHubWebhookSourceId,
  StoryIssueCommentCreatedTriggerId,
  StoryPullRequestOpenedTriggerId,
  StoryPullRequestReviewRequestedTriggerId,
  StoryPushDeletedTriggerId,
  StorySlackAppMentionTriggerId,
  StorySlackConnectionId,
  StorySlackEventOptions,
} from "./webhook-trigger-story-fixtures.js";

const StripeConnectionId = "conn_stripe_prod";

const ConnectionOptions: readonly WebhookTriggerFormOption[] = [
  {
    value: StoryGitHubConnectionId,
    label: "GitHub Engineering",
    description: "github-cloud",
  },
  {
    value: StripeConnectionId,
    label: "Stripe Production",
    description: "stripe-default",
  },
  {
    value: StorySlackConnectionId,
    label: "Slack Engineering",
    description: "slack-default",
  },
];

const SandboxProfileOptions: readonly WebhookTriggerFormOption[] = [
  {
    value: "sbp_repo_maintainer",
    label: "Repo Maintainer v3",
  },
  {
    value: "sbp_finance_investigator",
    label: "Finance Investigator v2",
  },
];

const PrimaryRepositoryOptions: readonly WebhookTriggerFormOption[] = [
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

export const SlackWebhookEventOptions: readonly WebhookTriggerEventOption[] =
  StorySlackEventOptions;

const EmptyCreateValues: WebhookTriggerFormValues = {
  name: "",
  sandboxProfileId: "",
  primaryRepositoryId: "",
  enabled: true,
  inputTemplate: DefaultWebhookTriggerMessageTemplate,
  instructions: "",
  conversationKeyTemplate: "",
  eventIds: [],
  eventParameterRules: {},
};

const ExistingTriggerValues: WebhookTriggerFormValues = {
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
  eventIds: [StoryPullRequestOpenedTriggerId],
  eventParameterRules: {
    [StoryPullRequestOpenedTriggerId]: {
      repository: isRule("mistlehq/platform"),
      author: isRule("octocat"),
      baseBranch: isRule("main"),
    },
  },
};

export const ExistingSlackTriggerValues: WebhookTriggerFormValues = {
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
  eventIds: [StorySlackAppMentionTriggerId],
  eventParameterRules: {
    [StorySlackAppMentionTriggerId]: {
      channel: isRule("C_ALERTS_001"),
    },
  },
};

const ExistingSlackTriggerWithArchivedChannelValues: WebhookTriggerFormValues = {
  ...ExistingSlackTriggerValues,
  eventParameterRules: {
    [StorySlackAppMentionTriggerId]: {
      channel: isRule("C_ARCHIVED_001"),
    },
  },
};

const ExistingTriggerWithExcludedAuthorValues: WebhookTriggerFormValues = {
  ...ExistingTriggerValues,
  eventParameterRules: {
    [StoryPullRequestOpenedTriggerId]: {
      repository: isRule("mistlehq/platform"),
      author: isNotRule("dependabot"),
      baseBranch: isRule("main"),
    },
  },
};

const ExistingReviewRequestTeamTriggerValues: WebhookTriggerFormValues = {
  ...ExistingTriggerValues,
  name: "GitHub team review intake",
  conversationKeyTemplate:
    "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
  eventIds: [StoryPullRequestReviewRequestedTriggerId],
  eventParameterRules: {
    [StoryPullRequestReviewRequestedTriggerId]: {
      requestedTeam: isRule("platform"),
    },
  },
};

export function WebhookTriggerFormStoryHarness(input: {
  mode: "create" | "edit";
  values: WebhookTriggerFormValues;
  fieldErrors?: Partial<Record<WebhookTriggerFormValueKey, string>>;
  validationSummaryError?: string | null;
  formError?: string | null;
  isSaving?: boolean;
  isDeleting?: boolean;
  onDelete?: (() => void) | null;
  triggerPickerDisabledState?: WebhookTriggerEventPickerDisabledState | null;
  connectionOptions?: readonly WebhookTriggerFormOption[];
  sandboxProfileOptions?: readonly WebhookTriggerFormOption[];
  sandboxProfileStatusMessage?: TriggerFormShellStatusMessage | undefined;
  primaryRepositoryOptions?: readonly WebhookTriggerFormOption[];
  webhookEventOptions?: readonly WebhookTriggerEventOption[];
  enableSubmitValidation?: boolean;
  triggerTypeField?: ReactNode;
}): React.JSX.Element {
  const [queryClient] = useState(() => createWebhookTriggerStoryQueryClient());
  const [values, setValues] = useState(input.values);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<WebhookTriggerFormValueKey, string>>
  >({
    ...(input.fieldErrors ?? {}),
  });
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(
    input.validationSummaryError ?? null,
  );
  const pageTitle = input.mode === "create" ? "Create trigger" : "";
  const triggerTypeField =
    input.triggerTypeField ??
    (input.mode === "create" ? (
      <TriggerTypeSelectField value="trigger" />
    ) : (
      <TriggerTypeDisplayField value="trigger" />
    ));

  return (
    <QueryClientProvider client={queryClient}>
      <PageFrame width="form" title={pageTitle}>
        <WebhookTriggerForm
          connectionOptions={input.connectionOptions ?? ConnectionOptions}
          fieldErrors={fieldErrors}
          formError={input.formError ?? null}
          validationSummaryError={validationSummaryError}
          isDeleting={input.isDeleting ?? false}
          isSaving={input.isSaving ?? false}
          triggerTypeField={triggerTypeField}
          mode={input.mode}
          onDelete={input.onDelete ?? null}
          onSubmit={() => {
            if (input.enableSubmitValidation !== true) {
              return;
            }

            const nextFieldErrors = validateWebhookTriggerFormValues(
              values,
              input.webhookEventOptions ?? StoryGitHubEventOptions,
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
          webhookEventOptions={input.webhookEventOptions ?? StoryGitHubEventOptions}
          values={values}
        />
      </PageFrame>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Triggers/Event/Form",
  component: WebhookTriggerFormStoryHarness,
  decorators: [withDashboardPageStory],
  excludeStories: [
    "ExistingSlackTriggerValues",
    "SlackWebhookEventOptions",
    "WebhookTriggerFormStoryHarness",
  ],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof WebhookTriggerFormStoryHarness>;

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
    values: ExistingTriggerValues,
  },
};

export const EditPageWithExcludedAuthor: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: ExistingTriggerWithExcludedAuthorValues,
  },
};

export const EditPageWithReviewRequestTeamTarget: Story = {
  name: "Edit page with GitHub review request team target",
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: ExistingReviewRequestTeamTriggerValues,
  },
};

export const ValidationErrors: Story = {
  args: {
    mode: "create",
    validationSummaryError: "Please address the fields highlighted in red.",
    fieldErrors: {
      eventIds: "Please add an event",
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

export const NoTriggerEventsAvailable: Story = {
  args: {
    mode: "create",
    connectionOptions: ConnectionOptions,
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
    values: ExistingTriggerValues,
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
    values: ExistingTriggerValues,
  },
};

export const UnavailableSavedEvent: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: {
      ...ExistingTriggerValues,
      eventIds: [StoryPushDeletedTriggerId],
      eventParameterRules: {},
    },
    webhookEventOptions: [
      ...StoryGitHubEventOptions,
      {
        id: StoryPushDeletedTriggerId,
        eventType: "github.push.deleted",
        integrationWebhookSourceId: StoryGitHubWebhookSourceId,
        connectionId: StoryGitHubConnectionId,
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
      eventIds: "Event is unavailable for the selected sandbox profile.",
    },
    values: {
      ...ExistingTriggerValues,
      sandboxProfileId: "sbp_finance_investigator",
      eventIds: [StoryIssueCommentCreatedTriggerId],
      eventParameterRules: {},
    },
    webhookEventOptions: [
      {
        ...StoryGitHubEventOptions[0]!,
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
    values: ExistingSlackTriggerValues,
    webhookEventOptions: SlackWebhookEventOptions,
  },
};

export const SlackUnavailableArchivedChannelSelection: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: ExistingSlackTriggerWithArchivedChannelValues,
    webhookEventOptions: SlackWebhookEventOptions,
  },
};
