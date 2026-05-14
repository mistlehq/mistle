// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomationTypeDisplayField, AutomationTypeSelectField } from "./automation-type-field.js";

describe("AutomationTypeField", () => {
  it("renders the create field as a selectable trigger source", () => {
    render(<AutomationTypeSelectField value="scheduled" />);

    expect(screen.getByText("Trigger source")).toBeDefined();
    expect(screen.getByRole("combobox").textContent).toContain("Schedule");
  });

  it("renders a placeholder and error before a trigger source is selected", () => {
    render(<AutomationTypeSelectField error="Select a trigger source." value={null} />);

    expect(screen.getByText("Trigger source")).toBeDefined();
    expect(screen.getByText("Select source")).toBeDefined();
    expect(screen.getByText("Select a trigger source.")).toBeDefined();
    expect(screen.getByRole("combobox").getAttribute("aria-invalid")).toBe("true");
  });

  it("renders the edit field as read-only text", () => {
    render(<AutomationTypeDisplayField value="trigger" />);

    expect(screen.getByText("Trigger source")).toBeDefined();
    expect(screen.getByText("Event")).toBeDefined();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
