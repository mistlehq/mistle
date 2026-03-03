import { PuzzlePieceIcon, SlidersHorizontalIcon, UserIcon, UsersIcon } from "@phosphor-icons/react";
import { createElement } from "react";

import type { SidebarNavGroup } from "../navigation/sidebar-nav-model.js";

export const SETTINGS_ROOT_PATH = "/settings";
export const SETTINGS_DEFAULT_PATH = "/settings/account/profile";

export const SETTINGS_NAV_GROUPS: readonly SidebarNavGroup[] = [
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
      {
        to: "/settings/organization/integrations",
        label: "Integrations",
        icon: IntegrationsNavIcon,
      },
    ],
  },
];

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

function IntegrationsNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return createElement(PuzzlePieceIcon, props);
}
