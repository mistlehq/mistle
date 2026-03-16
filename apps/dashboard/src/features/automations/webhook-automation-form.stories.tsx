import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import {
  WebhookAutomationForm,
  type WebhookAutomationEventOption,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
  type WebhookAutomationFormValueKey,
} from "./webhook-automation-form.js";

const ConnectionOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: "conn_github_prod",
    label: "GitHub Engineering",
    description: "github-cloud",
  },
  {
    value: "conn_stripe_prod",
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

const GitHubWebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    value: "github.issue_comment.created",
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
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
  },
  {
    value: "github.pull_request_review_comment.created",
    label: "Pull request review comment created",
    category: "Pull requests",
    logoKey: "github",
  },
];

const CreateValues: WebhookAutomationFormValues = {
  name: "GitHub pushes to repo triage",
  integrationConnectionId: "conn_github_prod",
  sandboxProfileId: "sbp_repo_maintainer",
  enabled: true,
  inputTemplate: '{\n  "repo": "{{payload.repository.full_name}}",\n  "ref": "{{payload.ref}}"\n}',
  conversationKeyTemplate: "{{payload.repository.full_name}}:{{payload.ref}}",
  idempotencyKeyTemplate: "{{delivery.id}}",
  eventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
  payloadFilterEditorMode: "builder",
  payloadFilterBuilderMode: "all",
  payloadFilterConditions: [
    {
      id: "condition_0",
      pathText: "action",
      operator: "eq",
      valueType: "string",
      valueText: "opened",
      valuesText: "",
    },
  ],
  payloadFilterText: '{\n  "op": "eq",\n  "path": [\n    "action"\n  ],\n  "value": "opened"\n}',
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
  const [values, setValues] = useState(input.values);

  return (
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
    values: CreateValues,
  },
};

export const Edit: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: {
      ...CreateValues,
      enabled: false,
      eventTypes: ["stripe.payout.failed"],
      name: "Stripe payouts incident intake",
      integrationConnectionId: "conn_stripe_prod",
      sandboxProfileId: "sbp_finance_investigator",
    },
    webhookEventOptions: [
      {
        value: "stripe.payout.failed",
        label: "Payout failed",
        category: "Payouts",
        logoKey: "stripe",
      },
    ],
  },
};

export const ValidationErrors: Story = {
  args: {
    mode: "create",
    formError: "The selected integration connection does not support webhook automations.",
    fieldErrors: {
      name: "Automation name is required.",
      integrationConnectionId: "Choose a webhook-capable integration connection.",
      sandboxProfileId: "Choose a sandbox profile for the automation target.",
      inputTemplate: "Input template must be valid JSON template text.",
    },
    values: {
      ...CreateValues,
      name: "",
      integrationConnectionId: "",
      sandboxProfileId: "",
      eventTypes: [],
      payloadFilterConditions: [
        {
          id: "condition_0",
          pathText: "",
          operator: "eq",
          valueType: "string",
          valueText: "",
          valuesText: "",
        },
      ],
    },
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    mode: "create",
    connectionOptions: [],
    formError: "Create an integration connection before you configure an automation.",
    values: {
      ...CreateValues,
      integrationConnectionId: "",
      eventTypes: [],
    },
    webhookEventOptions: [],
  },
};

export const Saving: Story = {
  args: {
    mode: "edit",
    isDeleting: false,
    isSaving: true,
    onDelete: function onDelete() {},
    values: CreateValues,
  },
};

export const NoTriggersAvailable: Story = {
  args: {
    mode: "create",
    values: {
      ...CreateValues,
      eventTypes: [],
    },
    webhookEventOptions: [],
  },
};

export const UnavailableSavedEvent: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    values: {
      ...CreateValues,
      eventTypes: ["github.issue_comment.created", "github.push.deleted"],
    },
    webhookEventOptions: [
      ...GitHubWebhookEventOptions,
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
