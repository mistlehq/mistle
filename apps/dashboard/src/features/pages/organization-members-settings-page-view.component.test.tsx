// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createOrganizationMembersSettingsPageFixtureRoleViewModel,
  createOrganizationMembersSettingsPageFixtureViewModel,
  OrganizationMembersFixtureInvitations,
} from "./organization-members-settings-page-view.fixtures.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";

describe("OrganizationMembersSettingsPageView", () => {
  it("renders active and invited tabs with a shared invite action", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageFixtureViewModel()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Active" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Invited" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite members" })).toBeTruthy();
  });

  it("hides the invite action for members who cannot manage invitations", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageFixtureRoleViewModel({
          viewerRole: "member",
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Invite members" })).toBeNull();
  });

  it("switches tabs through the page-level filter handler", () => {
    const filterChanges: string[] = [];

    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageFixtureViewModel({
          onFilterChange: (nextValue) => {
            filterChanges.push(nextValue);
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Invited" }));

    expect(filterChanges).toEqual(["invitations"]);
  });

  it("renders invitation rows when the invitations tab is active", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageFixtureViewModel({
          activeFilter: "invitations",
          invitations: OrganizationMembersFixtureInvitations,
          members: [],
          total: OrganizationMembersFixtureInvitations.length,
        })}
      />,
    );

    expect(screen.getAllByText("pending@mistle.so")).toHaveLength(1);
    expect(screen.queryByText("storybook@mistle.so")).toBeNull();
  });

  it("disables pagination controls while the active list is refetching", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageFixtureViewModel({
          hasNextPage: true,
          hasPreviousPage: true,
          isListFetching: true,
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Go to previous page" }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Go to next page" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("shows a non-blocking notice when a refetch fails after data has loaded", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageFixtureViewModel({
          listErrorNoticeMessage: "Failed to load members.",
        })}
      />,
    );

    expect(screen.getByText("Could not refresh directory")).toBeTruthy();
    expect(screen.getByText("Storybook Tester")).toBeTruthy();
    expect(screen.queryByText("Please try again later.", { exact: true })).toBeNull();
  });

  it("renders the blocking load error state for the initial directory load failure", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageFixtureViewModel({
          members: [],
          total: 0,
          loadErrorMessage: "Failed to load members.",
        })}
      />,
    );

    expect(screen.getByText("Failed to load members. Please try again later.")).toBeTruthy();
    expect(screen.queryByText("Storybook Tester")).toBeNull();
  });
});
