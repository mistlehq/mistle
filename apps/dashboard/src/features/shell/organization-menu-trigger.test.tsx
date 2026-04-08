// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

describe("OrganizationMenuTrigger", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the organization trigger without crashing when an image URL is available", () => {
    render(
      <OrganizationMenuTrigger
        isSigningOut={false}
        onNavigateToSettings={() => {}}
        onSignOut={() => {}}
        organizationErrorMessage={null}
        organizationImageUrl="https://images.example.com/mistle-logo.webp"
        organizationName="Mistle Labs"
      />,
    );

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.getByText("Mistle Labs")).toBeTruthy();
  });

  it("falls back to organization initials when no uploaded logo is available", () => {
    render(
      <OrganizationMenuTrigger
        isSigningOut={false}
        onNavigateToSettings={() => {}}
        onSignOut={() => {}}
        organizationErrorMessage={null}
        organizationImageUrl={null}
        organizationName="Mistle Labs"
      />,
    );

    expect(screen.queryByRole("img", { name: "Mistle Labs logo" })).toBeNull();
    expect(screen.getByText("ML")).toBeTruthy();
  });
});
