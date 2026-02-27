import type { AppRouteHandle, RouteTextResolverInput, RouteTextValue } from "./route-meta.js";

type SettingsPageRouteHandle = AppRouteHandle & {
  breadcrumb: RouteTextValue;
  title: RouteTextValue;
  description: RouteTextValue;
};

function toTitleCaseWord(value: string): string {
  const [head = "", ...tail] = value;
  return `${head.toUpperCase()}${tail.join("")}`;
}

function normalizeProviderBreadcrumbLabel(providerId: string): string {
  const normalizedId = providerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedId.length === 0) {
    return "Provider";
  }

  if (normalizedId === "github") {
    return "GitHub";
  }

  if (normalizedId === "openai") {
    return "OpenAI";
  }

  return normalizedId.split(" ").map(toTitleCaseWord).join(" ");
}

function resolveProviderCallbackBreadcrumb(input: RouteTextResolverInput): string {
  const providerId = input.params["providerId"];
  if (providerId === undefined || providerId.trim().length === 0) {
    return "Callback result";
  }

  return `${normalizeProviderBreadcrumbLabel(providerId)} callback`;
}

function resolveSandboxProfileDetailBreadcrumb(input: RouteTextResolverInput): string {
  const data = input.data;
  if (typeof data === "object" && data !== null) {
    const displayName = Reflect.get(data, "displayName");
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      return displayName;
    }
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
  settingsOrganizationProviders: {
    breadcrumb: "Providers",
    title: "Providers",
    description: "",
  },
  settingsOrganizationProviderCallbackResult: {
    breadcrumb: resolveProviderCallbackBreadcrumb,
    title: "Provider callback result",
    description: "Review provider connection callback outcome.",
  },
} as const satisfies Record<string, AppRouteHandle>;

export const SETTINGS_PAGE_ROUTE_HANDLE_KEYS = [
  "settingsPersonal",
  "settingsOrganizationGeneral",
  "settingsOrganizationMembers",
  "settingsOrganizationProviders",
  "settingsOrganizationProviderCallbackResult",
] as const;

export const SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT: {
  [Key in (typeof SETTINGS_PAGE_ROUTE_HANDLE_KEYS)[number]]: SettingsPageRouteHandle;
} = {
  settingsPersonal: ROUTE_HANDLES.settingsPersonal,
  settingsOrganizationGeneral: ROUTE_HANDLES.settingsOrganizationGeneral,
  settingsOrganizationMembers: ROUTE_HANDLES.settingsOrganizationMembers,
  settingsOrganizationProviders: ROUTE_HANDLES.settingsOrganizationProviders,
  settingsOrganizationProviderCallbackResult:
    ROUTE_HANDLES.settingsOrganizationProviderCallbackResult,
};
