import { describe, expect, it } from "vitest";

import {
  ROUTE_HANDLES,
  SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT,
  SETTINGS_PAGE_ROUTE_HANDLE_KEYS,
} from "./route-handles.js";

describe("route handles", () => {
  it("defines titles and descriptions for settings leaf pages", () => {
    expect(ROUTE_HANDLES.dashboard.title).toBe("Home");
    expect(ROUTE_HANDLES.dashboard.description).toBe("");
    expect(ROUTE_HANDLES.sessions.title).toBe("Sessions");
    expect(ROUTE_HANDLES.sessions.description).toBe("");

    expect(ROUTE_HANDLES.sandboxProfiles.title).toBe("Sandbox Profiles");
    expect(ROUTE_HANDLES.sandboxProfiles.description).toBe("Manage sandbox profile configuration.");
    expect(ROUTE_HANDLES.sandboxProfilesNew.title).toBe("Create");
    expect(ROUTE_HANDLES.sandboxProfilesNew.description).toBe("Create a sandbox profile.");
    expect(ROUTE_HANDLES.sandboxProfilesDetail.title).toBe("Edit profile");
    expect(ROUTE_HANDLES.sandboxProfilesDetail.description).toBe(
      "Edit sandbox profile configuration.",
    );

    expect(ROUTE_HANDLES.settingsPersonal.title).toBe("Personal");
    expect(ROUTE_HANDLES.settingsPersonal.description).toBe("");

    expect(ROUTE_HANDLES.settingsOrganizationGeneral.title).toBe("General");
    expect(ROUTE_HANDLES.settingsOrganizationGeneral.description).toBe("");

    expect(ROUTE_HANDLES.settingsOrganizationMembers.title).toBe("Members");
    expect(ROUTE_HANDLES.settingsOrganizationMembers.description).toBe("");

    expect(ROUTE_HANDLES.settingsOrganizationIntegrations.title).toBe("Integrations");
    expect(ROUTE_HANDLES.settingsOrganizationIntegrations.description).toBe("");

    expect(ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult.title).toBe(
      "Integration callback result",
    );
    expect(ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult.description).toBe(
      "Review integration connection callback outcome.",
    );
  });

  it("defines intended breadcrumb clickability for parent crumbs", () => {
    expect(ROUTE_HANDLES.settings.breadcrumbClickable).toBe(false);
    expect(ROUTE_HANDLES.settingsOrganization.breadcrumbTo).toBe("/settings/organization/general");
  });

  it("requires settings page handles to include breadcrumb, title, and description", () => {
    for (const handleName of SETTINGS_PAGE_ROUTE_HANDLE_KEYS) {
      const handle = SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT[handleName];
      expect(handle.breadcrumb).toBeDefined();
      expect(handle.title).toBeDefined();
      expect(handle.description).toBeDefined();
    }
  });

  it("normalizes callback breadcrumb labels for known and unknown integration target keys", () => {
    const callbackBreadcrumb =
      ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult.breadcrumb;
    expect(typeof callbackBreadcrumb).toBe("function");

    if (typeof callbackBreadcrumb !== "function") {
      throw new Error(
        "settingsOrganizationIntegrationCallbackResult breadcrumb must be a function",
      );
    }

    expect(callbackBreadcrumb({ params: { targetKey: "github" } })).toBe("Github callback");
    expect(callbackBreadcrumb({ params: { targetKey: "openai" } })).toBe("Openai callback");
    expect(callbackBreadcrumb({ params: { targetKey: "custom-integration_v2" } })).toBe(
      "Custom Integration V2 callback",
    );
  });

  it("resolves sandbox profile detail breadcrumb with profile id fallback", () => {
    const detailBreadcrumb = ROUTE_HANDLES.sandboxProfilesDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("sandboxProfilesDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { profileId: "sbp_123" } })).toBe("sbp_123");
    expect(detailBreadcrumb({ params: {} })).toBe("Profile");
  });
});
