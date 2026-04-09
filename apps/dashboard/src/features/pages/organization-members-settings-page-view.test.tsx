// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";
import {
  createOrganizationMembersSettingsPageStoryArgs,
  OrganizationMembersStoryInvitations,
} from "./organization-members-settings-page-view.story-fixtures.js";

describe("OrganizationMembersSettingsPageView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders members and invitations tabs with a shared invite action", () => {
    render(
      <OrganizationMembersSettingsPageView {...createOrganizationMembersSettingsPageStoryArgs()} />,
    );

    expect(screen.getByRole("tab", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Invitations" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite members" })).toBeTruthy();
  });

  it("switches tabs through the page-level filter handler", () => {
    const filterChanges: string[] = [];

    render(
      <OrganizationMembersSettingsPageView
        {...createOrganizationMembersSettingsPageStoryArgs()}
        onFilterChange={(nextValue) => {
          filterChanges.push(nextValue);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Invitations" }));

    expect(filterChanges).toEqual(["invitations"]);
  });

  it("renders invitation rows when the invitations tab is active", () => {
    render(
      <OrganizationMembersSettingsPageView
        {...createOrganizationMembersSettingsPageStoryArgs({
          activeFilter: "invitations",
          invitations: OrganizationMembersStoryInvitations,
          members: [],
          total: OrganizationMembersStoryInvitations.length,
        })}
      />,
    );

    expect(screen.getAllByText("pending@mistle.so")).toHaveLength(2);
    expect(screen.queryByText("storybook@mistle.so")).toBeNull();
  });
});
