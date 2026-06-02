// @vitest-environment jsdom

import { listBrowserIntegrationDefinitions } from "@mistle/integrations-definitions/browser";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createAvailableCardsOverview } from "./organization-integrations-settings-page-story-support.js";
import {
  OrganizationIntegrationsSettingsPageView,
  type OrganizationIntegrationsSettingsPageCard,
} from "./organization-integrations-settings-page-view.js";

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
      expect(card?.integrationKind).toBe(definition.kind);
      expect(card?.actionLabel).toBe("Add");
    }
  });

  it("renders integration sections with route-addressable card actions", () => {
    render(
      <MemoryRouter>
        <OrganizationIntegrationsSettingsPageView
          availableCards={[
            createOpenAiCard({
              actionHref: "/integrations/openai-default/add",
            }),
            createGitHubCard(),
          ]}
          connectedCards={[
            createGitHubCard({
              targetKey: "github",
              description: "2 connections",
              actionLabel: "View",
              actionHref: "/integrations/github",
            }),
          ]}
          loadErrorMessage={null}
        />
      </MemoryRouter>,
    );

    const viewAction = screen.getByRole("link", { name: "View" });
    expect(viewAction.tagName).toBe("A");
    expect(viewAction.getAttribute("href")).toBe("/integrations/github");
    const addAction = screen.getByRole("link", { name: "Add" });
    expect(addAction.tagName).toBe("A");
    expect(addAction.getAttribute("href")).toBe("/integrations/openai-default/add");
    expect(screen.getByRole("tab", { name: "Models" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Git" })).toBeTruthy();
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

  it("filters available integrations across category tabs", () => {
    render(
      <MemoryRouter>
        <OrganizationIntegrationsSettingsPageView
          availableCards={[createOpenAiCard(), createGitHubCard()]}
          connectedCards={[]}
          loadErrorMessage={null}
        />
      </MemoryRouter>,
    );

    const searchInput = screen.getByRole("textbox", { name: "Search integrations" });
    fireEvent.change(searchInput, { target: { value: "github" } });

    expect(screen.queryByRole("tab", { name: "Models" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Git" })).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.queryByText("OpenAI")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "not-present" } });

    expect(screen.queryByRole("tab", { name: "Git" })).toBeNull();
    expect(screen.getByText('No integrations match "not-present".')).toBeTruthy();
  });

  it("keeps matching integrations visible when search removes the selected category tab", () => {
    render(
      <MemoryRouter>
        <OrganizationIntegrationsSettingsPageView
          availableCards={[createOpenAiCard(), createGitHubCard()]}
          connectedCards={[]}
          loadErrorMessage={null}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Git" }));

    const searchInput = screen.getByRole("textbox", { name: "Search integrations" });
    fireEvent.change(searchInput, { target: { value: "openai" } });

    expect(screen.getByRole("tab", { name: "Models" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Git" })).toBeNull();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("hides integration directory sections when rendering a detail surface", () => {
    render(
      <MemoryRouter>
        <OrganizationIntegrationsSettingsPageView
          availableCards={[createOpenAiCard()]}
          connectedCards={[
            createGitHubCard({
              targetKey: "github",
              description: "1 connection",
              actionLabel: "View",
            }),
          ]}
          detailSurface={<div>GitHub connection detail</div>}
          loadErrorMessage={null}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View" })).toBeNull();
    expect(screen.getByRole("region", { name: "Integration detail" })).toBeTruthy();
  });
});

function createOpenAiCard(
  input: Partial<OrganizationIntegrationsSettingsPageCard> = {},
): OrganizationIntegrationsSettingsPageCard {
  return createSettingsPageCard({
    targetKey: "openai-default",
    integrationKind: "agent",
    displayName: "OpenAI",
    description: "Bring organization API access into Mistle.",
    ...input,
  });
}

function createGitHubCard(
  input: Partial<OrganizationIntegrationsSettingsPageCard> = {},
): OrganizationIntegrationsSettingsPageCard {
  return createSettingsPageCard({
    targetKey: "github-cloud",
    integrationKind: "git",
    displayName: "GitHub",
    description: "Connect repository access and GitHub events.",
    ...input,
  });
}

function createSettingsPageCard(
  input: Pick<
    OrganizationIntegrationsSettingsPageCard,
    "description" | "displayName" | "integrationKind" | "targetKey"
  > &
    Partial<OrganizationIntegrationsSettingsPageCard>,
): OrganizationIntegrationsSettingsPageCard {
  return {
    actionLabel: "Add",
    actionHref: `/integrations/${input.targetKey}/add`,
    configStatus: "valid",
    ...input,
  };
}
