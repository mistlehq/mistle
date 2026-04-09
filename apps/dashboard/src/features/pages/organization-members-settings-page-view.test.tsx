// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";
import {
  createOrganizationMembersSettingsPageStoryViewModel,
  OrganizationMembersStoryInvitations,
} from "./organization-members-settings-page-view.story-fixtures.js";

describe("OrganizationMembersSettingsPageView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders active and invited tabs with a shared invite action", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageStoryViewModel()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Active" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Invited" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite members" })).toBeTruthy();
  });

  it("switches tabs through the page-level filter handler", () => {
    const filterChanges: string[] = [];

    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageStoryViewModel({
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
        viewModel={createOrganizationMembersSettingsPageStoryViewModel({
          activeFilter: "invitations",
          invitations: OrganizationMembersStoryInvitations,
          members: [],
          total: OrganizationMembersStoryInvitations.length,
        })}
      />,
    );

    expect(screen.getAllByText("pending@mistle.so")).toHaveLength(1);
    expect(screen.queryByText("storybook@mistle.so")).toBeNull();
  });

  it("disables pagination controls while the active list is refetching", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageStoryViewModel({
          hasNextPage: true,
          hasPreviousPage: true,
          isListFetching: true,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a non-blocking notice when a refetch fails after data has loaded", () => {
    render(
      <OrganizationMembersSettingsPageView
        viewModel={createOrganizationMembersSettingsPageStoryViewModel({
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
        viewModel={createOrganizationMembersSettingsPageStoryViewModel({
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
