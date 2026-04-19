// @vitest-environment jsdom

import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { IntegrationFormContext } from "./integration-form-context.js";
import { IntegrationFormWithoutSubmit } from "./integration-form-theme.js";

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

const UiSchema: UiSchema<JsonObject, RJSFSchema, IntegrationFormContext> = {
  defaultRegion: {
    "ui:placeholder": "Select default region",
    "ui:widget": "single-select-string-combobox",
  },
};

function SingleSelectHarness(input: { formData: JsonObject }): React.JSX.Element {
  return (
    <IntegrationFormWithoutSubmit
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

describe("IntegrationFormWithoutSubmit", () => {
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
});
