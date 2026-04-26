import { listBrowserIntegrationDefinitions } from "@mistle/integrations-definitions/browser";
import { createElement } from "react";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { SessionHeaderTitle } from "../sessions/session-header-title.js";
import type { AppRouteHandle, RouteTextResolverInput, RouteTextValue } from "./route-meta.js";
import {
  SandboxProfileBreadcrumbs,
  type SandboxProfileBreadcrumbView,
} from "./sandbox-profile-breadcrumbs.js";

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

function resolveIntegrationDetailSubtitle(input: RouteTextResolverInput): string {
  const targetKey = input.params["targetKey"];
  if (targetKey === undefined || targetKey.trim().length === 0) {
    return "";
  }

  return targetKey;
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

  return createElement("img", {
    alt: "",
    className: "h-5 w-5 rounded-sm",
    src: resolveIntegrationLogoPath({ logoKey: metadata.logoKey }),
  });
}

function resolveIntegrationCreateTitle(input: RouteTextResolverInput): string {
  return `Add ${resolveIntegrationDetailTitle(input)} Connection`;
}

function resolveIntegrationEditTitle(input: RouteTextResolverInput): string {
  return `Edit ${resolveIntegrationDetailTitle(input)} Connection`;
}

function resolveGitHubAppSetupTitle(input: RouteTextResolverInput): string {
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

  return createElement("img", {
    alt: `${metadata.displayName} logo`,
    className: "h-11 w-11 rounded-md border bg-background p-1.5",
    src: resolveIntegrationLogoPath({ logoKey: metadata.logoKey }),
  });
}

function resolveSessionDetailHeaderLeading(input: RouteTextResolverInput): React.ReactNode | null {
  const sandboxInstanceId = input.params["sandboxInstanceId"];
  if (sandboxInstanceId === undefined || sandboxInstanceId.trim().length === 0) {
    return null;
  }

  return createElement(SessionHeaderTitle, {
    sandboxInstanceId,
  });
}

function resolveAutomationDetailBreadcrumb(_input: RouteTextResolverInput): string {
  return "Edit";
}

function resolveSandboxProfileHeaderLeading(
  input: RouteTextResolverInput,
  view: SandboxProfileBreadcrumbView,
): React.ReactNode | null {
  const profileId = input.params["profileId"];
  if (profileId === undefined || profileId.trim().length === 0) {
    return null;
  }

  return createElement(SandboxProfileBreadcrumbs, {
    profileId,
    view,
  });
}

export const ROUTE_HANDLES = {
  dashboard: {
    breadcrumb: "Home",
    title: "Home",
    description: "",
  },
  integrations: {
    appShellInsetOwner: "child",
    breadcrumb: "Integrations",
    title: "Integrations",
    description: "",
  },
  integrationDetail: {
    appShellInsetOwner: "child",
    breadcrumb: resolveIntegrationDetailTitle,
    breadcrumbIcon: resolveIntegrationBreadcrumbIcon,
    title: resolveIntegrationDetailTitle,
    description: resolveIntegrationDetailSubtitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  integrationCreate: {
    appShellInsetOwner: "child",
    breadcrumb: "Add",
    title: resolveIntegrationCreateTitle,
    description: resolveIntegrationDetailSubtitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  integrationEdit: {
    appShellInsetOwner: "child",
    breadcrumb: "Edit",
    title: resolveIntegrationEditTitle,
    description: resolveIntegrationDetailSubtitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  integrationGitHubAppSetup: {
    appShellInsetOwner: "child",
    breadcrumb: "Setup",
    title: resolveGitHubAppSetupTitle,
    description: resolveIntegrationDetailSubtitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
  sessions: {
    breadcrumb: "Sessions",
    title: "Sessions",
    description: "",
  },
  sessionsNew: {
    appShellInsetOwner: "child",
    breadcrumb: "New",
    title: "New session",
    description: "Start a sandbox-backed session from a sandbox profile.",
  },
  sessionsDetail: {
    hideBreadcrumb: true,
    header: {
      leading: resolveSessionDetailHeaderLeading,
    },
    title: "Session",
    description: "Interact with one sandbox-backed Codex session.",
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
    appShellInsetOwner: "child",
    breadcrumb: "Create",
    title: "Create",
    description: "Create a sandbox profile.",
  },
  sandboxProfilesDetail: {
    appShellInsetOwner: "child",
    breadcrumb: "Profile",
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
  },
  sandboxProfilePublished: {
    appShellInsetOwner: "child",
    breadcrumb: "Published",
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
    header: {
      leading: (input) => resolveSandboxProfileHeaderLeading(input, "published"),
    },
  },
  sandboxProfileDraft: {
    appShellInsetOwner: "child",
    breadcrumb: "Draft",
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
    header: {
      leading: (input) => resolveSandboxProfileHeaderLeading(input, "draft"),
    },
  },
  automations: {
    breadcrumb: "Automations",
    title: "Automations",
    description: "Manage webhook automations.",
  },
  automationsNew: {
    appShellInsetOwner: "child",
    breadcrumb: "Create",
    title: "Create automation",
    description: "",
  },
  automationsDetail: {
    appShellInsetOwner: "child",
    breadcrumb: resolveAutomationDetailBreadcrumb,
    title: "",
    description: "",
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
  settingsOrganizationIdentityLinking: {
    breadcrumb: "Identity Linking",
    title: "Identity Linking",
    description: "Configure the provider apps users will use to link their identities to Mistle.",
  },
  settingsOrganizationSandboxes: {
    breadcrumb: "Sandboxes",
    title: "Sandboxes",
    description: "Configure organization-wide sandbox settings.",
  },
  settingsOrganizationIntegrations: {
    breadcrumb: "Integrations",
    title: "Integrations",
    description: "",
  },
  settingsOrganizationIntegrationDetail: {
    breadcrumb: resolveIntegrationDetailTitle,
    title: resolveIntegrationDetailTitle,
    description: resolveIntegrationDetailSubtitle,
    header: {
      icon: resolveIntegrationDetailHeaderIcon,
    },
  },
} as const satisfies Record<string, AppRouteHandle>;

export const SETTINGS_PAGE_ROUTE_HANDLE_KEYS = [
  "settingsPersonal",
  "settingsOrganizationGeneral",
  "settingsOrganizationMembers",
  "settingsOrganizationIdentityLinking",
  "settingsOrganizationSandboxes",
  "settingsOrganizationIntegrations",
  "settingsOrganizationIntegrationDetail",
] as const;

export const SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT: {
  [Key in (typeof SETTINGS_PAGE_ROUTE_HANDLE_KEYS)[number]]: SettingsPageRouteHandle;
} = {
  settingsPersonal: ROUTE_HANDLES.settingsPersonal,
  settingsOrganizationGeneral: ROUTE_HANDLES.settingsOrganizationGeneral,
  settingsOrganizationMembers: ROUTE_HANDLES.settingsOrganizationMembers,
  settingsOrganizationIdentityLinking: ROUTE_HANDLES.settingsOrganizationIdentityLinking,
  settingsOrganizationSandboxes: ROUTE_HANDLES.settingsOrganizationSandboxes,
  settingsOrganizationIntegrations: ROUTE_HANDLES.settingsOrganizationIntegrations,
  settingsOrganizationIntegrationDetail: ROUTE_HANDLES.settingsOrganizationIntegrationDetail,
};
