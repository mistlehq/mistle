// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { HomePageStoryModels } from "./home-page-view-model.js";
import { HomePageView } from "./home-page-view.js";
import { buildSandboxInstanceListItemFixture } from "./sessions-page.story-fixtures.js";

describe("HomePageView", () => {
  it("renders the current step status mark in desktop and mobile title positions", () => {
    render(
      <MemoryRouter>
        <HomePageView
          createSessionForm={null}
          onboarding={HomePageStoryModels.addIntegrations}
          recentSessions={[]}
        />
      </MemoryRouter>,
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

  it("renders the current-step action as a route-addressable link", () => {
    render(
      <MemoryRouter>
        <HomePageView
          createSessionForm={null}
          onboarding={HomePageStoryModels.addIntegrations}
          recentSessions={[]}
        />
      </MemoryRouter>,
    );

    const actionButton = screen.getByRole("link", { name: "Add integrations" });

    expect(actionButton.tagName).toBe("A");
    expect(actionButton.getAttribute("href")).toBe("/integrations");
  });

  it("renders completed home content top-aligned with page-scale section headings", () => {
    const { container } = render(
      <MemoryRouter>
        <HomePageView
          createSessionForm={<div>Session creation form</div>}
          onboarding={HomePageStoryModels.completed}
          recentSessions={[
            buildSandboxInstanceListItemFixture({
              id: "sbi_home_recent",
              title: "Investigate failing build",
            }),
          ]}
        />
      </MemoryRouter>,
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
    expect(
      screen.getByRole("link", { name: "Investigate failing build" }).getAttribute("href"),
    ).toBe("/sessions/sbi_home_recent");
    expect(
      screen.getByText("Investigate failing build").closest(".group\\/session-row")?.className,
    ).not.toContain("hover:bg-muted");
  });
});
