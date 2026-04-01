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

type JsonObject = Record<string, unknown>;

function HiddenSubmitButton(): null {
  return null;
}

const WidgetTemplates = {
  ...IntegrationFormTemplates,
  ButtonTemplates: {
    SubmitButton: HiddenSubmitButton,
  },
};

function WidgetForm(input: {
  formContext?: IntegrationFormContext;
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
        templates={WidgetTemplates}
        uiSchema={input.uiSchema}
        validator={validator}
        widgets={IntegrationFormWidgets}
      />
    </QueryClientProvider>
  );
}

function TextareaWidgetStory(): React.JSX.Element {
  return (
    <div className="w-full max-w-3xl">
      <WidgetForm
        formData={{
          notes:
            "Use this story to tune textarea height, padding, placeholder styling, and helper text spacing.",
        }}
        schema={{
          type: "object",
          required: ["notes"],
          properties: {
            notes: {
              type: "string",
              title: "Operator notes",
              description: "Notes appear below the label and above the control.",
            },
          },
        }}
        uiSchema={{
          notes: {
            "ui:widget": "TextareaWidget",
            "ui:options": {
              rows: 6,
              placeholder: "Describe how operators should use this connection.",
              layout: "stacked",
            },
          },
        }}
      />
    </div>
  );
}

function SelectWidgetStory(): React.JSX.Element {
  return (
    <div className="w-full max-w-3xl">
      <WidgetForm
        formContext={{
          layout: "horizontal",
        }}
        formData={{
          provider: "us-east-1",
        }}
        schema={{
          type: "object",
          required: ["provider"],
          properties: {
            provider: {
              type: "string",
              title: "Provider region",
              description: "This field uses the custom select widget from the shared RJSF theme.",
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
    </div>
  );
}

function CommaSeparatedStringArrayWidgetStory(): React.JSX.Element {
  return (
    <div className="w-full max-w-3xl">
      <WidgetForm
        formData={{
          scopes: ["repo", "read:org", "workflow"],
        }}
        schema={{
          type: "object",
          properties: {
            scopes: {
              type: "array",
              title: "Token scopes",
              description:
                "The widget reads and writes an array while presenting it as a comma-separated text input.",
              items: {
                type: "string",
              },
            },
          },
        }}
        uiSchema={{
          scopes: {
            "ui:widget": "comma-separated-string-array",
            "ui:options": {
              placeholder: "repo, read:org, workflow",
            },
          },
        }}
      />
    </div>
  );
}

function IntegrationResourceStringArrayWidgetStory(): React.JSX.Element {
  return (
    <div className="w-full max-w-3xl">
      <WidgetForm
        formContext={{
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
          required: ["repositories"],
          properties: {
            repositories: {
              type: "array",
              title: "Repositories",
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
    </div>
  );
}

const meta = {
  title: "Dashboard/Forms/RJSFWidgets",
  decorators: [withDashboardCenteredSurface],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const TextareaWidget: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <TextareaWidgetStory />;
  },
};

export const SelectWidget: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SelectWidgetStory />;
  },
};

export const CommaSeparatedStringArrayWidget: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <CommaSeparatedStringArrayWidgetStory />;
  },
};

export const IntegrationResourceStringArrayWidget: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <IntegrationResourceStringArrayWidgetStory />;
  },
};
