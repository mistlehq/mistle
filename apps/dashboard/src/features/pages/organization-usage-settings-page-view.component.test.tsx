// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrganizationUsageSettingsPageView } from "./organization-usage-settings-page-view.js";
import { createOrganizationUsagePrototypeProps } from "./organization-usage-settings-page-view.story-fixtures.js";

describe("OrganizationUsageSettingsPageView", () => {
  it("labels breakdown tables by their row category instead of a generic segment column", () => {
    render(<OrganizationUsageSettingsPageView {...createOrganizationUsagePrototypeProps()} />);

    const tables = screen.getAllByRole("table");
    const sandboxProfileTable = tables.at(0);
    const activityTable = tables.at(1);

    if (sandboxProfileTable === undefined) {
      throw new Error("Sandbox profile usage table was not found.");
    }

    if (activityTable === undefined) {
      throw new Error("Activity usage table was not found.");
    }

    expect(
      within(sandboxProfileTable).getByRole("columnheader", { name: "Sandbox profile" }),
    ).toBeDefined();
    expect(within(activityTable).getByRole("columnheader", { name: "Activity" })).toBeDefined();
    expect(screen.queryByRole("columnheader", { name: "Segment" })).toBeNull();
  });
});
