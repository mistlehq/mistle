// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

describe("OrganizationMenuTrigger", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the organization trigger without crashing when an image URL is available", () => {
    render(
      <OrganizationMenuTrigger
        activeOrganizationId={null}
        isSigningOut={false}
        isSwitchingOrganization={false}
        onNavigateToSettings={() => {}}
        onSignOut={() => {}}
        onSwitchOrganization={() => {}}
        organizationErrorMessage={null}
        organizationImageUrl="https://images.example.com/mistle-logo.webp"
        organizationName="Mistle Labs"
        organizations={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.getByText("Mistle Labs")).toBeTruthy();
  });

  it("falls back to organization initials when no uploaded logo is available", () => {
    render(
      <OrganizationMenuTrigger
        activeOrganizationId={null}
        isSigningOut={false}
        isSwitchingOrganization={false}
        onNavigateToSettings={() => {}}
        onSignOut={() => {}}
        onSwitchOrganization={() => {}}
        organizationErrorMessage={null}
        organizationImageUrl={null}
        organizationName="Mistle Labs"
        organizations={[]}
      />,
    );

    expect(screen.queryByRole("img", { name: "Mistle Labs logo" })).toBeNull();
    expect(screen.getByText("ML")).toBeTruthy();
  });

  it("renders a switch organization submenu when more than one organization is available", async () => {
    render(
      <OrganizationMenuTrigger
        activeOrganizationId="org_2"
        isSigningOut={false}
        isSwitchingOrganization={false}
        onNavigateToSettings={() => {}}
        onSignOut={() => {}}
        onSwitchOrganization={() => {}}
        organizationErrorMessage={null}
        organizationImageUrl={null}
        organizationName="Mistle Labs"
        organizations={[
          { id: "org_1", name: "Acme Corp" },
          { id: "org_2", name: "Mistle Labs" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Organization menu" }));

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.getByText("Mistle Labs")).toBeTruthy();
    expect(screen.getByText("Switch organization")).toBeTruthy();
  });
});
