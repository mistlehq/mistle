// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomePageStoryModels } from "./home-page-view-model.js";
import { HomePageShell, HomePageView } from "./home-page-view.js";

describe("HomePageView", () => {
  it("centers the constrained home page shell content", () => {
    const { container } = render(
      <HomePageShell>
        <HomePageView onboarding={HomePageStoryModels.addIntegrations} />
      </HomePageShell>,
    );

    const title = screen.getByRole("heading", { name: "Get started" });
    const contentContainer = title.parentElement;

    expect(container.firstElementChild?.className).toContain("px-4");
    expect(contentContainer?.className).toContain("mx-auto");
    expect(contentContainer?.className).toContain("max-w-4xl");
  });

  it("renders the current step status mark in desktop and mobile title positions", () => {
    render(<HomePageView onboarding={HomePageStoryModels.addIntegrations} />);

    const addIntegrationsTitle = screen.getByText("Add integrations", { selector: "p" });
    const titleRow = addIntegrationsTitle.parentElement;
    const textBlock = titleRow?.parentElement;
    const contentRow = textBlock?.parentElement;

    expect(titleRow?.className).toContain("items-center");
    expect(titleRow?.querySelector(".sm\\:hidden")).toBeTruthy();
    expect(contentRow?.querySelector(".sm\\:flex")).toBeTruthy();
    expect(contentRow?.querySelectorAll(".rounded-full")).toHaveLength(2);
  });

  it("keeps the current-step action enabled and forwards navigation", () => {
    let navigatedHref: string | null = null;

    render(
      <HomePageView
        onboarding={HomePageStoryModels.addIntegrations}
        onNavigate={(href) => {
          navigatedHref = href;
        }}
      />,
    );

    const actionButton = screen.getByRole("button", { name: "Add integrations" });

    expect(actionButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(actionButton);
    expect(navigatedHref).toBe("/settings/organization/integrations");
  });
});
