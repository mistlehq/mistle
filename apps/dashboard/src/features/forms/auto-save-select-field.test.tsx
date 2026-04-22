// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AutoSaveSelectField } from "./auto-save-select-field.js";

const Options = [
  { value: "mistle-user@example.com", label: "mistle-user@example.com (Primary)" },
  { value: "engineering@example.com", label: "engineering@example.com" },
] as const;

describe("AutoSaveSelectField", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the selected option label in the trigger", () => {
    render(
      <AutoSaveSelectField
        id="commit-email"
        label="Commit email"
        onSave={async () => {}}
        options={Options}
        value="mistle-user@example.com"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Commit email" }).textContent).toContain(
      "mistle-user@example.com (Primary)",
    );
  });

  it("shows none when there are no selectable options", () => {
    render(
      <AutoSaveSelectField
        id="commit-email"
        label="Commit email"
        onSave={async () => {}}
        options={[]}
        value=""
      />,
    );

    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Commit email" })).toBeNull();
  });

  it("disables the trigger when the field is disabled", () => {
    render(
      <AutoSaveSelectField
        disabled={true}
        id="commit-email"
        label="Commit email"
        onSave={async () => {}}
        options={Options}
        value="mistle-user@example.com"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Commit email" })).toHaveProperty("disabled", true);
  });
});
