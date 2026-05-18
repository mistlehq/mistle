import { listBrowserIntegrationDefinitions } from "@mistle/integrations-definitions/browser";
import { createElement } from "react";

import { IntegrationLogo } from "../integrations/integration-logo.js";
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

function resolveIntegrationDefinitionMetadata(targetKey: string): {
  displayName: string;
  logoKey: string;
} | null {
  const definitions = listBrowserIntegrationDefinitions();
  const definition =
    definitions.find((candidate) => candidate.variantId === targetKey) ??
    definitions.find((candidate) => candidate.familyId === targetKey) ??
    null;

  if (definition === null) {
    return null;
  }

  return {
    displayName: definition.displayName,
    logoKey: definition.logoKey,
  };
}

function resolveIntegrationDetailTitle(input: RouteTextResolverInput): string {
  const targetKey = input.params["targetKey"];
  if (targetKey === undefined || targetKey.trim().length === 0) {
    return "Connection";
  }

  const metadata = resolveIntegrationDefinitionMetadata(targetKey);
  if (metadata !== null) {
    return metadata.displayName;
  }

  return normalizeIntegrationBreadcrumbLabel(targetKey);
}

function resolveIntegrationBreadcrumbIcon(input: RouteTextResolverInput): React.ReactNode | null {
  const targetKey = input.params["targetKey"];
  if (targetKey === undefined || targetKey.trim().length === 0) {
    return null;
  }

  const metadata = resolveIntegrationDefinitionMetadata(targetKey);
  if (metadata === null) {
    return null;
  }

  return createElement(IntegrationLogo, {
    alt: "",
    className: "h-5 w-5 rounded-sm",
    logoKey: metadata.logoKey,
  });
}

function resolveIntegrationCreateTitle(input: RouteTextResolverInput): string {
  return `Add ${resolveIntegrationDetailTitle(input)} Connection`;
}

function resolveIntegrationEditTitle(input: RouteTextResolverInput): string {
  return `Edit ${resolveIntegrationDetailTitle(input)} Connection`;
}

function resolveIntegrationAppSetupTitle(input: RouteTextResolverInput): string {
  return `Setup ${resolveIntegrationDetailTitle(input)} App`;
}

function resolveIntegrationDetailHeaderIcon(input: RouteTextResolverInput): React.ReactNode | null {
  const targetKey = input.params["targetKey"];
  if (targetKey === undefined || targetKey.trim().length === 0) {
    return null;
  }

  const metadata = resolveIntegrationDefinitionMetadata(targetKey);
  if (metadata === null) {
    return createElement(
      "span",
      {
        className:
          "inline-flex h-11 w-11 items-center justify-center rounded-md border bg-muted text-sm font-semibold uppercase",
      },
      normalizeIntegrationBreadcrumbLabel(targetKey).slice(0, 1),
    );
  }

  return createElement(IntegrationLogo, {
    alt: `${metadata.displayName} logo`,
    className: "h-11 w-11 rounded-md border bg-background p-1.5",
    logoKey: metadata.logoKey,
  });
}

function resolveTriggerDetailBreadcrumb(_input: RouteTextResolverInput): string {
  return "Edit";
}

export const ROUTE_HANDLES = {
  dashboard: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Home",
    title: "Home",
    description: "",
  },
  integrations: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Integrations",
    title: "Integrations",
    description: "",
  },
  integrationDetail: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: resolveIntegrationDetailTitle,
    breadcrumbIcon: resolveIntegrationBreadcrumbIcon,
    pageBreadcrumbVisible: true,
    title: resolveIntegrationDetailTitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  integrationCreate: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Add",
    title: resolveIntegrationCreateTitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  integrationEdit: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Edit",
    title: resolveIntegrationEditTitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  integrationSetup: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Setup",
    title: resolveIntegrationAppSetupTitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  sessions: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Sessions",
    title: "Sessions",
    description: "",
  },
  sessionsNew: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "New",
    title: "New session",
    description: "Start a sandbox-backed session from a sandbox profile.",
  },
  sessionsDetail: {
    sidebarTriggerOwner: "workspace",
    hideBreadcrumb: true,
    title: "Session",
    description: "Interact with one sandbox-backed Codex session.",
  },
  experimentalTerminal: {
    sidebarTriggerOwner: "none",
    breadcrumb: "Experimental terminal",
    title: "Experimental terminal",
    description: "",
  },
  sandboxProfiles: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Sandbox Profiles",
    title: "Sandbox Profiles",
    description: "Manage sandbox profile configuration.",
  },
  sandboxProfilesNew: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Create",
    pageBreadcrumbVisible: true,
    title: "Create",
    description: "Create a sandbox profile.",
  },
  sandboxProfilesDetail: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Profile",
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
  },
  sandboxProfileEditor: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Sandbox Profile",
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
  },
  sandboxProfilePublished: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Published",
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
  },
  sandboxProfileDraft: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Draft",
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
  },
  sandboxProfileTriggers: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Triggers",
    title: "Edit profile",
    description: "Manage sandbox profile triggers.",
  },
  sandboxProfileSnapshots: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Snapshots",
    title: "Edit profile",
    description: "Manage sandbox profile snapshots.",
  },
  triggers: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Triggers",
    title: "Triggers",
    description: "Manage triggers.",
  },
  triggersNew: {
    appShellInsetOwner: "child",
    appShellViewportMode: "workspace",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Create",
    pageBreadcrumbVisible: true,
    title: "Create trigger",
    description: "",
  },
  triggersDetail: {
    appShellInsetOwner: "child",
    sidebarTriggerOwner: "page-frame",
    breadcrumb: resolveTriggerDetailBreadcrumb,
    pageBreadcrumbVisible: true,
    title: "",
    description: "",
  },
  settings: {
    sidebarTriggerOwner: "none",
    breadcrumb: "Settings",
    breadcrumbClickable: false,
    title: "Settings",
    description: "Manage personal and organization settings.",
  },
  settingsAccount: {
    sidebarTriggerOwner: "none",
    breadcrumb: "Account",
    breadcrumbClickable: false,
  },
  settingsProfile: {
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "My Profile",
    title: "My Profile",
    description: "",
  },
  settingsOrganization: {
    sidebarTriggerOwner: "none",
    breadcrumb: "Organization",
    breadcrumbTo: "/settings/organization/general",
  },
  settingsOrganizationGeneral: {
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "General",
    title: "General",
    description: "",
  },
  settingsOrganizationMembers: {
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Members",
    title: "Members",
    description: "",
  },
  settingsOrganizationIdentityLinking: {
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Identity Linking",
    title: "Identity Linking",
    description: "Configure the provider apps users will use to link their identities to Mistle.",
  },
  settingsOrganizationSandboxes: {
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Sandboxes",
    title: "Sandboxes",
    description: "Configure organization-wide sandbox settings.",
  },
  settingsOrganizationBilling: {
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Billing",
    title: "Billing",
    description: "",
  },
  settingsOrganizationIntegrations: {
    sidebarTriggerOwner: "page-frame",
    breadcrumb: "Integrations",
    title: "Integrations",
    description: "",
  },
} as const satisfies Record<string, AppRouteHandle>;

export const SETTINGS_PAGE_ROUTE_HANDLE_KEYS = [
  "settingsProfile",
  "settingsOrganizationGeneral",
  "settingsOrganizationMembers",
  "settingsOrganizationIdentityLinking",
  "settingsOrganizationSandboxes",
  "settingsOrganizationBilling",
  "settingsOrganizationIntegrations",
] as const;

export const SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT: {
  [Key in (typeof SETTINGS_PAGE_ROUTE_HANDLE_KEYS)[number]]: SettingsPageRouteHandle;
} = {
  settingsProfile: ROUTE_HANDLES.settingsProfile,
  settingsOrganizationGeneral: ROUTE_HANDLES.settingsOrganizationGeneral,
  settingsOrganizationMembers: ROUTE_HANDLES.settingsOrganizationMembers,
  settingsOrganizationIdentityLinking: ROUTE_HANDLES.settingsOrganizationIdentityLinking,
  settingsOrganizationSandboxes: ROUTE_HANDLES.settingsOrganizationSandboxes,
  settingsOrganizationBilling: ROUTE_HANDLES.settingsOrganizationBilling,
  settingsOrganizationIntegrations: ROUTE_HANDLES.settingsOrganizationIntegrations,
};
