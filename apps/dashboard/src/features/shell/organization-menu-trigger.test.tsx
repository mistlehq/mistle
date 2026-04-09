// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  OrganizationMenuTrigger,
  type OrganizationMenuOrganizationOption,
} from "./organization-menu-trigger.js";

function renderOrganizationMenuTrigger(input: {
  activeOrganizationId?: string | null;
  organizationErrorMessage?: string | null;
  organizationImageUrl?: string | null;
  organizations?: OrganizationMenuOrganizationOption[];
}) {
  render(
    <OrganizationMenuTrigger
      activeOrganizationId={input.activeOrganizationId ?? null}
      isSigningOut={false}
      isSwitchingOrganization={false}
      onNavigateToSettings={() => {}}
      onSignOut={() => {}}
      onSwitchOrganization={() => {}}
      organizationErrorMessage={input.organizationErrorMessage ?? null}
      organizationImageUrl={input.organizationImageUrl ?? null}
      organizationName="Mistle Labs"
      organizations={input.organizations ?? []}
    />,
  );
}

describe("OrganizationMenuTrigger", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the organization trigger without crashing when an image URL is available", () => {
    renderOrganizationMenuTrigger({
      organizationImageUrl: "https://images.example.com/mistle-logo.webp",
    });

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.getByText("Mistle Labs")).toBeTruthy();
  });

  it("falls back to organization initials when no uploaded logo is available", () => {
    renderOrganizationMenuTrigger({});

    expect(screen.queryByRole("img", { name: "Mistle Labs logo" })).toBeNull();
    expect(screen.getByText("ML")).toBeTruthy();
  });

  it("renders a switch organization submenu when more than one organization is available", async () => {
    renderOrganizationMenuTrigger({
      activeOrganizationId: "org_2",
      organizations: [
        { id: "org_1", name: "Acme Corp" },
        { id: "org_2", name: "Mistle Labs" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Organization menu" }));

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.getByText("Mistle Labs")).toBeTruthy();
    expect(screen.getByText("Switch organization")).toBeTruthy();
  });

  it("keeps organization choices visible when the switcher also has an error message", () => {
    renderOrganizationMenuTrigger({
      activeOrganizationId: "org_2",
      organizationErrorMessage: "Unable to load organizations.",
      organizations: [
        { id: "org_1", name: "Acme Corp" },
        { id: "org_2", name: "Mistle Labs" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Organization menu" }));
    fireEvent.click(screen.getByText("Switch organization"));

    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("Unable to load organizations.")).toBeTruthy();
  });

  it("renders the switcher when organization loading fails without any available options", () => {
    renderOrganizationMenuTrigger({
      organizationErrorMessage: "Unable to load organizations.",
      organizations: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Organization menu" }));

    expect(screen.getByText("Switch organization")).toBeTruthy();
  });
});
