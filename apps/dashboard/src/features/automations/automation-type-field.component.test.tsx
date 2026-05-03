// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomationTypeDisplayField, AutomationTypeSelectField } from "./automation-type-field.js";

describe("AutomationTypeField", () => {
  it("renders the create field as a selectable automation type", () => {
    render(<AutomationTypeSelectField value="scheduled" />);

    expect(screen.getByText("Automation type")).toBeDefined();
    expect(screen.getByRole("combobox").textContent).toContain("Schedule");
  });

  it("renders the edit field as read-only text", () => {
    render(<AutomationTypeDisplayField value="trigger" />);

    expect(screen.getByText("Automation type")).toBeDefined();
    expect(screen.getByText("Event")).toBeDefined();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
