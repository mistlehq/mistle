import { z } from "zod";

import type { AppRouteHandle, RouteTextResolverInput, RouteTextValue } from "./route-meta.js";

type SettingsPageRouteHandle = AppRouteHandle & {
  breadcrumb: RouteTextValue;
  title: RouteTextValue;
  description: RouteTextValue;
};

const SandboxProfileRouteDataSchema = z.object({
  displayName: z.string().trim().min(1),
});

function toTitleCaseWord(value: string): string {
  const [head = "", ...tail] = value;
  return `${head.toUpperCase()}${tail.join("")}`;
}

function normalizeIntegrationBreadcrumbLabel(targetKey: string): string {
  const normalizedId = targetKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedId.length === 0) {
    return "Integration";
  }

  return normalizedId.split(" ").map(toTitleCaseWord).join(" ");
}

function resolveIntegrationCallbackBreadcrumb(input: RouteTextResolverInput): string {
  const targetKey = input.params["targetKey"];
  if (targetKey === undefined || targetKey.trim().length === 0) {
    return "Callback result";
  }

  return `${normalizeIntegrationBreadcrumbLabel(targetKey)} callback`;
}

function resolveSandboxProfileDetailBreadcrumb(input: RouteTextResolverInput): string {
  const parsedData = SandboxProfileRouteDataSchema.safeParse(input.data);
  if (parsedData.success) {
    return parsedData.data.displayName;
  }

  const profileId = input.params["profileId"];
  if (profileId === undefined || profileId.trim().length === 0) {
    return "Profile";
  }

  return profileId;
}

export const ROUTE_HANDLES = {
  dashboard: {
    breadcrumb: "Home",
    title: "Home",
    description: "",
  },
  sessions: {
    breadcrumb: "Sessions",
    title: "Sessions",
    description: "",
  },
  experimentalTerminal: {
    breadcrumb: "Experimental terminal",
    title: "Experimental terminal",
    description: "",
  },
  sandboxProfiles: {
    breadcrumb: "Sandbox Profiles",
    title: "Sandbox Profiles",
    description: "Manage sandbox profile configuration.",
  },
  sandboxProfilesNew: {
    breadcrumb: "Create",
    title: "Create",
    description: "Create a sandbox profile.",
  },
  sandboxProfilesDetail: {
    breadcrumb: resolveSandboxProfileDetailBreadcrumb,
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
  },
  settings: {
    breadcrumb: "Settings",
    breadcrumbClickable: false,
    title: "Settings",
    description: "Manage personal and organization settings.",
  },
  settingsPersonal: {
    breadcrumb: "Personal",
    title: "Personal",
    description: "",
  },
  settingsAccount: {
    breadcrumb: "Account",
    breadcrumbClickable: false,
  },
  settingsProfile: {
    breadcrumb: "Profile",
    title: "Profile",
    description: "",
  },
  settingsOrganization: {
    breadcrumb: "Organization",
    breadcrumbTo: "/settings/organization/general",
  },
  settingsOrganizationGeneral: {
    breadcrumb: "General",
    title: "General",
    description: "",
  },
  settingsOrganizationMembers: {
    breadcrumb: "Members",
    title: "Members",
    description: "",
  },
  settingsOrganizationIntegrations: {
    breadcrumb: "Integrations",
    title: "Integrations",
    description: "",
  },
  settingsOrganizationIntegrationCallbackResult: {
    breadcrumb: resolveIntegrationCallbackBreadcrumb,
    title: "Integration callback result",
    description: "Review integration connection callback outcome.",
  },
} as const satisfies Record<string, AppRouteHandle>;

export const SETTINGS_PAGE_ROUTE_HANDLE_KEYS = [
  "settingsPersonal",
  "settingsOrganizationGeneral",
  "settingsOrganizationMembers",
  "settingsOrganizationIntegrations",
  "settingsOrganizationIntegrationCallbackResult",
] as const;

export const SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT: {
  [Key in (typeof SETTINGS_PAGE_ROUTE_HANDLE_KEYS)[number]]: SettingsPageRouteHandle;
} = {
  settingsPersonal: ROUTE_HANDLES.settingsPersonal,
  settingsOrganizationGeneral: ROUTE_HANDLES.settingsOrganizationGeneral,
  settingsOrganizationMembers: ROUTE_HANDLES.settingsOrganizationMembers,
  settingsOrganizationIntegrations: ROUTE_HANDLES.settingsOrganizationIntegrations,
  settingsOrganizationIntegrationCallbackResult:
    ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult,
};
