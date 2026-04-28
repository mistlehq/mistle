// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import { IntegrationResourcePickerView } from "./integration-resource-picker-view.js";

afterEach(() => {
  cleanup();
});

const RepositoryItems: readonly IntegrationConnectionResource[] = [
  {
    id: "repo_1",
    familyId: "repo_family_1",
    kind: "repository",
    displayName: "mistle/main-dashboard",
    status: "accessible",
    metadata: {},
    handle: "mistle/main-dashboard",
  },
];

describe("IntegrationResourcePickerView", () => {
  it("uses the provided search placeholder instead of hard-coded repository copy", () => {
    render(
      <IntegrationResourcePickerView
        emptyMessage="No repositories available for this connection."
        id="resource-picker"
        isRefreshing={false}
        label="Repositories"
        listState={{
          mode: "ready",
          items: RepositoryItems,
        }}
        onBlur={() => {}}
        onFocus={() => {}}
        onRefresh={() => {}}
        onSearchChange={() => {}}
        onSelectionChange={() => {}}
        onToggleAll={() => {}}
        refreshErrorMessage={null}
        refreshLabel="Refresh repositories"
        refreshTooltip="Refresh repositories"
        search=""
        searchPlaceholder="Search 1 repository"
        selectedHandles={[]}
        unavailableSelectedHandles={[]}
        visibleItems={RepositoryItems}
      />,
    );

    expect(screen.getByPlaceholderText("Search 1 repository")).toBeDefined();
    expect(screen.queryByPlaceholderText("Select repositories")).toBeNull();
  });
});
