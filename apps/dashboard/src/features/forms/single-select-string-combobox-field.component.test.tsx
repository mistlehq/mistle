// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SingleSelectStringComboboxField } from "./single-select-string-combobox-field.js";
import type { StringComboboxOption } from "./string-combobox-options.js";

const Options: readonly StringComboboxOption[] = [
  {
    label: "us-east-1",
    value: "us-east-1",
  },
  {
    label: "us-west-2",
    value: "us-west-2",
  },
];

function renderField(input?: { value?: string }): ReturnType<typeof render> {
  return render(
    <SingleSelectStringComboboxField
      inputId="default-region"
      inputLabel="Default region"
      onChange={() => {}}
      options={Options}
      placeholder="Select default region"
      value={input?.value}
    />,
  );
}

describe("SingleSelectStringComboboxField", () => {
  afterEach(() => {
    cleanup();
  });

  it("updates the visible label after a focus-blur cycle and later prop change", async () => {
    const rendered = renderField({ value: "us-east-1" });

    const input = screen.getByLabelText("Default region");
    expect(input).toHaveProperty("value", "us-east-1");

    fireEvent.focus(input);
    fireEvent.blur(input);

    rendered.rerender(
      <SingleSelectStringComboboxField
        inputId="default-region"
        inputLabel="Default region"
        onChange={() => {}}
        options={Options}
        placeholder="Select default region"
        value="us-west-2"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Default region")).toHaveProperty("value", "us-west-2");
    });
  });

  it("shows the full option list when reopened with an existing selection", async () => {
    renderField({ value: "us-east-1" });

    const input = screen.getByLabelText("Default region");
    expect(input).toHaveProperty("value", "us-east-1");

    fireEvent.focus(input);

    const listbox = await screen.findByRole("listbox");

    expect(within(listbox).getByText("us-east-1")).toBeDefined();
    expect(within(listbox).getByText("us-west-2")).toBeDefined();
  });

  it("shows the empty message only when the filtered list is empty", async () => {
    renderField();

    const input = screen.getByLabelText("Default region");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "moon-1" } });

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByText("us-east-1")).toBeNull();
    expect(within(listbox).queryByText("us-west-2")).toBeNull();
    expect(within(listbox).getByText("No matching options.")).toBeDefined();
  });

  it("hides the clear control when showClear is false", () => {
    const rendered = render(
      <SingleSelectStringComboboxField
        inputId="default-region"
        inputLabel="Default region"
        onChange={() => {}}
        options={Options}
        placeholder="Select default region"
        showClear={false}
        value="us-east-1"
      />,
    );

    expect(rendered.container.querySelector('[data-slot="combobox-clear"]')).toBeNull();
  });

  it("disables the input when disabled", () => {
    render(
      <SingleSelectStringComboboxField
        disabled={true}
        inputId="default-region"
        inputLabel="Default region"
        onChange={() => {}}
        options={Options}
        placeholder="Select default region"
        value="us-east-1"
      />,
    );

    expect(screen.getByLabelText("Default region")).toHaveProperty("disabled", true);
  });
});
