// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomePageFrame } from "./home-page-frame.js";

describe("HomePageFrame", () => {
  it("renders the beta notice before the onboarding title", () => {
    render(
      <HomePageFrame onboardingState="add_integrations" showMistleCloudBetaNotice>
        <div>Home content</div>
      </HomePageFrame>,
    );

    const noticeTitle = screen.getByText("Mistle Cloud Beta");
    const pageTitle = screen.getByRole("heading", { name: "Get started" });

    expect(noticeTitle.compareDocumentPosition(pageTitle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByText(
        "Mistle Cloud usage is free during beta. Beta limits apply while we tune capacity.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Home content")).toBeDefined();
  });

  it("renders the completed home beta notice without the onboarding title", () => {
    const { container } = render(
      <HomePageFrame onboardingState="completed" showMistleCloudBetaNotice>
        <div>Completed home content</div>
      </HomePageFrame>,
    );

    expect(screen.getByText("Mistle Cloud Beta")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Get started" })).toBeNull();
    expect(screen.getByText("Completed home content")).toBeDefined();
    expect(container.firstElementChild?.className).toContain("bg-muted/30");
    expect(container.firstElementChild?.className).toContain("gap-8");
  });

  it("renders the onboarding title without the beta notice when the notice is disabled", () => {
    render(
      <HomePageFrame onboardingState="add_integrations" showMistleCloudBetaNotice={false}>
        <div>Home content</div>
      </HomePageFrame>,
    );

    expect(screen.queryByText("Mistle Cloud Beta")).toBeNull();
    expect(screen.getByRole("heading", { name: "Get started" })).toBeDefined();
    expect(screen.getByText("Home content")).toBeDefined();
  });

  it("omits the header shell for completed home when the beta notice is disabled", () => {
    const { container } = render(
      <HomePageFrame onboardingState="completed" showMistleCloudBetaNotice={false}>
        <div>Completed home content</div>
      </HomePageFrame>,
    );

    expect(screen.queryByText("Mistle Cloud Beta")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Get started" })).toBeNull();
    expect(container.querySelector('[data-slot="page-frame-header-shell"]')).toBeNull();
    expect(screen.getByText("Completed home content")).toBeDefined();
  });
});
