// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BadgeListField } from "./badge-list-field.js";

describe("BadgeListField", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a label and badges", () => {
    const { container } = render(
      <BadgeListField
        items={[
          { id: "jira:issue_created", label: "Issue created" },
          { id: "jira:issue_updated", label: "Issue updated" },
        ]}
        label="Registered events"
      />,
    );

    const field = container.querySelector('[data-slot="badge-list-field"]');
    if (field === null) {
      throw new Error("Expected badge list field to render.");
    }

    expect(screen.getByText("Registered events")).toBeTruthy();
    expect(screen.getByText("Issue created")).toBeTruthy();
    expect(screen.getByText("Issue updated")).toBeTruthy();
  });

  it("returns null when there are no items", () => {
    const { container } = render(<BadgeListField items={[]} label="Registered events" />);

    expect(container.firstChild).toBeNull();
  });
});
