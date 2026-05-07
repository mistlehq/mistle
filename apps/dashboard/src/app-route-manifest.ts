import { ROUTE_HANDLES } from "./features/navigation/route-handles.js";
import type { AppRouteHandle } from "./features/navigation/route-meta.js";

export type AppRouteElementKey =
  | "automationCreate"
  | "automations"
  | "home"
  | "integrationConnectionCreate"
  | "integrationConnectionEdit"
  | "integrationConnectionSetup"
  | "newSession"
  | "organizationGeneralSettings"
  | "organizationIdentityLinkingSettings"
  | "organizationMembersSettings"
  | "organizationSandboxStorageSettings"
  | "organizationIntegrationsSettings"
  | "profileSettings"
  | "routeOutlet"
  | "sandboxProfileDefaultRedirect"
  | "sandboxProfileEditorCreate"
  | "sandboxProfileEditorEdit"
  | "sandboxProfileEditorShell"
  | "sandboxProfiles"
  | "scheduledAutomationEditorEdit"
  | "sessionWorkbench"
  | "sessions"
  | "settingsDefaultRedirect"
  | "settingsOrganizationGeneralRedirect"
  | "webhookAutomationEditorEdit"
  | "scheduledAutomationCreateRedirect";

export type AppRouteManifestEntry = {
  children?: AppRouteManifestEntry[];
  element: AppRouteElementKey;
  handle?: AppRouteHandle;
  index?: true;
  path?: string;
  redirect?: true;
};

export const APP_SHELL_ROUTE_MANIFEST = [
  {
    element: "home",
    handle: ROUTE_HANDLES.dashboard,
    index: true,
  },
  {
    element: "routeOutlet",
    handle: ROUTE_HANDLES.sandboxProfiles,
    path: "sandbox-profiles",
    children: [
      {
        element: "sandboxProfiles",
        index: true,
      },
      {
        element: "sandboxProfileEditorCreate",
        handle: ROUTE_HANDLES.sandboxProfilesNew,
        path: "new",
      },
      {
        element: "sandboxProfileEditorShell",
        handle: ROUTE_HANDLES.sandboxProfilesDetail,
        path: ":profileId",
        children: [
          {
            element: "sandboxProfileDefaultRedirect",
            index: true,
            redirect: true,
          },
          {
            element: "sandboxProfileEditorEdit",
            children: [
              {
                element: "routeOutlet",
                handle: ROUTE_HANDLES.sandboxProfileEditor,
                path: "sandbox-profile",
                children: [
                  {
                    element: "routeOutlet",
                    index: true,
                  },
                  {
                    element: "routeOutlet",
                    handle: ROUTE_HANDLES.sandboxProfileDraft,
                    path: "draft",
                  },
                  {
                    element: "routeOutlet",
                    handle: ROUTE_HANDLES.sandboxProfilePublished,
                    path: "published",
                  },
                ],
              },
              {
                element: "routeOutlet",
                handle: ROUTE_HANDLES.sandboxProfileSnapshots,
                path: "snapshots",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    element: "routeOutlet",
    handle: ROUTE_HANDLES.automations,
    path: "automations",
    children: [
      {
        element: "automations",
        index: true,
      },
      {
        element: "automationCreate",
        handle: ROUTE_HANDLES.automationsNew,
        path: "new",
      },
      {
        element: "scheduledAutomationCreateRedirect",
        path: "schedules/new",
        redirect: true,
      },
      {
        element: "scheduledAutomationEditorEdit",
        handle: ROUTE_HANDLES.scheduledAutomationsDetail,
        path: "schedules/:automationId",
      },
      {
        element: "webhookAutomationEditorEdit",
        handle: ROUTE_HANDLES.automationsDetail,
        path: ":automationId",
      },
    ],
  },
  {
    element: "routeOutlet",
    handle: ROUTE_HANDLES.integrations,
    path: "integrations",
    children: [
      {
        element: "organizationIntegrationsSettings",
        index: true,
      },
      {
        element: "routeOutlet",
        handle: ROUTE_HANDLES.integrationDetail,
        path: ":targetKey",
        children: [
          {
            element: "organizationIntegrationsSettings",
            index: true,
          },
          {
            element: "integrationConnectionCreate",
            handle: ROUTE_HANDLES.integrationCreate,
            path: "add",
          },
          {
            element: "integrationConnectionEdit",
            handle: ROUTE_HANDLES.integrationEdit,
            path: ":connectionId/edit",
          },
          {
            element: "integrationConnectionSetup",
            handle: ROUTE_HANDLES.integrationSetup,
            path: ":connectionId/:setupRouteSegment/setup",
          },
        ],
      },
    ],
  },
  {
    element: "routeOutlet",
    handle: ROUTE_HANDLES.sessions,
    path: "sessions",
    children: [
      {
        element: "sessions",
        index: true,
      },
      {
        element: "newSession",
        handle: ROUTE_HANDLES.sessionsNew,
        path: "new",
      },
      {
        element: "sessionWorkbench",
        handle: ROUTE_HANDLES.sessionsDetail,
        path: ":sandboxInstanceId",
      },
    ],
  },
  {
    element: "routeOutlet",
    handle: ROUTE_HANDLES.settings,
    path: "settings",
    children: [
      {
        element: "settingsDefaultRedirect",
        index: true,
        redirect: true,
      },
      {
        element: "routeOutlet",
        handle: ROUTE_HANDLES.settingsAccount,
        path: "account",
        children: [
          {
            element: "settingsDefaultRedirect",
            index: true,
            redirect: true,
          },
          {
            element: "profileSettings",
            handle: ROUTE_HANDLES.settingsProfile,
            path: "profile",
          },
        ],
      },
      {
        element: "routeOutlet",
        handle: ROUTE_HANDLES.settingsOrganization,
        path: "organization",
        children: [
          {
            element: "settingsOrganizationGeneralRedirect",
            index: true,
            redirect: true,
          },
          {
            element: "organizationGeneralSettings",
            handle: ROUTE_HANDLES.settingsOrganizationGeneral,
            path: "general",
          },
          {
            element: "organizationMembersSettings",
            handle: ROUTE_HANDLES.settingsOrganizationMembers,
            path: "members",
          },
          {
            element: "organizationIdentityLinkingSettings",
            handle: ROUTE_HANDLES.settingsOrganizationIdentityLinking,
            path: "identity-linking",
          },
          {
            element: "organizationSandboxStorageSettings",
            handle: ROUTE_HANDLES.settingsOrganizationSandboxes,
            path: "sandboxes",
          },
        ],
      },
    ],
  },
] as const satisfies AppRouteManifestEntry[];
