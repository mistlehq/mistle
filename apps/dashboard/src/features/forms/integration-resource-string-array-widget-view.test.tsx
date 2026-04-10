// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RepositoryItems } from "./integration-resource-string-array-widget-story-support.js";
import { IntegrationResourceStringArrayWidgetView } from "./integration-resource-string-array-widget-view.js";

describe("IntegrationResourceStringArrayWidgetView", () => {
  it("keeps stale search results visible but disables selection while results are updating", () => {
    const toggledHandles: string[] = [];
    let toggleAllCount = 0;

    render(
      <IntegrationResourceStringArrayWidgetView
        emptyMessage="No repositories available for this connection."
        id="repositories"
        isRefreshing={false}
        isUpdatingSearchResults
        label="Repositories"
        listState={{
          mode: "ready",
          items: RepositoryItems,
        }}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={() => {}}
        onSearchChange={() => {}}
        onToggleAll={() => {
          toggleAllCount += 1;
        }}
        onToggleHandle={(handle) => {
          toggledHandles.push(handle);
        }}
        refreshErrorMessage={null}
        refreshLabel="Refresh repositories"
        refreshTooltip="Refresh repositories"
        search="mistle"
        searchPlaceholder="Search repositories"
        selectedHandles={[]}
        unavailableSelectedHandles={[]}
        visibleItems={RepositoryItems}
      />,
    );

    expect(screen.getByText("Updating results...")).toBeTruthy();

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true);

    checkboxes[0]?.click();
    checkboxes[1]?.click();

    expect(toggleAllCount).toBe(0);
    expect(toggledHandles).toEqual([]);
    expect(screen.getByText("mistle/main-dashboard")).toBeTruthy();
  });
});
