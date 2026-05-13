// @vitest-environment jsdom

import { listBrowserIntegrationDefinitions } from "@mistle/integrations-definitions/browser";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAvailableCardsOverview } from "./organization-integrations-settings-page-story-support.js";
import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";

describe("OrganizationIntegrationsSettingsPageView", () => {
  it("builds the overview story cards from every browser integration definition", () => {
    const cards = createAvailableCardsOverview();
    const definitions = [...listBrowserIntegrationDefinitions()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );

    expect(cards.map((card) => card.targetKey)).toEqual(
      definitions.map((definition) => definition.variantId),
    );

    for (const definition of definitions) {
      const card = cards.find((candidate) => candidate.targetKey === definition.variantId);
      expect(card).toBeDefined();
      expect(card?.displayName).toBe(definition.displayName);
      expect(card?.description).toBe(definition.description);
      expect(card?.actionLabel).toBe("Add");
    }
  });

  it("renders integration sections and forwards card actions", () => {
    let selectedTargetKey: string | null = null;

    render(
      <OrganizationIntegrationsSettingsPageView
        availableCards={[
          {
            targetKey: "openai-default",
            displayName: "OpenAI",
            description: "Bring organization API access into Mistle.",
            configStatus: "valid",
            actionLabel: "Add",
            onAction: () => {
              selectedTargetKey = "openai-default";
            },
          },
        ]}
        connectedCards={[
          {
            targetKey: "github",
            displayName: "GitHub",
            description: "2 connections",
            configStatus: "valid",
            actionLabel: "View",
            onAction: () => {
              selectedTargetKey = "github";
            },
          },
        ]}
        loadErrorMessage={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(selectedTargetKey).toBe("github");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
  });

  it("renders load errors without a retry action", () => {
    render(
      <OrganizationIntegrationsSettingsPageView
        availableCards={[]}
        connectedCards={[]}
        loadErrorMessage="Could not load integrations."
      />,
    );

    expect(screen.getByText("Could not load integrations. Please try again later.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("hides integration directory sections when rendering a detail surface", () => {
    render(
      <OrganizationIntegrationsSettingsPageView
        availableCards={[
          {
            targetKey: "openai-default",
            displayName: "OpenAI",
            description: "Bring organization API access into Mistle.",
            configStatus: "valid",
            actionLabel: "Add",
            onAction: () => {},
          },
        ]}
        connectedCards={[
          {
            targetKey: "github",
            displayName: "GitHub",
            description: "1 connection",
            configStatus: "valid",
            actionLabel: "View",
            onAction: () => {},
          },
        ]}
        detailSurface={<div>GitHub connection detail</div>}
        loadErrorMessage={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    expect(screen.getByRole("region", { name: "Integration detail" })).toBeTruthy();
  });
});
