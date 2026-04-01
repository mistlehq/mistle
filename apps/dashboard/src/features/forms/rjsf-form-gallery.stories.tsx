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

const GallerySchema: RJSFSchema = {
  type: "object",
  required: ["workspaceName", "notes", "provider", "repositories"],
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
    notes: {
      type: "string",
      title: "Operator notes",
      description: "Visible helper text should preserve spacing and hierarchy.",
    },
    provider: {
      type: "string",
      title: "Provider region",
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
      default: "us-east-1",
    },
    tools: {
      type: "array",
      title: "Enabled tools",
      uniqueItems: true,
      default: ["gh-cli"],
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
    repositories: {
      type: "array",
      title: "Repositories",
      default: ["mistle/main-dashboard"],
      items: {
        type: "string",
      },
    },
  },
};

const GalleryUiSchema: UiSchema<JsonObject, RJSFSchema, IntegrationFormContext> = {
  connection_method: {
    "ui:widget": "hidden",
  },
  workspaceName: {
    "ui:placeholder": "Production GitHub connection",
  },
  apiToken: {
    "ui:widget": "PasswordWidget",
    "ui:placeholder": "ghp_xxxxxxxxxxxx",
  },
  notes: {
    "ui:widget": "TextareaWidget",
    "ui:options": {
      rows: 5,
      placeholder: "Describe what this connection is for and who owns it.",
      layout: "stacked",
    },
  },
  tools: {
    "ui:widget": "checkboxes",
    "ui:options": {
      inline: false,
    },
  },
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
};

const DefaultFormData: JsonObject = {
  connection_method: "api-key",
  workspaceName: "GitHub production",
  apiToken: "ghp_storybook_example",
  notes:
    "Use this gallery to tune spacing, field labels, descriptions, and widget presentation across shared RJSF surfaces.",
  provider: "us-east-1",
  tools: ["gh-cli", "webhooks"],
  repositories: ["mistle/main-dashboard", "mistle/control-plane-api"],
};

function HiddenSubmitButton(): null {
  return null;
}

const GalleryTemplates = {
  ...IntegrationFormTemplates,
  ButtonTemplates: {
    SubmitButton: HiddenSubmitButton,
  },
};

function GallerySection(input: {
  children: React.ReactNode;
  description: string;
  title: string;
}): React.JSX.Element {
  return (
    <section className="bg-background gap-4 rounded-xl border p-6 shadow-xs">
      <div className="gap-1 flex flex-col">
        <h2 className="text-base font-semibold">{input.title}</h2>
        <p className="text-muted-foreground text-sm">{input.description}</p>
      </div>
      {input.children}
    </section>
  );
}

function GalleryForm(input: {
  formContext: IntegrationFormContext;
  formData: JsonObject;
  title: string;
}): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  const [formData, setFormData] = useState<JsonObject>(input.formData);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="gap-3 flex flex-col">
        <h3 className="text-sm font-medium">{input.title}</h3>
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
          schema={GallerySchema}
          showErrorList={false}
          templates={GalleryTemplates}
          uiSchema={GalleryUiSchema}
          validator={validator}
          widgets={IntegrationFormWidgets}
        />
      </div>
    </QueryClientProvider>
  );
}

function RjsfFormGalleryStory(): React.JSX.Element {
  return (
    <div className="gap-6 flex flex-col">
      <div className="gap-2 flex flex-col">
        <h1 className="text-xl font-semibold">RJSF Form Gallery</h1>
        <p className="text-muted-foreground text-sm">
          Reference surface for the dashboard&apos;s shared RJSF theme, widgets, field spacing,
          hidden-field behavior, and layout variants.
        </p>
      </div>

      <GallerySection
        description="Default stacked form layout with text, textarea, select, checkbox, hidden, and resource widget fields."
        title="Vertical Layout"
      >
        <GalleryForm
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
          formData={DefaultFormData}
          title="Connection configuration"
        />
      </GallerySection>

      <GallerySection
        description="Horizontal layout used by the integration editor surfaces, using the same schema and widget set."
        title="Horizontal Layout"
      >
        <GalleryForm
          formContext={{
            layout: "horizontal",
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
          formData={DefaultFormData}
          title="Connection configuration"
        />
      </GallerySection>
    </div>
  );
}

const meta = {
  title: "Dashboard/Forms/RJSFFormGallery",
  component: RjsfFormGalleryStory,
  decorators: [withDashboardCenteredSurface],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof RjsfFormGalleryStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
