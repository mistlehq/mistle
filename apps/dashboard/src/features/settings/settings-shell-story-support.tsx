import type React from "react";
import { useLocation } from "react-router";

import {
  createOrganizationGeneralSettingsFixtureContent,
  createOrganizationMembersSettingsFixtureContent,
  createProfileSettingsFixtureContent,
  createSettingsFixtureInviteMembersButton,
} from "./settings-fixtures.js";
import type { SettingsShellViewProps } from "./settings-shell-view.js";
import { SettingsShellView } from "./settings-shell-view.js";

export const SettingsShellStoryPathnames = {
  ACCOUNT_PROFILE: "/settings/account/profile",
  ORGANIZATION_GENERAL: "/settings/organization/general",
  ORGANIZATION_INTEGRATIONS: "/settings/organization/integrations",
  ORGANIZATION_MEMBERS: "/settings/organization/members",
} as const;

function createStoryBreadcrumb(text: string): React.JSX.Element {
  return <p className="truncate text-sm">{text}</p>;
}

export function createSettingsShellStoryProps(pathname: string): SettingsShellViewProps {
  if (pathname === SettingsShellStoryPathnames.ACCOUNT_PROFILE) {
    return {
      backLabel: "Back",
      breadcrumbs: createStoryBreadcrumb("Settings / Profile"),
      content: createProfileSettingsFixtureContent(),
      headerActions: null,
      layoutVariant: "form",
      onBack: () => {},
      pathname,
      showBreadcrumbs: true,
      supportingText: "Update your name and account information.",
      title: "Profile",
    };
  }

  if (pathname === SettingsShellStoryPathnames.ORGANIZATION_GENERAL) {
    return {
      backLabel: "Back",
      breadcrumbs: createStoryBreadcrumb("Settings / Organization / General"),
      content: createOrganizationGeneralSettingsFixtureContent(),
      headerActions: null,
      layoutVariant: "form",
      onBack: () => {},
      pathname,
      showBreadcrumbs: true,
      supportingText: "Manage the organization name and defaults.",
      title: "General",
    };
  }

  if (pathname === SettingsShellStoryPathnames.ORGANIZATION_MEMBERS) {
    return {
      backLabel: "Back",
      breadcrumbs: createStoryBreadcrumb("Settings / Organization / Members"),
      content: createOrganizationMembersSettingsFixtureContent(),
      headerActions: createSettingsFixtureInviteMembersButton(),
      layoutVariant: "default",
      onBack: () => {},
      pathname,
      showBreadcrumbs: true,
      supportingText: "Invite members, update roles, and review pending invitations.",
      title: "Members",
    };
  }

  throw new Error(`Unsupported settings story pathname: ${pathname}`);
}

export function SettingsShellStoryForCurrentLocation(): React.JSX.Element {
  const location = useLocation();

  return <SettingsShellView {...createSettingsShellStoryProps(location.pathname)} />;
}
