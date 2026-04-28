// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MultiSelectStringArrayComboboxField } from "./multi-select-string-array-combobox-field.js";
import type { StringComboboxOption } from "./string-combobox-options.js";

const Options: readonly StringComboboxOption[] = [
  {
    label: "S3",
    value: "s3",
  },
  {
    label: "STS",
    value: "sts",
  },
  {
    label: "Secrets Manager",
    value: "secretsmanager",
  },
];

function renderField(input?: { value?: readonly string[] }): ReturnType<typeof render> {
  return render(
    <MultiSelectStringArrayComboboxField
      inputId="services"
      inputLabel="Services"
      onChange={() => {}}
      options={Options}
      placeholder="Select services"
      value={input?.value ?? []}
    />,
  );
}

describe("MultiSelectStringArrayComboboxField", () => {
  it("renders selected values as chips using option labels", () => {
    renderField({
      value: ["s3", "secretsmanager"],
    });

    expect(screen.getByText("S3")).toBeDefined();
    expect(screen.getByText("Secrets Manager")).toBeDefined();
  });

  it("clears the search filter after blur and reopen", async () => {
    renderField();

    const input = screen.getByLabelText("Services");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "sts" } });

    const filteredListbox = await screen.findByRole("listbox");
    expect(within(filteredListbox).getByText("STS")).toBeDefined();
    expect(within(filteredListbox).queryByText("S3")).toBeNull();
    expect(within(filteredListbox).queryByText("No matching options.")).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    fireEvent.focus(screen.getByLabelText("Services"));

    const reopenedListbox = await screen.findByRole("listbox");
    expect(within(reopenedListbox).getByText("S3")).toBeDefined();
    expect(within(reopenedListbox).getByText("STS")).toBeDefined();
  });
});
