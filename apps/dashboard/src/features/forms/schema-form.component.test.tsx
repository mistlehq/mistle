// @vitest-environment jsdom

import type { IChangeEvent } from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SchemaFormContext } from "./schema-form.js";
import { SchemaFormWithoutSubmit } from "./schema-form.js";

type JsonObject = Record<string, unknown>;

const Schema: RJSFSchema = {
  type: "object",
  properties: {
    defaultRegion: {
      title: "Default region",
      type: "string",
      oneOf: [
        {
          const: "us-east-1",
          title: "us-east-1",
        },
        {
          const: "us-west-2",
          title: "us-west-2",
        },
      ],
    },
  },
};

const UiSchema: UiSchema<JsonObject, RJSFSchema, SchemaFormContext> = {
  defaultRegion: {
    "ui:placeholder": "Select default region",
    "ui:widget": "single-select-string-combobox",
  },
};

const JiraSiteUrlSchema: RJSFSchema = {
  type: "object",
  properties: {
    site_url: {
      title: "Site name",
      type: "string",
    },
  },
};

const JiraSiteUrlUiSchema: UiSchema<JsonObject, RJSFSchema, SchemaFormContext> = {
  site_url: {
    "ui:placeholder": "your-site",
    "ui:widget": "affixed-text",
    "ui:options": {
      prefix: "https://",
      suffix: ".atlassian.net",
      transform: "lowercase",
    },
  },
};

function SingleSelectHarness(input: { formData: JsonObject }): React.JSX.Element {
  return (
    <SchemaFormWithoutSubmit
      formContext={{}}
      formData={input.formData}
      noHtml5Validate
      onChange={() => {}}
      schema={Schema}
      showErrorList={false}
      uiSchema={UiSchema}
      validator={validator}
    />
  );
}

const NestedSchema: RJSFSchema = {
  type: "object",
  properties: {
    model: {
      type: "object",
      properties: {
        defaultModel: {
          title: "Default model",
          type: "string",
          oneOf: [
            {
              const: "gpt-5.3-codex",
              title: "gpt-5.3-codex",
            },
            {
              const: "gpt-5.4",
              title: "gpt-5.4",
            },
          ],
        },
        options: {
          type: "object",
          properties: {
            reasoningEffort: {
              title: "Reasoning effort",
              type: "string",
              oneOf: [
                {
                  const: "medium",
                  title: "medium",
                },
                {
                  const: "high",
                  title: "high",
                },
              ],
            },
            additionalInstructions: {
              title: "Agent Instructions",
              type: "string",
              description: "Appended to the developer message.",
            },
          },
        },
      },
    },
  },
};

const NestedUiSchema: UiSchema<JsonObject, RJSFSchema, SchemaFormContext> = {
  model: {
    defaultModel: {
      "ui:widget": "single-select-string-combobox",
    },
    options: {
      reasoningEffort: {
        "ui:widget": "single-select-string-combobox",
      },
      additionalInstructions: {
        "ui:widget": "TextareaWidget",
        "ui:options": {
          rows: 8,
        },
      },
    },
  },
};

function NestedObjectLayoutHarness(input: { formData: JsonObject }): React.JSX.Element {
  return (
    <SchemaFormWithoutSubmit
      formContext={{
        columns: 2,
        labelTone: "detail",
        layout: "vertical",
      }}
      formData={input.formData}
      noHtml5Validate
      onChange={() => {}}
      schema={NestedSchema}
      showErrorList={false}
      uiSchema={NestedUiSchema}
      validator={validator}
    />
  );
}

const DescriptionOnlyObjectSchema: RJSFSchema = {
  type: "object",
  properties: {
    credentials: {
      description: "Credentials used when calling the provider API.",
      type: "object",
      properties: {
        apiToken: {
          title: "API token",
          type: "string",
        },
      },
    },
  },
};

function DescriptionOnlyObjectHarness(): React.JSX.Element {
  return (
    <SchemaFormWithoutSubmit
      formContext={{}}
      formData={{
        credentials: {
          apiToken: "secret-token",
        },
      }}
      noHtml5Validate
      onChange={() => {}}
      schema={DescriptionOnlyObjectSchema}
      showErrorList={false}
      validator={validator}
    />
  );
}

describe("SchemaFormWithoutSubmit", () => {
  it("wires the single-select combobox widget through the form theme", async () => {
    render(
      <SingleSelectHarness
        formData={{
          defaultRegion: "us-east-1",
        }}
      />,
    );

    const input = screen.getByLabelText("Default region");
    expect(input).toHaveProperty("value", "us-east-1");

    fireEvent.focus(input);

    const listbox = await screen.findByRole("listbox");

    expect(within(listbox).getByText("us-east-1")).toBeDefined();
    expect(within(listbox).getByText("us-west-2")).toBeDefined();

    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByLabelText("Default region")).toHaveProperty("value", "us-east-1");
    });
  });

  it("renders affixed text values as fixed text with an editable inner value", () => {
    let changedFormData: JsonObject | null = null;

    const { rerender } = render(
      <SchemaFormWithoutSubmit
        formContext={{}}
        formData={{
          site_url: "https://mistle.atlassian.net",
        }}
        noHtml5Validate
        onChange={(event: IChangeEvent<JsonObject, RJSFSchema>) => {
          changedFormData = event.formData ?? null;
        }}
        schema={JiraSiteUrlSchema}
        showErrorList={false}
        uiSchema={JiraSiteUrlUiSchema}
        validator={validator}
      />,
    );

    expect(screen.getByText("https://")).toBeDefined();
    expect(screen.getByText(".atlassian.net")).toBeDefined();

    const input = screen.getByLabelText("Site name");
    expect(input).toHaveProperty("value", "mistle");

    fireEvent.change(input, {
      target: {
        value: "Acme",
      },
    });

    expect(changedFormData).toEqual({
      site_url: "https://acme.atlassian.net",
    });

    rerender(
      <SchemaFormWithoutSubmit
        formContext={{}}
        formData={{
          site_url: "https://mistle.atlassian.net/",
        }}
        noHtml5Validate
        onChange={(event: IChangeEvent<JsonObject, RJSFSchema>) => {
          changedFormData = event.formData ?? null;
        }}
        schema={JiraSiteUrlSchema}
        showErrorList={false}
        uiSchema={JiraSiteUrlUiSchema}
        validator={validator}
      />,
    );

    expect(screen.getByLabelText("Site name")).toHaveProperty("value", "mistle");

    fireEvent.change(screen.getByLabelText("Site name"), {
      target: {
        value: "https://Example.atlassian.net/",
      },
    });

    expect(changedFormData).toEqual({
      site_url: "https://example.atlassian.net",
    });
  });

  it("fails fast when an affixed text widget is missing affix options", () => {
    expect(() =>
      render(
        <SchemaFormWithoutSubmit
          formContext={{}}
          formData={{}}
          noHtml5Validate
          onChange={() => {}}
          schema={JiraSiteUrlSchema}
          showErrorList={false}
          uiSchema={{
            site_url: {
              "ui:widget": "affixed-text",
            },
          }}
          validator={validator}
        />,
      ),
    ).toThrow("Affixed text widget requires string prefix and suffix options.");
  });

  it("fails fast when an affixed text widget has an unsupported transform", () => {
    expect(() =>
      render(
        <SchemaFormWithoutSubmit
          formContext={{}}
          formData={{}}
          noHtml5Validate
          onChange={() => {}}
          schema={JiraSiteUrlSchema}
          showErrorList={false}
          uiSchema={{
            site_url: {
              "ui:widget": "affixed-text",
              "ui:options": {
                prefix: "https://",
                suffix: ".atlassian.net",
                transform: "uppercase",
              },
            },
          }}
          validator={validator}
        />,
      ),
    ).toThrow("Affixed text widget supports only the lowercase transform option.");
  });

  it("flattens nested wrapper objects into the parent two-column layout", () => {
    render(
      <NestedObjectLayoutHarness
        formData={{
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {
              reasoningEffort: "medium",
              additionalInstructions: "Stay concise and ask before destructive changes.",
            },
          },
        }}
      />,
    );

    expect(screen.getByLabelText("Default model")).toBeDefined();
    expect(screen.getByLabelText("Reasoning effort")).toBeDefined();
    expect(screen.getByLabelText("Agent Instructions").closest(".md\\:col-span-2")).not.toBeNull();
  });

  it("keeps a description affordance for object groups without titles", () => {
    render(<DescriptionOnlyObjectHarness />);

    expect(screen.getByText("Description")).toBeDefined();
    expect(screen.getByRole("button", { name: "Field description" })).toBeDefined();
    expect(screen.getByLabelText("API token")).toBeDefined();
  });

  it("marks required schema fields in the label", () => {
    render(
      <SchemaFormWithoutSubmit
        formContext={{}}
        formData={{}}
        noHtml5Validate
        onChange={() => {}}
        schema={{
          type: "object",
          required: ["appId"],
          properties: {
            appId: {
              title: "App ID",
              description: "Slack app ID used to refresh webhook event capabilities from Slack.",
              type: "string",
            },
            clientId: {
              title: "Client ID",
              type: "string",
            },
          },
        }}
        showErrorList={false}
        validator={validator}
      />,
    );

    const appIdLabel = screen.getByText("App ID").closest("div");
    expect(appIdLabel).not.toBeNull();
    expect(within(appIdLabel ?? document.body).getByText("required")).toBeDefined();
    expect(screen.queryByText("Client ID required")).toBeNull();
  });
});
