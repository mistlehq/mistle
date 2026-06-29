// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createOrganizationUsageEmptyMeasuredProps,
  createOrganizationUsagePrototypeProps,
} from "../../test-support/organization-usage-page-fixtures.js";
import { OrganizationUsageSettingsPageView } from "./organization-usage-settings-page-view.js";

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

  it("surfaces incomplete measurement notices", () => {
    render(
      <OrganizationUsageSettingsPageView
        {...createOrganizationUsagePrototypeProps()}
        measurement={{
          notice: "This usage period is still in progress. Totals include usage measured so far.",
        }}
      />,
    );

    expect(
      screen.getByText(
        "This usage period is still in progress. Totals include usage measured so far.",
      ),
    ).toBeDefined();
  });

  it("keeps zero-hour days in the daily chart", () => {
    render(<OrganizationUsageSettingsPageView {...createOrganizationUsageEmptyMeasuredProps()} />);

    expect(screen.getByLabelText("Jun 1: 0.0h, 0 runs")).toBeDefined();
    expect(screen.getByLabelText("Jun 30: 0.0h, 0 runs")).toBeDefined();
  });
});
