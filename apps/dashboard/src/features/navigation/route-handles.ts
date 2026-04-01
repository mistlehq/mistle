import { listIntegrationDefinitions } from "@mistle/integrations-definitions";
import { createElement } from "react";
import { z } from "zod";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";
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

function resolveIntegrationDetailBreadcrumb(input: RouteTextResolverInput): string {
  const targetKey = input.params["targetKey"];
  if (targetKey === undefined || targetKey.trim().length === 0) {
    return "Connection";
  }

  return normalizeIntegrationBreadcrumbLabel(targetKey);
}

function resolveIntegrationDefinitionMetadata(targetKey: string): {
  displayName: string;
  logoKey: string;
} | null {
  const definition =
    listIntegrationDefinitions().find((candidate) => candidate.variantId === targetKey) ??
    listIntegrationDefinitions().find((candidate) => candidate.familyId === targetKey) ??
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

function resolveSessionDetailBreadcrumb(input: RouteTextResolverInput): string {
  const sandboxInstanceId = input.params["sandboxInstanceId"];
  if (sandboxInstanceId === undefined || sandboxInstanceId.trim().length === 0) {
    return "Session";
  }

  return sandboxInstanceId;
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

function resolveAutomationDetailBreadcrumb(input: RouteTextResolverInput): string {
  const automationId = input.params["automationId"];
  if (automationId === undefined || automationId.trim().length === 0) {
    return "Automation";
  }

  return automationId;
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
  sessionsDetail: {
    breadcrumb: resolveSessionDetailBreadcrumb,
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
    breadcrumb: "Create",
    title: "Create",
    description: "Create a sandbox profile.",
  },
  sandboxProfilesDetail: {
    breadcrumb: resolveSandboxProfileDetailBreadcrumb,
    title: "Edit profile",
    description: "Edit sandbox profile configuration.",
  },
  automations: {
    breadcrumb: "Automations",
    title: "Automations",
    description: "Manage webhook automations.",
  },
  automationsNew: {
    breadcrumb: "Create",
    title: "Create automation",
    description: "Create a webhook automation.",
  },
  automationsDetail: {
    breadcrumb: resolveAutomationDetailBreadcrumb,
    title: "Edit automation",
    description: "Edit webhook automation configuration.",
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
  settingsOrganizationIntegrationDetail: {
    breadcrumb: resolveIntegrationDetailBreadcrumb,
    title: resolveIntegrationDetailTitle,
    description: resolveIntegrationDetailSubtitle,
    headerIcon: resolveIntegrationDetailHeaderIcon,
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
  "settingsOrganizationIntegrationDetail",
  "settingsOrganizationIntegrationCallbackResult",
] as const;

export const SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT: {
  [Key in (typeof SETTINGS_PAGE_ROUTE_HANDLE_KEYS)[number]]: SettingsPageRouteHandle;
} = {
  settingsPersonal: ROUTE_HANDLES.settingsPersonal,
  settingsOrganizationGeneral: ROUTE_HANDLES.settingsOrganizationGeneral,
  settingsOrganizationMembers: ROUTE_HANDLES.settingsOrganizationMembers,
  settingsOrganizationIntegrations: ROUTE_HANDLES.settingsOrganizationIntegrations,
  settingsOrganizationIntegrationDetail: ROUTE_HANDLES.settingsOrganizationIntegrationDetail,
  settingsOrganizationIntegrationCallbackResult:
    ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult,
};
