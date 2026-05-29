// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomePageStoryModels } from "./home-page-view-model.js";
import { HomePageView } from "./home-page-view.js";
import { buildSandboxInstanceListItemFixture } from "./sessions-page.story-fixtures.js";

describe("HomePageView", () => {
  it("renders the current step status mark in desktop and mobile title positions", () => {
    render(
      <HomePageView
        createSessionForm={null}
        onboarding={HomePageStoryModels.addIntegrations}
        recentSessions={[]}
      />,
    );

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
        createSessionForm={null}
        onboarding={HomePageStoryModels.addIntegrations}
        onNavigate={(href) => {
          navigatedHref = href;
        }}
        recentSessions={[]}
      />,
    );

    const actionButton = screen.getByRole("button", { name: "Add integrations" });

    expect(actionButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(actionButton);
    expect(navigatedHref).toBe("/integrations");
  });

  it("renders completed home content top-aligned with page-scale section headings", () => {
    let navigatedHref: string | null = null;

    const { container } = render(
      <HomePageView
        createSessionForm={<div>Session creation form</div>}
        onboarding={HomePageStoryModels.completed}
        onNavigate={(href) => {
          navigatedHref = href;
        }}
        recentSessions={[
          buildSandboxInstanceListItemFixture({
            id: "sbi_home_recent",
            title: "Investigate failing build",
          }),
        ]}
      />,
    );

    expect(container.firstElementChild?.className).toContain("flex w-full flex-col gap-8");
    expect(container.firstElementChild?.className).not.toContain("justify-center");
    expect(container.firstElementChild?.className).not.toContain("mx-auto");
    expect(screen.getByRole("heading", { name: "Start new session" }).className).toContain(
      "text-xl",
    );
    expect(screen.getByRole("heading", { name: "Recent sessions" }).className).toContain("text-xl");
    expect(screen.getByText("Investigate failing build")).toBeDefined();
    expect(screen.getByText("Session creation form")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Investigate failing build" }));
    expect(navigatedHref).toBe("/sessions/sbi_home_recent");
  });
});
