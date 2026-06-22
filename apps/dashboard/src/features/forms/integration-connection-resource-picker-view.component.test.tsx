// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  IntegrationConnectionResourcePickerView,
  type IntegrationConnectionResourcePickerItem,
} from "./integration-connection-resource-picker-view.js";

afterEach(() => {
  cleanup();
});

const RepositoryItems: readonly IntegrationConnectionResourcePickerItem[] = [
  {
    id: "repo_1",
    value: "mistle/main-dashboard",
    label: "Mistle Dashboard",
  },
  {
    id: "repo_2",
    value: "mistle/control-plane-api",
    label: "Control Plane API",
  },
];

describe("IntegrationConnectionResourcePickerView", () => {
  it("uses the provided search placeholder instead of hard-coded repository copy", () => {
    render(
      <IntegrationConnectionResourcePickerView
        emptyMessage="No repositories available for this connection."
        id="resource-picker"
        isRefreshing={false}
        label="Repositories"
        listState={{
          mode: "ready",
        }}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={() => {}}
        onSearchChange={() => {}}
        onSelectionChange={() => {}}
        refreshErrorMessage={null}
        refreshLabel="Refresh repositories"
        refreshTooltip="Refresh repositories"
        search=""
        searchPlaceholder="Search 1 repository"
        selectedValues={[]}
        unavailableSelectedValues={[]}
        visibleItems={RepositoryItems}
      />,
    );

    expect(screen.getByPlaceholderText("Search 1 repository")).toBeDefined();
    expect(screen.queryByPlaceholderText("Select repositories")).toBeNull();
  });

  it("renders selected values with item labels and keeps unavailable values visible", () => {
    render(
      <IntegrationConnectionResourcePickerView
        emptyMessage="No repositories available for this connection."
        id="resource-picker"
        isRefreshing={false}
        label="Repositories"
        listState={{
          mode: "ready",
        }}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={() => {}}
        onSearchChange={() => {}}
        onSelectionChange={() => {}}
        refreshErrorMessage={null}
        refreshLabel="Refresh repositories"
        refreshTooltip="Refresh repositories"
        search=""
        searchPlaceholder="Search repositories"
        selectedValues={["mistle/main-dashboard", "mistle/private-internal-tools"]}
        unavailableSelectedValues={["mistle/private-internal-tools"]}
        visibleItems={RepositoryItems}
      />,
    );

    expect(screen.getByText("Mistle Dashboard")).toBeDefined();
    expect(screen.getAllByText("mistle/private-internal-tools").length).toBeGreaterThan(0);
    expect(screen.getByText("The selected resources are no longer available:")).toBeDefined();
  });

  it("selects only visible values and appends them after existing selected values", () => {
    let selectedValues: readonly string[] = ["mistle/private-internal-tools"];

    render(
      <IntegrationConnectionResourcePickerView
        emptyMessage="No repositories available for this connection."
        id="resource-picker"
        isRefreshing={false}
        label="Repositories"
        listState={{
          mode: "ready",
        }}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={() => {}}
        onSearchChange={() => {}}
        onSelectionChange={(nextValues) => {
          selectedValues = nextValues;
        }}
        refreshErrorMessage={null}
        refreshLabel="Refresh repositories"
        refreshTooltip="Refresh repositories"
        search=""
        searchPlaceholder="Search repositories"
        selectedValues={selectedValues}
        unavailableSelectedValues={["mistle/private-internal-tools"]}
        visibleItems={RepositoryItems}
      />,
    );

    const combobox = screen.getByLabelText("Repositories");
    const chipToolbar = combobox.closest('[data-slot="combobox-chips"]');
    if (chipToolbar === null) {
      throw new Error("Expected combobox chips toolbar.");
    }
    fireEvent.click(chipToolbar);
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Mistle Dashboard")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Select all"));

    expect(selectedValues).toEqual([
      "mistle/private-internal-tools",
      "mistle/main-dashboard",
      "mistle/control-plane-api",
    ]);
  });
});
