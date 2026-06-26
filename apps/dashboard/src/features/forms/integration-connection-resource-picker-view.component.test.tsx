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
    const unavailableChip = getChipForText("mistle/private-internal-tools");
    expect(unavailableChip.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText("The highlighted resources are no longer available. Please remove them."),
    ).toBeDefined();
  });

  it("renders only the highest-priority alert message as a compact field error by default", () => {
    render(
      <IntegrationConnectionResourcePickerView
        emptyMessage="No repositories available for this connection."
        id="resource-picker"
        isRefreshing={false}
        label="Repositories"
        listState={{
          mode: "error",
          message: "Could not load repositories.",
        }}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={() => {}}
        onSearchChange={() => {}}
        onSelectionChange={() => {}}
        refreshErrorMessage="Could not refresh repositories."
        refreshLabel="Refresh repositories"
        refreshTooltip="Refresh repositories"
        search=""
        searchPlaceholder="Search repositories"
        selectedValues={["mistle/private-internal-tools"]}
        unavailableSelectedValues={["mistle/private-internal-tools"]}
        visibleItems={RepositoryItems}
      />,
    );

    const fieldErrors = screen.getAllByRole("alert");
    const fieldError = getFieldErrorAt(fieldErrors, 0);
    const combobox = screen.getByLabelText("Repositories");
    const chipToolbar = combobox.closest('[data-slot="combobox-chips"]');
    if (chipToolbar === null) {
      throw new Error("Expected combobox chips toolbar.");
    }

    expect(combobox.getAttribute("aria-invalid")).toBe("true");
    expect(fieldErrors).toHaveLength(1);
    expect(fieldError.textContent).toBe(
      "The highlighted resources are no longer available. Please remove them.",
    );
    expect(getChipForText("mistle/private-internal-tools").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.queryByText("Refresh failed.")).toBeNull();
    expect(screen.queryByText("Sync failed. Only showing last synced results.")).toBeNull();

    for (const fieldError of fieldErrors) {
      expect(fieldError.getAttribute("data-slot")).toBe("field-error");
      expect(fieldError.className).toContain("text-xs");
    }
  });

  it("shows refresh failure instead of also stacking the sync failure", () => {
    render(
      <IntegrationConnectionResourcePickerView
        emptyMessage="No repositories available for this connection."
        id="resource-picker"
        isRefreshing={false}
        label="Repositories"
        listState={{
          mode: "error",
          message: "Could not load repositories.",
        }}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={() => {}}
        onSearchChange={() => {}}
        onSelectionChange={() => {}}
        refreshErrorMessage="Could not refresh repositories."
        refreshLabel="Refresh repositories"
        refreshTooltip="Refresh repositories"
        search=""
        searchPlaceholder="Search repositories"
        selectedValues={["mistle/main-dashboard"]}
        unavailableSelectedValues={[]}
        visibleItems={RepositoryItems}
      />,
    );

    const fieldErrors = screen.getAllByRole("alert");
    const fieldError = getFieldErrorAt(fieldErrors, 0);

    expect(fieldErrors).toHaveLength(1);
    expect(fieldError.textContent).toBe("Refresh failed. Please try again.");
    expect(screen.queryByText("Sync failed. Only showing last synced results.")).toBeNull();
  });

  it("renders the sync failure message as a non-wrapping compact field error", () => {
    render(
      <IntegrationConnectionResourcePickerView
        emptyMessage="No repositories available for this connection."
        id="resource-picker"
        isRefreshing={false}
        label="Repositories"
        listState={{
          mode: "error",
          message: "Could not load repositories.",
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
        selectedValues={["mistle/main-dashboard"]}
        unavailableSelectedValues={[]}
        visibleItems={RepositoryItems}
      />,
    );

    const fieldErrors = screen.getAllByRole("alert");
    const fieldError = getFieldErrorAt(fieldErrors, 0);

    expect(fieldErrors).toHaveLength(1);
    expect(fieldError.textContent).toBe(
      "Sync failed. Only showing last synced results. Try again. If this keeps failing, reconnect the integration.",
    );
    expect(fieldError.className).toContain("whitespace-nowrap");
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

  it("keeps the empty picker popover focused on the refresh action and one empty message", () => {
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
        searchPlaceholder="No repositories available"
        selectedValues={[]}
        unavailableSelectedValues={[]}
        visibleItems={[]}
      />,
    );

    const combobox = screen.getByLabelText("Repositories");
    const chipToolbar = combobox.closest('[data-slot="combobox-chips"]');
    if (chipToolbar === null) {
      throw new Error("Expected combobox chips toolbar.");
    }
    fireEvent.click(chipToolbar);

    expect(screen.queryByLabelText("Select all")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh repositories" })).toBeDefined();
    expect(screen.getAllByText("No repositories available for this connection.")).toHaveLength(1);
  });
});

function getFieldErrorAt(fieldErrors: readonly HTMLElement[], index: number): HTMLElement {
  const fieldError = fieldErrors[index];
  if (fieldError === undefined) {
    throw new Error(`Expected field error at index ${String(index)}.`);
  }

  return fieldError;
}

function getChipForText(text: string): HTMLElement {
  const chip = screen.getByText(text).closest('[data-slot="combobox-chip"]');
  if (!(chip instanceof HTMLElement)) {
    throw new Error(`Expected combobox chip for ${text}.`);
  }

  return chip;
}
