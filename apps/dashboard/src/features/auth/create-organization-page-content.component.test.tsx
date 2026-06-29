// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { CreateOrganizationPageContent } from "./create-organization-page-content.js";

const BaseProps = {
  createOrganizationError: null,
  isCreatingOrganization: false,
  isSigningOut: false,
  onCreateOrganization: () => {},
  onOrganizationNameChange: () => {},
  organizationName: "",
  organizationNameError: null,
} satisfies Omit<ComponentProps<typeof CreateOrganizationPageContent>, "onCancel" | "onSignOut">;

describe("CreateOrganizationPageContent", () => {
  it("shows cancel instead of sign out when creation is optional", () => {
    render(<CreateOrganizationPageContent {...BaseProps} onCancel={() => {}} onSignOut={null} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
  });

  it("shows sign out instead of cancel when creation is mandatory", () => {
    render(<CreateOrganizationPageContent {...BaseProps} onCancel={null} onSignOut={() => {}} />);

    expect(screen.getByRole("button", { name: "Sign Out" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("autofocuses the organization name input", () => {
    render(<CreateOrganizationPageContent {...BaseProps} onCancel={null} onSignOut={() => {}} />);

    expect(screen.getByLabelText("Organization name")).toBe(document.activeElement);
  });
});
