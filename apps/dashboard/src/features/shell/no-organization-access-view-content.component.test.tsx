// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NoOrganizationAccessViewContent } from "./no-organization-access-view-content.js";

describe("NoOrganizationAccessViewContent", () => {
  it("autofocuses the organization name input", () => {
    render(
      <NoOrganizationAccessViewContent
        canCreateOrganization
        createOrganizationError={null}
        isCreatingOrganization={false}
        isSigningOut={false}
        onCreateOrganization={() => {}}
        onOrganizationNameChange={() => {}}
        onSignOut={() => {}}
        organizationName=""
        organizationNameError={null}
      />,
    );

    expect(screen.getByLabelText("Organization name")).toBe(document.activeElement);
  });

  it("shows administrator invite guidance when organization creation is unavailable", () => {
    render(
      <NoOrganizationAccessViewContent
        canCreateOrganization={false}
        createOrganizationError={null}
        isCreatingOrganization={false}
        isSigningOut={false}
        onCreateOrganization={() => {}}
        onOrganizationNameChange={() => {}}
        onSignOut={() => {}}
        organizationName=""
        organizationNameError={null}
      />,
    );

    expect(
      screen.getByText(
        "Your account is not connected to an organization. Ask your administrator for an invite.",
      ),
    ).toBeDefined();
    expect(screen.queryByLabelText("Organization name")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeDefined();
  });
});
