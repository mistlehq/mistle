// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { AppSidebarHeader } from "./app-sidebar-header.js";

const baseProps = {
  activeOrganizationId: "org_mistle",
  isSigningOut: false,
  isSwitchingOrganization: false,
  onNavigateToSettings: () => {},
  onSignOut: () => {},
  onSwitchOrganization: () => {},
  organizationSummaryErrorMessage: null,
  organizationSwitcherErrorMessage: null,
  organizationImageUrl: null,
  organizationName: "Mistle Labs",
  organizations: [{ id: "org_mistle", name: "Mistle Labs" }],
} satisfies ComponentProps<typeof AppSidebarHeader>;

function renderAppSidebarHeader(input: {
  defaultOpen: boolean;
  props?: Partial<ComponentProps<typeof AppSidebarHeader>>;
}): void {
  render(
    <SidebarProvider defaultOpen={input.defaultOpen}>
      <AppSidebarHeader {...baseProps} {...input.props} />
    </SidebarProvider>,
  );
}

describe("AppSidebarHeader", () => {
  it("renders the organization menu with a sidebar collapse control while the sidebar is expanded", () => {
    renderAppSidebarHeader({ defaultOpen: true });

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  });

  it("removes the app nav header collapse control after collapsing the sidebar", () => {
    renderAppSidebarHeader({ defaultOpen: true });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).toBeNull();
  });

  it("keeps the collapse control out of the collapsed sidebar header", () => {
    renderAppSidebarHeader({ defaultOpen: false });

    expect(screen.getByRole("button", { name: "Organization menu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).toBeNull();
  });
});
