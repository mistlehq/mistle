import {
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mistle/ui";
import Form from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import type { IntegrationFormContext } from "./integration-form-context.js";
import { IntegrationFormTemplates, IntegrationFormWidgets } from "./integration-form-theme.js";
import { RepositoryItems } from "./integration-resource-string-array-widget-story-support.js";
import type { IntegrationResourceListViewState } from "./integration-resource-string-array-widget-view-model.js";
import { IntegrationResourceStringArrayWidgetView } from "./integration-resource-string-array-widget-view.js";

type JsonObject = Record<string, unknown>;

function HiddenSubmitButton(): null {
  return null;
}

const ComparisonTemplates = {
  ...IntegrationFormTemplates,
  ButtonTemplates: {
    SubmitButton: HiddenSubmitButton,
  },
};

function RjsfExampleForm(input: {
  formContext: IntegrationFormContext;
  formData: JsonObject;
  schema: RJSFSchema;
  uiSchema: UiSchema<JsonObject, RJSFSchema, IntegrationFormContext>;
}): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  const [formData, setFormData] = useState<JsonObject>(input.formData);

  return (
    <QueryClientProvider client={queryClient}>
      <Form<JsonObject, RJSFSchema, IntegrationFormContext>
        formContext={input.formContext}
        formData={formData}
        noHtml5Validate
        onChange={(event) => {
          const nextValue = event.formData;
          setFormData(
            typeof nextValue === "object" && nextValue !== null && !Array.isArray(nextValue)
              ? nextValue
              : {},
          );
        }}
        schema={input.schema}
        showErrorList={false}
        templates={ComparisonTemplates}
        uiSchema={input.uiSchema}
        validator={validator}
        widgets={IntegrationFormWidgets}
      />
    </QueryClientProvider>
  );
}

function ComparisonBlock(input: {
  description: string;
  manual: React.ReactNode;
  rjsf: React.ReactNode;
  title: string;
}): React.JSX.Element {
  return (
    <section className="gap-4 flex flex-col">
      <div className="gap-1 flex flex-col">
        <h2 className="text-base font-semibold">{input.title}</h2>
        <p className="text-muted-foreground text-sm">{input.description}</p>
      </div>
      <div className="gap-6 grid md:grid-cols-2">
        <div className="gap-3 flex flex-col">
          <h3 className="text-sm font-medium">Hand-built</h3>
          <div className="rounded-lg border p-4">{input.manual}</div>
        </div>
        <div className="gap-3 flex flex-col">
          <h3 className="text-sm font-medium">RJSF</h3>
          <div className="rounded-lg border p-4">{input.rjsf}</div>
        </div>
      </div>
    </section>
  );
}

type ComparisonCase = {
  description: string;
  manual: React.ReactNode;
  rjsf: React.ReactNode;
  title: string;
};

function createReadyState(items: typeof RepositoryItems): IntegrationResourceListViewState {
  return {
    mode: "ready",
    items,
  };
}

function ManualTextAndPasswordFields(): React.JSX.Element {
  return (
    <div className="gap-6 flex flex-col">
      <Field orientation="horizontal">
        <FieldHeader>
          <FieldLabel htmlFor="comparison-workspace-name">Workspace name</FieldLabel>
          <FieldDescription>
            Displayed to operators when selecting this connection in the dashboard.
          </FieldDescription>
        </FieldHeader>
        <FieldContent>
          <Input defaultValue="GitHub production" id="comparison-workspace-name" />
        </FieldContent>
      </Field>

      <Field orientation="horizontal">
        <FieldHeader>
          <FieldLabel htmlFor="comparison-api-token">API token</FieldLabel>
          <FieldDescription>
            Stored as a secret and used to authorize API requests.
          </FieldDescription>
        </FieldHeader>
        <FieldContent>
          <Input defaultValue="ghp_storybook_example" id="comparison-api-token" type="password" />
        </FieldContent>
      </Field>
    </div>
  );
}

function ManualCheckboxGroup(): React.JSX.Element {
  return (
    <Field>
      <FieldHeader>
        <FieldLabel>Enabled tools</FieldLabel>
        <FieldDescription>Grouped checkbox array using the shared field styling.</FieldDescription>
      </FieldHeader>
      <FieldContent className="gap-3">
        <label className="gap-2 flex items-center">
          <Checkbox checked={true} />
          <span className="text-sm">GitHub CLI (gh)</span>
        </label>
        <label className="gap-2 flex items-center">
          <Checkbox checked={false} />
          <span className="text-sm">Repository sync</span>
        </label>
        <label className="gap-2 flex items-center">
          <Checkbox checked={true} />
          <span className="text-sm">Webhook delivery</span>
        </label>
      </FieldContent>
    </Field>
  );
}

function ManualResourcePicker(): React.JSX.Element {
  return (
    <IntegrationResourceStringArrayWidgetView
      emptyMessage="No repositories available for this connection."
      id="manual-repositories"
      isRefreshing={false}
      label="Repositories"
      listState={createReadyState(RepositoryItems)}
      onBlur={() => {}}
      onFocus={() => {}}
      onRefresh={() => {}}
      onSearchChange={() => {}}
      onToggleAll={() => {}}
      onToggleHandle={() => {}}
      refreshErrorMessage={null}
      refreshLabel="Refresh repositories"
      refreshTooltip="Refresh repositories\nLast synced Mar 9, 2026, 12:00 PM"
      search=""
      searchPlaceholder="Search repositories"
      selectedHandles={["mistle/main-dashboard", "mistle/control-plane-api"]}
      unavailableSelectedHandles={[]}
      visibleItems={RepositoryItems}
    />
  );
}

function ManualHorizontalField(): React.JSX.Element {
  return (
    <Field orientation="horizontal">
      <FieldHeader>
        <FieldLabel htmlFor="comparison-provider">Provider region</FieldLabel>
        <FieldDescription>
          Horizontal field using the shared integration form theme.
        </FieldDescription>
      </FieldHeader>
      <FieldContent>
        <Select value="us-east-1">
          <div className="md:flex md:justify-end">
            <SelectTrigger
              aria-label="Provider region"
              className="w-full md:w-auto md:min-w-fit md:max-w-full"
              id="comparison-provider"
            >
              <SelectValue placeholder="Select provider region">US East 1</SelectValue>
            </SelectTrigger>
          </div>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectItem value="us-east-1">US East 1</SelectItem>
            <SelectItem value="eu-west-1">EU West 1</SelectItem>
            <SelectItem value="ap-southeast-1">AP Southeast 1</SelectItem>
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
  );
}

function ManualMixedLayout(): React.JSX.Element {
  return (
    <div className="gap-6 flex flex-col">
      <Field orientation="horizontal">
        <FieldHeader>
          <FieldLabel htmlFor="comparison-name">Connection name</FieldLabel>
          <FieldDescription>Compact row field inside a mostly horizontal editor.</FieldDescription>
        </FieldHeader>
        <FieldContent>
          <Input defaultValue="GitHub production" id="comparison-name" />
        </FieldContent>
      </Field>

      <Field>
        <FieldHeader>
          <FieldLabel htmlFor="comparison-notes">Operator notes</FieldLabel>
          <FieldDescription>
            Large text fields stay stacked even when the surrounding form is mixed.
          </FieldDescription>
        </FieldHeader>
        <FieldContent>
          <Textarea
            className="min-h-28 w-full resize-y"
            defaultValue="The notes field opts out of horizontal layout with ui:options.layout = 'stacked'."
            id="comparison-notes"
            rows={6}
          />
        </FieldContent>
      </Field>
    </div>
  );
}

function RjsfTextAndPasswordFields(): React.JSX.Element {
  return (
    <RjsfExampleForm
      formContext={{
        layout: "horizontal",
      }}
      formData={{
        connection_method: "api-key",
        workspaceName: "GitHub production",
        apiToken: "ghp_storybook_example",
      }}
      schema={{
        type: "object",
        properties: {
          connection_method: {
            type: "string",
            default: "api-key",
          },
          workspaceName: {
            type: "string",
            title: "Workspace name",
            description: "Displayed to operators when selecting this connection in the dashboard.",
          },
          apiToken: {
            type: "string",
            title: "API token",
            description: "Stored as a secret and used to authorize API requests.",
          },
        },
      }}
      uiSchema={{
        connection_method: {
          "ui:widget": "hidden",
        },
        workspaceName: {
          "ui:placeholder": "GitHub production",
        },
        apiToken: {
          "ui:widget": "PasswordWidget",
          "ui:placeholder": "ghp_xxxxxxxxxxxx",
        },
      }}
    />
  );
}

function RjsfHorizontalField(): React.JSX.Element {
  return (
    <RjsfExampleForm
      formContext={{
        layout: "horizontal",
      }}
      formData={{
        provider: "us-east-1",
      }}
      schema={{
        type: "object",
        properties: {
          provider: {
            type: "string",
            title: "Provider region",
            description: "Horizontal field using the shared integration form theme.",
            oneOf: [
              {
                const: "us-east-1",
                title: "US East 1",
              },
              {
                const: "eu-west-1",
                title: "EU West 1",
              },
              {
                const: "ap-southeast-1",
                title: "AP Southeast 1",
              },
            ],
          },
        },
      }}
      uiSchema={{
        provider: {
          "ui:placeholder": "Select provider region",
        },
      }}
    />
  );
}

function RjsfMixedLayout(): React.JSX.Element {
  return (
    <RjsfExampleForm
      formContext={{
        layout: "horizontal",
      }}
      formData={{
        connectionName: "GitHub production",
        notes: "The notes field opts out of horizontal layout with ui:options.layout = 'stacked'.",
      }}
      schema={{
        type: "object",
        properties: {
          connectionName: {
            type: "string",
            title: "Connection name",
            description: "Compact row field inside a mostly horizontal editor.",
          },
          notes: {
            type: "string",
            title: "Operator notes",
            description: "Large text fields stay stacked even when the surrounding form is mixed.",
          },
        },
      }}
      uiSchema={{
        connectionName: {
          "ui:placeholder": "GitHub production",
        },
        notes: {
          "ui:widget": "TextareaWidget",
          "ui:options": {
            rows: 6,
            layout: "stacked",
            placeholder: "Add notes for operators.",
          },
        },
      }}
    />
  );
}

function RjsfCheckboxGroup(): React.JSX.Element {
  return (
    <RjsfExampleForm
      formContext={{
        layout: "vertical",
      }}
      formData={{
        tools: ["gh-cli", "webhooks"],
      }}
      schema={{
        type: "object",
        properties: {
          tools: {
            type: "array",
            title: "Enabled tools",
            description: "Grouped checkbox array using the shared field styling.",
            uniqueItems: true,
            items: {
              oneOf: [
                {
                  const: "gh-cli",
                  title: "GitHub CLI (gh)",
                },
                {
                  const: "repo-sync",
                  title: "Repository sync",
                },
                {
                  const: "webhooks",
                  title: "Webhook delivery",
                },
              ],
            },
          },
        },
      }}
      uiSchema={{
        tools: {
          "ui:widget": "checkboxes",
          "ui:options": {
            inline: false,
          },
        },
      }}
    />
  );
}

function RjsfResourcePicker(): React.JSX.Element {
  return (
    <RjsfExampleForm
      formContext={{
        layout: "vertical",
        resourceOverrides: [
          {
            connectionId: "storybook-github",
            kind: "repository",
            syncState: "ready",
            lastSyncedAt: "2026-03-09T12:00:00.000Z",
            items: RepositoryItems,
          },
        ],
      }}
      formData={{
        repositories: ["mistle/main-dashboard", "mistle/control-plane-api"],
      }}
      schema={{
        type: "object",
        properties: {
          repositories: {
            type: "array",
            title: "Repositories",
            description: "Repository picker using the integration resource widget.",
            items: {
              type: "string",
            },
          },
        },
      }}
      uiSchema={{
        repositories: {
          "ui:widget": "integration-resource-string-array",
          "ui:options": {
            connectionId: "storybook-github",
            kind: "repository",
            title: "Repositories",
            searchPlaceholder: "Search repositories",
            emptyMessage: "No repositories available for this connection.",
            refreshLabel: "Refresh repositories",
            resourceSummary: {
              kind: "repository",
              selectionMode: "multi",
              count: RepositoryItems.length,
              syncState: "ready",
              lastSyncedAt: "2026-03-09T12:00:00.000Z",
            },
          },
        },
      }}
    />
  );
}

function RjsfLayoutComparisonStory(input: { caseItem?: ComparisonCase }): React.JSX.Element {
  const comparisonCases: readonly ComparisonCase[] =
    input.caseItem === undefined
      ? [
          {
            description:
              "Hidden schema-only fields should stay invisible while visible text and password rows match the hand-built field system.",
            manual: <ManualTextAndPasswordFields />,
            rjsf: <RjsfTextAndPasswordFields />,
            title: "Text, Password, and Hidden Fields",
          },
          {
            description:
              "Baseline horizontal row composition. Tune the RJSF theme until label alignment, width behavior, and field spacing match the hand-built pattern.",
            manual: <ManualHorizontalField />,
            rjsf: <RjsfHorizontalField />,
            title: "Horizontal Field",
          },
          {
            description:
              "Mixed layout pattern: compact rows remain horizontal while large text areas become stacked. This is the RJSF equivalent of how forms like Create Automation mix orientations.",
            manual: <ManualMixedLayout />,
            rjsf: <RjsfMixedLayout />,
            title: "Mixed Layout",
          },
          {
            description:
              "Checkbox-array handling should stay visually aligned with grouped manual controls.",
            manual: <ManualCheckboxGroup />,
            rjsf: <RjsfCheckboxGroup />,
            title: "Checkbox Group",
          },
          {
            description:
              "The resource picker is a custom RJSF widget. Keep its standalone view and schema-driven rendering aligned.",
            manual: <ManualResourcePicker />,
            rjsf: <RjsfResourcePicker />,
            title: "Resource Picker",
          },
        ]
      : [input.caseItem];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
      <div className="gap-2 flex flex-col">
        <h1 className="text-xl font-semibold">RJSF Layout Comparison</h1>
        <p className="text-muted-foreground text-sm">
          Use this story to keep schema-driven forms aligned with hand-built dashboard form
          composition. The RJSF contract is intentionally small: form-level layout comes from
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">formContext.layout</code>
          and field-level exceptions use
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
            ui:options.layout = "stacked"
          </code>
          .
        </p>
      </div>

      {comparisonCases.map((caseItem) => (
        <ComparisonBlock
          description={caseItem.description}
          key={caseItem.title}
          manual={caseItem.manual}
          rjsf={caseItem.rjsf}
          title={caseItem.title}
        />
      ))}
    </div>
  );
}

const meta = {
  title: "Dashboard/RJSF/LayoutComparison",
  component: RjsfLayoutComparisonStory,
  decorators: [withDashboardCenteredSurface],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof RjsfLayoutComparisonStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <RjsfLayoutComparisonStory />;
  },
};

export const TextPasswordAndHiddenFields: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <RjsfLayoutComparisonStory
        caseItem={{
          description:
            "Hidden schema-only fields should stay invisible while visible text and password rows match the hand-built field system.",
          manual: <ManualTextAndPasswordFields />,
          rjsf: <RjsfTextAndPasswordFields />,
          title: "Text, Password, and Hidden Fields",
        }}
      />
    );
  },
};

export const HorizontalField: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <RjsfLayoutComparisonStory
        caseItem={{
          description:
            "Baseline horizontal row composition. Tune the RJSF theme until label alignment, width behavior, and field spacing match the hand-built pattern.",
          manual: <ManualHorizontalField />,
          rjsf: <RjsfHorizontalField />,
          title: "Horizontal Field",
        }}
      />
    );
  },
};

export const MixedLayout: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <RjsfLayoutComparisonStory
        caseItem={{
          description:
            "Mixed layout pattern: compact rows remain horizontal while large text areas become stacked. This is the RJSF equivalent of how forms like Create Automation mix orientations.",
          manual: <ManualMixedLayout />,
          rjsf: <RjsfMixedLayout />,
          title: "Mixed Layout",
        }}
      />
    );
  },
};

export const CheckboxGroup: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <RjsfLayoutComparisonStory
        caseItem={{
          description:
            "Checkbox-array handling should stay visually aligned with grouped manual controls.",
          manual: <ManualCheckboxGroup />,
          rjsf: <RjsfCheckboxGroup />,
          title: "Checkbox Group",
        }}
      />
    );
  },
};

export const ResourcePicker: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <RjsfLayoutComparisonStory
        caseItem={{
          description:
            "The resource picker is a custom RJSF widget. Keep its standalone view and schema-driven rendering aligned.",
          manual: <ManualResourcePicker />,
          rjsf: <RjsfResourcePicker />,
          title: "Resource Picker",
        }}
      />
    );
  },
};
