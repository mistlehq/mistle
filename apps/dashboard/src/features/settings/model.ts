import { HardDrivesIcon, SlidersHorizontalIcon, UserIcon, UsersIcon } from "@phosphor-icons/react";
import { createElement } from "react";

import type { SidebarNavGroup } from "../navigation/sidebar-nav-model.js";
import type { OrganizationRole } from "./members/members-api-types.js";

export const SETTINGS_ROOT_PATH = "/settings";
export const SETTINGS_DEFAULT_PATH = "/settings/account/profile";

export const SETTINGS_NAV_GROUPS: readonly SidebarNavGroup[] = resolveSettingsNavGroups({
  organizationRole: null,
});

export function resolveSettingsNavGroups(input: {
  organizationRole: OrganizationRole | null;
}): readonly SidebarNavGroup[] {
  return [
    {
      label: "Account",
      items: [{ to: "/settings/account/profile", label: "Profile", icon: ProfileNavIcon }],
    },
    {
      label: "Organization",
      items: [
        {
          to: "/settings/organization/general",
          label: "General",
          icon: GeneralNavIcon,
        },
        {
          to: "/settings/organization/members",
          label: "Members",
          icon: MembersNavIcon,
        },
        ...(shouldRenderSandboxStorageSettingsNavItem({
          organizationRole: input.organizationRole,
        })
          ? [
              {
                to: "/settings/organization/sandboxes",
                label: "Sandboxes",
                icon: SandboxStorageNavIcon,
              },
            ]
          : []),
      ],
    },
  ];
}

export function isSettingsPath(pathname: string): boolean {
  return pathname === SETTINGS_ROOT_PATH || pathname.startsWith(`${SETTINGS_ROOT_PATH}/`);
}

export function resolveSettingsBackDestination(lastNonSettingsPath: string | null): string {
  if (lastNonSettingsPath === null || isSettingsPath(lastNonSettingsPath)) {
    return "/";
  }

  return lastNonSettingsPath;
}

function ProfileNavIcon(props: { className?: string; "aria-hidden"?: boolean }): React.JSX.Element {
  return createElement(UserIcon, props);
}

function GeneralNavIcon(props: { className?: string; "aria-hidden"?: boolean }): React.JSX.Element {
  return createElement(SlidersHorizontalIcon, props);
}

function MembersNavIcon(props: { className?: string; "aria-hidden"?: boolean }): React.JSX.Element {
  return createElement(UsersIcon, props);
}

function SandboxStorageNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return createElement(HardDrivesIcon, props);
}

function shouldRenderSandboxStorageSettingsNavItem(input: {
  organizationRole: OrganizationRole | null;
}): boolean {
  return input.organizationRole === "owner" || input.organizationRole === "admin";
}
