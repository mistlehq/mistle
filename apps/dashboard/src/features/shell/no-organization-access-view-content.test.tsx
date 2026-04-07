// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NoOrganizationAccessViewContent } from "./no-organization-access-view-content.js";

describe("NoOrganizationAccessViewContent", () => {
  it("autofocuses the organization name input", () => {
    render(
      <NoOrganizationAccessViewContent
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
});
